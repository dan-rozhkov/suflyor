import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_SUMMARY_CHARS, MAX_SUMMARY_LINES } from './summary-limits'
import { MAX_CONTEXT_CHARS } from './suggest-prompt'
import {
  requestSummary,
  summaryLabels,
  summaryLines,
  summaryDate,
  summaryDetails,
  summaryDuration,
  SUMMARY_FAILED_MESSAGE,
  SUMMARY_NOT_SET_UP_MESSAGE,
  SUMMARY_TIMEOUT_MESSAGE,
  SUMMARY_TIMEOUT_MS,
  SUMMARY_TOO_LONG_MESSAGE
} from './summary'
import { BAD_CODE_MESSAGE } from './token'

afterEach(() => vi.useRealTimers())

describe('summaryLines', () => {
  it('keeps everything that fits', () => {
    expect(summaryLines(['a', 'b'])).toEqual({ lines: ['a', 'b'], cut: false })
    expect(summaryLines([])).toEqual({ lines: [], cut: false })
  })

  it('keeps the newest lines within the character limit', () => {
    const line = 'x'.repeat(MAX_SUMMARY_CHARS / 2 - 1)
    const r = summaryLines(['old', line, line])
    // Two lines and a separator are one under the limit; a third would pass it.
    expect(r.lines).toEqual([line, line])
    expect(r.cut).toBe(true)
  })

  it('counts one character per separator', () => {
    const a = 'x'.repeat(MAX_SUMMARY_CHARS / 2 - 1)
    const b = 'x'.repeat(MAX_SUMMARY_CHARS / 2)
    expect(summaryLines([a, b]).cut).toBe(false)
    expect(summaryLines([a, b + 'x']).cut).toBe(true)
  })

  it('keeps the newest lines within the line limit', () => {
    const lines = Array.from({ length: MAX_SUMMARY_LINES + 3 }, (_, i) => `l${i}`)
    const r = summaryLines(lines)
    expect(r.lines).toHaveLength(MAX_SUMMARY_LINES)
    expect(r.lines.at(-1)).toBe(`l${MAX_SUMMARY_LINES + 2}`)
    expect(r.cut).toBe(true)
  })

  it('keeps the last part of one line over the limit', () => {
    const big = 'a'.repeat(MAX_SUMMARY_CHARS) + 'END'
    const r = summaryLines(['before', big])
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]).toHaveLength(MAX_SUMMARY_CHARS)
    expect(r.lines[0].endsWith('END')).toBe(true)
    expect(r.cut).toBe(true)
  })
})

const good = {
  summary: {
    title: 'Планирование релиза',
    actionItems: [{ owner: 'Анна', task: 'подготовить отчёт' }, { task: 'написать письмо' }],
    overview: ['Обсудили сроки'],
    topics: [{ title: 'Сроки', bullets: ['Релиз в пятницу'] }]
  }
}
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
const CODE = 'fictional-code-0123456789abcdef'
const base = { code: CODE, lines: ['Hello.'], context: 'notes', callLanguage: 'en', language: 'ru' }

describe('requestSummary', () => {
  it('returns the summary on 200 and sends the contract', async () => {
    const fetchImpl = vi.fn(async () => json(good)) as unknown as typeof fetch
    const r = await requestSummary({ ...base, context: 'c'.repeat(200_000), fetchImpl })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.summary.title).toBe('Планирование релиза')
      expect(r.summary.actionItems[1]).toEqual({ owner: '', task: 'написать письмо' })
    }
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/summary')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CODE}`)
    const body = JSON.parse(init.body as string)
    expect(body.lines).toEqual(['Hello.'])
    expect(body.context).toHaveLength(MAX_CONTEXT_CHARS)
    expect(body.callLanguage).toBe('en')
    expect(body.language).toBe('ru')
  })

  it('refuses a code a header cannot carry without calling fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    expect(await requestSummary({ ...base, code: 'bad code', fetchImpl })).toEqual({ ok: false, message: BAD_CODE_MESSAGE, badCode: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [401, { message: BAD_CODE_MESSAGE, badCode: true }],
    [413, { message: SUMMARY_TOO_LONG_MESSAGE }],
    [500, { message: SUMMARY_FAILED_MESSAGE }]
  ])('maps status %i', async (status, expected) => {
    const r = await requestSummary({ ...base, fetchImpl: (async () => json({}, status)) as unknown as typeof fetch })
    expect(r).toEqual({ ok: false, ...expected })
  })

  it('says it is not set up only when the Worker has no key', async () => {
    const answer = (body: unknown) => (async () => json(body, 503)) as unknown as typeof fetch
    expect(await requestSummary({ ...base, fetchImpl: answer({ error: 'no-suggest-key' }) })).toEqual({ ok: false, message: SUMMARY_NOT_SET_UP_MESSAGE })
    expect(await requestSummary({ ...base, fetchImpl: answer({}) })).toEqual({ ok: false, message: SUMMARY_FAILED_MESSAGE })
  })

  it.each([
    ['no summary', {}],
    ['summary not an object', { summary: 'text' }],
    ['arrays missing', { summary: { title: 'T' } }],
    ['topic bullets not strings', { summary: { ...good.summary, topics: [{ title: 'A', bullets: [1] }] } }]
  ])('fails on a bad shape: %s', async (_name, body) => {
    const r = await requestSummary({ ...base, fetchImpl: (async () => json(body)) as unknown as typeof fetch })
    expect(r).toEqual({ ok: false, message: SUMMARY_FAILED_MESSAGE })
  })

  it('fails when the body is not JSON', async () => {
    const r = await requestSummary({ ...base, fetchImpl: (async () => new Response('nope')) as unknown as typeof fetch })
    expect(r).toEqual({ ok: false, message: SUMMARY_FAILED_MESSAGE })
  })

  const hanging = ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_r, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
    })) as typeof fetch

  it('times out after 90 seconds', async () => {
    vi.useFakeTimers()
    const p = requestSummary({ ...base, fetchImpl: hanging })
    await vi.advanceTimersByTimeAsync(SUMMARY_TIMEOUT_MS - 1)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toEqual({ ok: false, message: SUMMARY_TIMEOUT_MESSAGE })
  })

  it('resolves with an empty message when the caller aborts', async () => {
    const ctrl = new AbortController()
    const p = requestSummary({ ...base, signal: ctrl.signal, fetchImpl: hanging })
    ctrl.abort()
    expect(await p).toEqual({ ok: false, message: '' })
  })

  it('does not call fetch when the caller aborted already', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const fetchImpl = vi.fn() as unknown as typeof fetch
    expect(await requestSummary({ ...base, signal: ctrl.signal, fetchImpl })).toEqual({ ok: false, message: '' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('summaryDate and summaryDuration', () => {
  const at = new Date(2026, 10, 10, 11, 0).getTime()
  it('gives the weekday, date and start time', () => {
    expect(summaryDate(at, 'en')).toBe('Tuesday, November 10, 2026 at 11:00 AM')
    expect(summaryDate(at, 'ru')).toBe('вторник, 10 ноября 2026 в 11:00')
  })
  it('uses English for every language but Russian', () => {
    expect(summaryDate(at, 'de')).toBe(summaryDate(at, 'en'))
  })
  it('gives minutes and seconds, and hours past an hour', () => {
    expect(summaryDuration(821_000)).toBe('13:41')
    expect(summaryDuration(59_400)).toBe('0:59')
    expect(summaryDuration(3_725_000)).toBe('1:02:05')
    expect(summaryDuration(-5)).toBe('0:00')
  })
})

describe('summaryDetails', () => {
  const at = new Date(2026, 10, 10, 11, 0).getTime()
  it('has Date and Duration from the page, and People only when the call named someone', () => {
    expect(summaryDetails({}, at, 821_000, 'en')).toEqual([
      { label: 'Date', value: 'Tuesday, November 10, 2026 at 11:00 AM' },
      { label: 'Duration', value: '13:41' }
    ])
    expect(summaryDetails({ people: [] }, at, 821_000, 'en')).toHaveLength(2)
    expect(summaryDetails({ people: ['Anna', ' ', 'Boris'] }, at, 821_000, 'ru')).toEqual([
      { label: 'Дата', value: 'вторник, 10 ноября 2026 в 11:00' },
      { label: 'Длительность', value: '13:41' },
      { label: 'Участники', value: 'Anna, Boris' }
    ])
  })
})

describe('summaryLabels', () => {
  it('gives Russian headings for ru', () => {
    const ru = summaryLabels('ru')
    expect(ru.actions).toBe('Задачи')
    expect(ru.overview).toBe('Обзор')
    expect(ru.cut).toBe('Итоги только по последней части разговора.')
    expect(ru.ready).toBe('Итоги готовы')
  })
  it('gives English headings for everything else', () => {
    expect(summaryLabels('de')).toEqual(summaryLabels('en'))
    expect(summaryLabels('en')).toMatchObject({ actions: 'Action items', overview: 'Overview', date: 'Date', duration: 'Duration', people: 'People' })
  })
})
