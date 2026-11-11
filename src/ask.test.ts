import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASK_FAILED_MESSAGE,
  ASK_NOT_SET_UP_MESSAGE,
  ASK_TIMEOUT_MESSAGE,
  ASK_TIMEOUT_MS,
  ASK_TOO_LONG_MESSAGE,
  requestAnswer
} from './ask'
import { BAD_CODE_MESSAGE } from './token'

afterEach(() => vi.useRealTimers())

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
const CODE = 'fictional-code-0123456789abcdef'
const base = { code: CODE, sources: 'Notes: ship in May.', question: 'When?', history: [{ question: 'Who?', answer: 'Anna.' }], language: 'en' }

describe('requestAnswer', () => {
  it('returns the answer on 200 and sends the contract', async () => {
    const fetchImpl = vi.fn(async () => json({ answer: 'In May.' })) as unknown as typeof fetch
    expect(await requestAnswer({ ...base, fetchImpl })).toEqual({ ok: true, answer: 'In May.' })
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/ask')
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CODE}`)
    expect(JSON.parse(init.body as string)).toEqual({ sources: base.sources, question: 'When?', history: base.history, language: 'en' })
  })

  it('refuses a code a header cannot carry without calling fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    expect(await requestAnswer({ ...base, code: 'bad code', fetchImpl })).toEqual({ ok: false, message: BAD_CODE_MESSAGE, badCode: true })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    [401, { message: BAD_CODE_MESSAGE, badCode: true }],
    [413, { message: ASK_TOO_LONG_MESSAGE }],
    [502, { message: ASK_FAILED_MESSAGE }]
  ])('maps status %i', async (status, expected) => {
    const r = await requestAnswer({ ...base, fetchImpl: (async () => json({}, status)) as unknown as typeof fetch })
    expect(r).toEqual({ ok: false, ...expected })
  })

  it('says it is not set up only when the Worker has no key', async () => {
    const answer = (body: unknown) => (async () => json(body, 503)) as unknown as typeof fetch
    expect(await requestAnswer({ ...base, fetchImpl: answer({ error: 'no-suggest-key' }) })).toEqual({ ok: false, message: ASK_NOT_SET_UP_MESSAGE })
    expect(await requestAnswer({ ...base, fetchImpl: answer({}) })).toEqual({ ok: false, message: ASK_FAILED_MESSAGE })
  })

  it.each([[{}], [{ answer: 5 }], [{ answer: '  ' }]])('fails on a bad shape %#', async (body) => {
    const r = await requestAnswer({ ...base, fetchImpl: (async () => json(body)) as unknown as typeof fetch })
    expect(r).toEqual({ ok: false, message: ASK_FAILED_MESSAGE })
  })

  it('fails when the body is not JSON', async () => {
    const r = await requestAnswer({ ...base, fetchImpl: (async () => new Response('nope')) as unknown as typeof fetch })
    expect(r).toEqual({ ok: false, message: ASK_FAILED_MESSAGE })
  })

  const hanging = ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_r, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
    })) as typeof fetch

  it('times out after 60 seconds', async () => {
    vi.useFakeTimers()
    const p = requestAnswer({ ...base, fetchImpl: hanging })
    await vi.advanceTimersByTimeAsync(ASK_TIMEOUT_MS)
    expect(await p).toEqual({ ok: false, message: ASK_TIMEOUT_MESSAGE })
  })

  it('resolves with an empty message when the caller aborts', async () => {
    const ctrl = new AbortController()
    const p = requestAnswer({ ...base, signal: ctrl.signal, fetchImpl: hanging })
    ctrl.abort()
    expect(await p).toEqual({ ok: false, message: '' })
  })

  it('does not call fetch when the caller aborted already', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const fetchImpl = vi.fn() as unknown as typeof fetch
    expect(await requestAnswer({ ...base, signal: ctrl.signal, fetchImpl })).toEqual({ ok: false, message: '' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
