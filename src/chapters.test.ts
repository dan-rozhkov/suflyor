import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createChapterer,
  FLUSH_CHARS,
  MAX_RETRIES,
  MIN_GAP_MS,
  PAUSE_CHARS,
  PAUSE_MS,
  REQUEST_MS,
  SIZE_CHARS,
  type Chapter,
  type ChapterPara
} from './chapters'
import { MAX_CHAPTER_PARAGRAPHS, MAX_CHAPTER_PARAGRAPH_CHARS, MAX_CHAPTER_WINDOW_CHARS } from './chapters-limits'

const ok = (chapters: { start: number; title: string }[]): Response => new Response(JSON.stringify({ chapters }), { status: 200 })
const status = (n: number): Response => new Response('', { status: n })
const noKey = (): Response => new Response(JSON.stringify({ error: 'no-suggest-key' }), { status: 503 })

const hanging = (): typeof fetch =>
  ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_r, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
    })) as typeof fetch

function para(i: number, len = 50, id = 'u1'): ChapterPara {
  return { key: { id, para: i }, text: `p${i} `.padEnd(len, 'x'), at: 1000 + i }
}
const paras = (n: number, len = 50, id = 'u1'): ChapterPara[] => Array.from({ length: n }, (_, i) => para(i, len, id))

function setup(fetchImpl: typeof fetch, code = 'fictional-code-0123456789abcdef') {
  const state = { paras: paras(4), code }
  const changes: Chapter[][] = []
  const c = createChapterer({
    getCode: () => state.code,
    getParagraphs: () => state.paras,
    onChange: (l) => changes.push(l),
    fetchImpl
  })
  return { c, state, changes }
}

const bodyOf = (f: ReturnType<typeof vi.fn>, n = 0): { paragraphs: string[]; openTitle?: string } =>
  JSON.parse((f.mock.calls[n][1] as RequestInit).body as string)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('triggers', () => {
  it('sends at once after SIZE_CHARS new characters', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS - 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).not.toHaveBeenCalled()
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/chapters')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fictional-code-0123456789abcdef')
    expect(bodyOf(f).paragraphs).toHaveLength(4)
    expect(bodyOf(f).openTitle).toBeUndefined()
    expect(changes).toEqual([[{ key: { id: 'u1', para: 0 }, title: 'Тема', at: 1000 }]])
  })

  it('sends after a pause with enough new characters', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(PAUSE_CHARS)
    await vi.advanceTimersByTimeAsync(PAUSE_MS - 1)
    expect(f).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('does not send after a pause with too few characters', async () => {
    const f = vi.fn(async () => ok([]))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(PAUSE_CHARS - 1)
    await vi.advanceTimersByTimeAsync(PAUSE_MS * 3)
    expect(f).not.toHaveBeenCalled()
  })

  it('rearms the pause timer on each onText', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(PAUSE_CHARS)
    await vi.advanceTimersByTimeAsync(PAUSE_MS - 1000)
    c.onText(PAUSE_CHARS + 10)
    await vi.advanceTimersByTimeAsync(PAUSE_MS - 1)
    expect(f).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('sends nothing without paragraphs', async () => {
    const f = vi.fn(async () => ok([]))
    const { c, state } = setup(f as unknown as typeof fetch)
    state.paras = []
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(PAUSE_MS * 2)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('gap and one in flight', () => {
  it('moves a pause inside the gap to the end of the gap', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    c.onText(SIZE_CHARS + PAUSE_CHARS)
    await vi.advanceTimersByTimeAsync(PAUSE_MS)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS - PAUSE_MS - 1)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('fires a size trigger inside the gap on a later onText', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    c.onText(SIZE_CHARS * 2 + 5)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS * 2 + 10)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('keeps one request in flight', async () => {
    const f = vi.fn(hanging())
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS - 1)
    c.onText(SIZE_CHARS * 3)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('times out after REQUEST_MS and counts it as a failure', async () => {
    const f = vi.fn(hanging())
    const { c, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(REQUEST_MS - 1)
    expect((f.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((f.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
    expect(changes).toEqual([])
    // The next send waits 60 seconds after the failure.
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(59_000)
    c.onText(SIZE_CHARS * 2 + 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('flush', () => {
  it('sends when enough text is new, ignoring the gap', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    c.onText(SIZE_CHARS + FLUSH_CHARS - 1)
    c.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    c.onText(SIZE_CHARS + FLUSH_CHARS)
    c.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('sends right after the request in flight ends', async () => {
    let resolve!: (r: Response) => void
    const f = vi.fn()
    f.mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)))
    f.mockImplementation(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    c.onText(SIZE_CHARS + 300)
    c.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    resolve(ok([{ start: 0, title: 'Тема' }]))
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('does not send after the request in flight when too little is new', async () => {
    let resolve!: (r: Response) => void
    const f = vi.fn(() => new Promise<Response>((r) => (resolve = r)))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    c.onText(SIZE_CHARS + FLUSH_CHARS - 1)
    c.flush()
    resolve(ok([{ start: 0, title: 'Тема' }]))
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('failures', () => {
  it.each([400, 413, 502])('stays silent on %i and backs off', async (code) => {
    const f = vi.fn(async () => status(code))
    const { c, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(changes).toEqual([])
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('doubles the wait up to five minutes and resets on success', async () => {
    const f = vi.fn(async () => status(502))
    const { c } = setup(f as unknown as typeof fetch)
    const waits = [60_000, 120_000, 240_000, 300_000, 300_000]
    let size = SIZE_CHARS
    c.onText(size)
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 0; i < waits.length; i++) {
      expect(f).toHaveBeenCalledTimes(i + 1)
      await vi.advanceTimersByTimeAsync(waits[i] - 1)
      c.onText(++size)
      await vi.advanceTimersByTimeAsync(0)
      expect(f).toHaveBeenCalledTimes(i + 1)
      await vi.advanceTimersByTimeAsync(1)
      c.onText(++size)
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(f).toHaveBeenCalledTimes(waits.length + 1)
    f.mockImplementation(async () => ok([{ start: 0, title: 'Тема' }]) as never)
    await vi.advanceTimersByTimeAsync(300_000)
    c.onText(++size)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(waits.length + 2)
    // Success: the next failure starts again at 60 seconds.
    f.mockImplementation(async () => status(502) as never)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText((size += SIZE_CHARS))
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(waits.length + 3)
    await vi.advanceTimersByTimeAsync(60_000)
    c.onText(++size)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(waits.length + 4)
  })

  it('treats a malformed answer as a failure', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ chapters: [{ start: 'a', title: 1 }] }), { status: 200 }))
    const { c, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(changes).toEqual([])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('treats a network error as a failure', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('network')
    })
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it.each([401, 503])('stops trying after %i until reset', async (code) => {
    const f = vi.fn(async () => (code === 503 ? noKey() : status(code)))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    c.onText(SIZE_CHARS * 5)
    c.flush()
    await vi.advanceTimersByTimeAsync(PAUSE_MS * 2)
    expect(f).toHaveBeenCalledTimes(1)
    c.reset()
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('stops for a code with characters a header cannot carry', async () => {
    const f = vi.fn(async () => ok([]))
    const { c } = setup(f as unknown as typeof fetch, 'код с пробелом')
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(PAUSE_MS * 2)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('reset', () => {
  it('drops a late answer and aborts the request', async () => {
    let resolve!: (r: Response) => void
    const f = vi.fn((_u: unknown, _i?: RequestInit) => new Promise<Response>((r) => (resolve = r)))
    const { c, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    c.reset()
    expect((f.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true)
    resolve(ok([{ start: 0, title: 'Тема' }]))
    await vi.advanceTimersByTimeAsync(0)
    expect(changes).toEqual([])
  })

  it('clears timers and the sent size', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(PAUSE_CHARS)
    c.reset()
    await vi.advanceTimersByTimeAsync(PAUSE_MS * 2)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('window', () => {
  it('starts at the first paragraph when there is no chapter', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c, state } = setup(f as unknown as typeof fetch)
    state.paras = paras(3)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(bodyOf(f).paragraphs).toHaveLength(3)
  })

  it('starts at the open chapter and sends its title', async () => {
    const f = vi.fn()
    f.mockImplementationOnce(async () =>
      ok([
        { start: 0, title: 'Первая' },
        { start: 2, title: 'Вторая' }
      ])
    )
    f.mockImplementation(async () => ok([{ start: 0, title: 'Вторая, дальше' }]))
    const { c, state } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    state.paras = paras(7)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(bodyOf(f, 1).paragraphs).toHaveLength(5)
    expect(bodyOf(f, 1).paragraphs[0]).toBe(state.paras[2].text)
    expect(bodyOf(f, 1).openTitle).toBe('Вторая')
  })

  it('cuts long paragraphs', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c, state } = setup(f as unknown as typeof fetch)
    state.paras = [para(0, MAX_CHAPTER_PARAGRAPH_CHARS + 500)]
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(bodyOf(f).paragraphs[0]).toHaveLength(MAX_CHAPTER_PARAGRAPH_CHARS)
  })

  it('keeps the newest paragraphs over the count limit', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c, state } = setup(f as unknown as typeof fetch)
    state.paras = paras(MAX_CHAPTER_PARAGRAPHS + 20, 10)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    const sent = bodyOf(f).paragraphs
    expect(sent).toHaveLength(MAX_CHAPTER_PARAGRAPHS)
    expect(sent[sent.length - 1]).toBe(state.paras[state.paras.length - 1].text)
  })

  it('keeps the newest paragraphs over the size limit', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c, state } = setup(f as unknown as typeof fetch)
    state.paras = paras(40, 800)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    const sent = bodyOf(f).paragraphs
    expect(sent.join('').length).toBeLessThanOrEqual(MAX_CHAPTER_WINDOW_CHARS)
    expect(sent.length).toBe(Math.floor(MAX_CHAPTER_WINDOW_CHARS / 800))
    expect(sent[sent.length - 1]).toBe(state.paras[39].text)
  })

  it('keeps the open chapter key when the window was cut', async () => {
    const f = vi.fn()
    f.mockImplementationOnce(async () => ok([{ start: 0, title: 'Первая' }]))
    f.mockImplementation(async () =>
      ok([
        { start: 0, title: 'Первая, продолжение' },
        { start: 5, title: 'Новая' }
      ])
    )
    const { c, state, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    state.paras = paras(MAX_CHAPTER_PARAGRAPHS + 30, 10)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    const last = changes[changes.length - 1]
    expect(last).toHaveLength(2)
    expect(last[0]).toEqual({ key: { id: 'u1', para: 0 }, title: 'Первая, продолжение', at: 1000 })
    const first = state.paras.length - MAX_CHAPTER_PARAGRAPHS
    expect(last[1].key).toEqual(state.paras[first + 5].key)
  })

  it('keeps the first paragraph of the run when the window was cut and there is no open chapter', async () => {
    const f = vi.fn(async () => ok([{ start: 4, title: 'Тема' }]))
    const { c, state, changes } = setup(f as unknown as typeof fetch)
    state.paras = paras(MAX_CHAPTER_PARAGRAPHS + 10, 10)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(changes[0]).toEqual([{ key: state.paras[0].key, title: 'Тема', at: state.paras[0].at }])
  })
})

describe('merge', () => {
  it('freezes earlier chapters and replaces only the open one', async () => {
    const f = vi.fn()
    f.mockImplementationOnce(async () =>
      ok([
        { start: 0, title: 'Первая' },
        { start: 2, title: 'Вторая' }
      ])
    )
    f.mockImplementationOnce(async () =>
      ok([
        { start: 0, title: 'Вторая, уточнено' },
        { start: 3, title: 'Третья' }
      ])
    )
    const { c, state, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(changes[0].map((x) => x.title)).toEqual(['Первая', 'Вторая'])
    state.paras = paras(8)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(changes[1]).toEqual([
      { key: { id: 'u1', para: 0 }, title: 'Первая', at: 1000 },
      { key: { id: 'u1', para: 2 }, title: 'Вторая, уточнено', at: 1002 },
      { key: { id: 'u1', para: 5 }, title: 'Третья', at: 1005 }
    ])
  })

  it('ignores starts out of range or not ascending', async () => {
    const f = vi.fn(async () =>
      ok([
        { start: 0, title: 'Первая' },
        { start: 9, title: 'Далеко' },
        { start: -1, title: 'Минус' },
        { start: 2, title: 'Вторая' },
        { start: 1, title: 'Назад' },
        { start: 2, title: 'Повтор' }
      ])
    )
    const { c, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(changes[0].map((x) => x.title)).toEqual(['Первая', 'Вторая'])
  })

  it('calls onChange only when the list changed', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(2)
    expect(changes).toHaveLength(1)
  })
})

describe('startRun', () => {
  it('closes the open chapter and starts the next window at the new run', async () => {
    const f = vi.fn()
    f.mockImplementationOnce(async () => ok([{ start: 0, title: 'Старый звонок' }]))
    f.mockImplementation(async () => ok([{ start: 0, title: 'Новый звонок' }]))
    const { c, state, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    c.startRun()
    state.paras = paras(2, 50, 'u0').map((p) => ({ ...p, at: 0 }))
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    // The sent size went back to 0, so SIZE_CHARS new characters are needed again.
    c.onText(SIZE_CHARS - 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(bodyOf(f, 1).openTitle).toBeUndefined()
    expect(bodyOf(f, 1).paragraphs).toHaveLength(2)
    expect(changes[1].map((x) => x.title)).toEqual(['Старый звонок', 'Новый звонок'])
  })

  it('merges a flush answer still in flight into the old run', async () => {
    let resolve!: (r: Response) => void
    const f = vi.fn(() => new Promise<Response>((r) => (resolve = r)))
    const { c, state, changes } = setup(f as unknown as typeof fetch)
    c.onText(300)
    c.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    c.startRun()
    state.paras = paras(2, 50, 'u2')
    resolve(ok([{ start: 1, title: 'Хвост звонка' }]))
    await vi.advanceTimersByTimeAsync(0)
    expect(changes).toEqual([[{ key: { id: 'u1', para: 0 }, title: 'Хвост звонка', at: 1000 }]])
    // The old size did not leak into the new run.
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS - 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('review fixes', () => {
  const twice = (first: Response, second: Response): ReturnType<typeof vi.fn> => {
    const list = [first, second]
    return vi.fn(async () => list.shift() ?? ok([]))
  }

  it('does not duplicate chapters when the paragraph of the open chapter shrinks away', async () => {
    const f = twice(ok([{ start: 0, title: 'Первая' }, { start: 3, title: 'Вторая' }]), ok([{ start: 0, title: 'Вторая' }]))
    const { c, state, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    const next = { ...para(0, 50, 'u2'), at: 5000 }
    state.paras = [...paras(3), next]
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    // Closed text is not sent, and the next paragraph carries the open chapter on.
    expect(bodyOf(f, 1).paragraphs).toEqual([next.text])
    expect(changes[changes.length - 1].map((x) => x.title)).toEqual(['Первая', 'Вторая'])
  })

  it('skips the send while the utterance of the open chapter has no text', async () => {
    const f = twice(ok([{ start: 0, title: 'Первая' }]), ok([]))
    const { c, state } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    state.paras = paras(2, 50, 'u0').map((p) => ({ ...p, at: 0 }))
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('retries a failed flush after the backoff, then gives up', async () => {
    const f = vi.fn(async () => status(502))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(FLUSH_CHARS)
    c.flush()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(f).toHaveBeenCalledTimes(MAX_RETRIES + 1)
  })

  it('retries a failed pause send in silence', async () => {
    const f = twice(status(502), ok([{ start: 0, title: 'Тема' }]))
    const { c, changes } = setup(f as unknown as typeof fetch)
    c.onText(PAUSE_CHARS)
    await vi.advanceTimersByTimeAsync(PAUSE_MS)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f).toHaveBeenCalledTimes(2)
    expect(changes).toHaveLength(1)
  })

  it('an empty code only skips the send, and the next text with a code goes out', async () => {
    const f = vi.fn(async () => ok([{ start: 0, title: 'Тема' }]))
    const { c, state } = setup(f as unknown as typeof fetch, '')
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).not.toHaveBeenCalled()
    state.code = 'fictional-code-0123456789abcdef'
    c.onText(SIZE_CHARS + 1)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('a new run tries again after 401 or 503', async () => {
    const f = twice(noKey(), ok([{ start: 0, title: 'Тема' }]))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    c.startRun()
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('treats a 503 from the platform as a passing failure', async () => {
    const f = twice(status(503), ok([{ start: 0, title: 'Тема' }]))
    const { c, changes } = setup(f as unknown as typeof fetch)
    c.onText(PAUSE_CHARS)
    await vi.advanceTimersByTimeAsync(PAUSE_MS + 60_000)
    expect(f).toHaveBeenCalledTimes(2)
    expect(changes).toHaveLength(1)
  })

  it('an old request refused with 401 does not switch off the new run', async () => {
    let answer!: (r: Response) => void
    const f = vi.fn(() => (f.mock.calls.length === 1 ? new Promise<Response>((r) => (answer = r)) : Promise.resolve(ok([{ start: 0, title: 'Тема' }]))))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(FLUSH_CHARS)
    c.flush()
    c.startRun()
    answer(status(401))
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('adds a chapter and keeps the open one when the answer skips paragraph 0', async () => {
    const f = twice(ok([{ start: 0, title: 'Первая' }]), ok([{ start: 2, title: 'Вторая' }]))
    const { c, state, changes } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(MIN_GAP_MS)
    c.onText(SIZE_CHARS * 2)
    await vi.advanceTimersByTimeAsync(0)
    expect(changes[1].map((x) => [x.key.para, x.title])).toEqual([[0, 'Первая'], [2, 'Вторая']])
    expect(state.paras).toHaveLength(4)
  })

  it('does not resend a pending flush right after a failure, and keeps the backoff', async () => {
    let answer!: (r: Response) => void
    const f = vi.fn(() => new Promise<Response>((r) => (answer = r)))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(SIZE_CHARS)
    await vi.advanceTimersByTimeAsync(0)
    c.onText(SIZE_CHARS + FLUSH_CHARS)
    c.flush()
    answer(status(502))
    await vi.advanceTimersByTimeAsync(0)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('new text gives the retries back', async () => {
    const f = vi.fn(async () => status(502))
    const { c } = setup(f as unknown as typeof fetch)
    c.onText(FLUSH_CHARS)
    c.flush()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    const used = f.mock.calls.length
    c.onText(FLUSH_CHARS + 1)
    c.flush()
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(f.mock.calls.length).toBe(used * 2)
  })
})
