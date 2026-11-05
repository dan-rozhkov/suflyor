import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSuggester, SUGGEST_TIMEOUT_MESSAGE, type SuggestUpdate } from './suggest'

const sse = (...deltas: string[]): string[] => [
  ...deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`),
  'data: [DONE]\n\n'
]

function streamResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch))
        c.close()
      }
    }),
    { status }
  )
}

/** A stream the test pushes into by hand. */
function manualStream(): { res: Response; push: (s: string) => void; close: () => void } {
  const enc = new TextEncoder()
  let ctl!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) })
  return { res: new Response(body, { status: 200 }), push: (s) => ctl.enqueue(enc.encode(s)), close: () => ctl.close() }
}

const hanging = (): typeof fetch =>
  ((_u: unknown, init?: RequestInit) =>
    new Promise<Response>((_r, rej) => {
      init?.signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')))
    })) as typeof fetch

function setup(fetchImpl: typeof fetch, code = 'fictional-code-0123456789abcdef') {
  const updates: SuggestUpdate[] = []
  const s = createSuggester({ getCode: () => code, getContext: () => 'ctx text', onUpdate: (u) => updates.push(u), fetchImpl })
  return { s, updates }
}

const flush = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

import { MAX_CONTEXT_CHARS, MAX_LINES } from './suggest-prompt'

describe('createSuggester', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('posts with the bearer code and streams to done', async () => {
    const f = vi.fn(async () => streamResponse(sse('EN: Hi there.\nEN: Ok.\nR', 'U: Привет.\n')))
    const { s, updates } = setup(f as unknown as typeof fetch)
    s.request(['How is it going?'])
    await flush()
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/suggest')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fictional-code-0123456789abcdef')
    expect(JSON.parse(init.body as string)).toEqual({ lines: ['How is it going?'], context: 'ctx text' })
    expect(updates[0]).toEqual({ status: 'streaming', options: [] })
    expect(updates[updates.length - 1]).toEqual({ status: 'done', options: ['Hi there.', 'Ok.'] })
  })

  it('shows partial options while streaming', async () => {
    const m = manualStream()
    const { s, updates } = setup((async () => m.res) as unknown as typeof fetch)
    s.request(['a'])
    await flush()
    m.push(sse('EN: Sure, so')[0])
    await flush()
    expect(updates[updates.length - 1]).toEqual({ status: 'streaming', options: ['Sure, so'] })
    m.close()
    await flush()
    expect(updates[updates.length - 1].status).toBe('done')
  })

  it('maps 503, 401 and other failures', async () => {
    const cases: [number, Partial<SuggestUpdate>][] = [
      [503, { message: 'Reply suggestions are not set up yet.' }],
      [401, { message: 'This access code is wrong.', badCode: true }],
      [502, { message: 'Could not get replies. Try again.' }],
      [413, { message: 'The context is too long for replies.' }]
    ]
    for (const [status, want] of cases) {
      const { s, updates } = setup((async () => new Response('{}', { status })) as unknown as typeof fetch)
      s.request(['a'])
      await flush()
      expect(updates[updates.length - 1]).toEqual({ status: 'error', options: [], ...want })
    }
  })

  it('reports a network failure and an empty answer as errors', async () => {
    const a = setup((async () => { throw new TypeError('offline') }) as unknown as typeof fetch)
    a.s.request(['a'])
    await flush()
    expect(a.updates[a.updates.length - 1].message).toBe('Could not get replies. Try again.')
    const b = setup((async () => streamResponse(sse('nothing useful'))) as unknown as typeof fetch)
    b.s.request(['a'])
    await flush()
    expect(b.updates[b.updates.length - 1].status).toBe('error')
  })

  it('treats a code that cannot be a header as a wrong code without calling fetch', async () => {
    const f = vi.fn()
    const { s, updates } = setup(f as unknown as typeof fetch, 'код')
    s.request(['a'])
    await flush()
    expect(f).not.toHaveBeenCalled()
    expect(updates[updates.length - 1].badCode).toBe(true)
  })

  it('aborts after 15 s without bytes', async () => {
    const { s, updates } = setup(hanging())
    s.request(['a'])
    await vi.advanceTimersByTimeAsync(14_000)
    expect(updates.every((u) => u.status === 'streaming')).toBe(true)
    await vi.advanceTimersByTimeAsync(1100)
    expect(updates[updates.length - 1]).toEqual({ status: 'error', options: [], message: SUGGEST_TIMEOUT_MESSAGE })
  })

  it('aborts when the stream goes quiet, and bytes reset the timer', async () => {
    const m = manualStream()
    const { s, updates } = setup((async () => m.res) as unknown as typeof fetch)
    s.request(['a'])
    await vi.advanceTimersByTimeAsync(10_000)
    m.push(sse('EN: One')[0])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(updates[updates.length - 1].status).toBe('streaming')
    await vi.advanceTimersByTimeAsync(6000)
    // Changed meaning: one option had arrived, so the stall now ends as done, not as an error.
    expect(updates[updates.length - 1]).toEqual({ status: 'done', options: ['One'] })
    expect(updates.some((u) => u.status === 'error')).toBe(false)
  })

  it('cancel is silent and stops updates', async () => {
    const m = manualStream()
    const { s, updates } = setup((async () => m.res) as unknown as typeof fetch)
    s.request(['a'])
    await flush()
    const n = updates.length
    s.cancel()
    m.push(sse('EN: Late.\n')[0])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(updates.length).toBe(n)
  })

  it('a new request aborts the previous one and stale chunks never reach onUpdate', async () => {
    const first = manualStream()
    const second = manualStream()
    const f = vi.fn().mockResolvedValueOnce(first.res).mockResolvedValueOnce(second.res)
    const { s, updates } = setup(f as unknown as typeof fetch)
    s.request(['one'])
    await flush()
    s.request(['two'])
    await flush()
    first.push(sse('EN: Old reply.\n')[0])
    await flush()
    second.push(sse('EN: New reply.\n')[0])
    await flush()
    expect(updates.some((u) => u.options.includes('Old reply.'))).toBe(false)
    expect(updates[updates.length - 1].options).toEqual(['New reply.'])
    second.close()
    await flush()
    expect(updates[updates.length - 1]).toEqual({ status: 'done', options: ['New reply.'] })
    const signal = (f.mock.calls[0] as unknown as [string, RequestInit])[1].signal as AbortSignal
    expect(signal.aborted).toBe(true)
  })

  it('an aborted request that is replaced does not report a timeout or error', async () => {
    const { s, updates } = setup(hanging())
    s.request(['a'])
    await flush()
    s.request(['b'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(updates.filter((u) => u.status === 'error')).toHaveLength(0)
  })

  it('emits only when the options changed, plus the final done', async () => {
    const m = manualStream()
    const { s, updates } = setup((async () => m.res) as unknown as typeof fetch)
    s.request(['a'])
    await flush()
    m.push(sse('EN: Sure')[0])
    await flush()
    const n = updates.length
    // A chunk that adds no visible option text: the first line is still being typed.
    m.push(sse('')[0])
    m.push(sse('')[0])
    await flush()
    expect(updates.length).toBe(n)
    m.push(sse(', so\n')[0])
    await flush()
    expect(updates.length).toBe(n + 1)
    m.close()
    await flush()
    expect(updates[updates.length - 1]).toEqual({ status: 'done', options: ['Sure, so'] })
  })

  it('finishes with the options it has when the stream fails after some arrived', async () => {
    const m = manualStream()
    const { s, updates } = setup((async () => m.res) as unknown as typeof fetch)
    s.request(['a'])
    await flush()
    m.push(sse('EN: One.\nEN: Two.\n')[0])
    await flush()
    m.res.body!.cancel().catch(() => {})
    await vi.advanceTimersByTimeAsync(16_000)
    const last = updates[updates.length - 1]
    expect(last.status).toBe('done')
    expect(last.options).toEqual(['One.', 'Two.'])
    expect(updates.some((u) => u.status === 'error')).toBe(false)
  })

  it('still reports a timeout when no option arrived', async () => {
    const m = manualStream()
    const { s, updates } = setup((async () => m.res) as unknown as typeof fetch)
    s.request(['a'])
    await vi.advanceTimersByTimeAsync(16_000)
    expect(updates[updates.length - 1]).toMatchObject({ status: 'error', message: SUGGEST_TIMEOUT_MESSAGE })
  })

  it('sends only the last lines and the first context characters', async () => {
    const f = vi.fn(async () => streamResponse(sse('EN: Ok.\n')))
    const updates: SuggestUpdate[] = []
    const s = createSuggester({
      getCode: () => 'fictional-code-0123456789abcdef',
      getContext: () => 'c'.repeat(MAX_CONTEXT_CHARS + 10),
      onUpdate: (u) => updates.push(u),
      fetchImpl: f as unknown as typeof fetch
    })
    s.request(Array.from({ length: MAX_LINES + 5 }, (_, i) => `line ${i}`))
    await flush()
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.lines).toHaveLength(MAX_LINES)
    expect(body.lines[0]).toBe('line 5')
    expect(body.lines[MAX_LINES - 1]).toBe(`line ${MAX_LINES + 4}`)
    expect(body.context).toHaveLength(MAX_CONTEXT_CHARS)
  })
})
