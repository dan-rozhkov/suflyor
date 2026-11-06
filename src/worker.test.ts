import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from './worker'
import { SONIOX_TEMP_KEY_URL } from './soniox-url'
import { OPENCODE_CHAT_URL } from './opencode-url'
import { MAX_CONTEXT_CHARS } from './suggest-prompt'
import { MAX_SUMMARY_BODY_BYTES, MAX_SUMMARY_CHARS, MAX_SUMMARY_LINES } from './summary-limits'

const env: Env = { SONIOX_API_KEY: 'master-key-xyz', ACCESS_CODE: 'fictional-code-0123456789abcdef' }
const call = (init: RequestInit & { path?: string } = {}, e: Env = env): Promise<Response> =>
  worker.fetch(new Request(`https://x.test${init.path ?? '/api/token'}`, { method: 'POST', ...init }), e)

afterEach(() => vi.unstubAllGlobals())

describe('worker /api/token', () => {
  it('refuses a missing header', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'bad-code' })
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses a wrong code', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const res = await call({ headers: { Authorization: 'Bearer nope' } })
    expect(res.status).toBe(401)
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses an empty or unset ACCESS_CODE even with an empty bearer', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    for (const code of ['', undefined as unknown as string]) {
      const res = await call({ headers: { Authorization: 'Bearer ' } }, { ...env, ACCESS_CODE: code })
      expect(res.status).toBe(401)
      const res2 = await call({}, { ...env, ACCESS_CODE: code })
      expect(res2.status).toBe(401)
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses every request when ACCESS_CODE is shorter than 24 characters', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const short = 'a'.repeat(23)
    const res = await call({ headers: { Authorization: `Bearer ${short}` } }, { ...env, ACCESS_CODE: short })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'bad-code' })
    expect(f).not.toHaveBeenCalled()
  })

  it('accepts an ACCESS_CODE of exactly 24 characters', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ api_key: 'temp-2' }), { status: 201 }))
    vi.stubGlobal('fetch', f)
    const code = 'b'.repeat(24)
    const res = await call({ headers: { Authorization: `Bearer ${code}` } }, { ...env, ACCESS_CODE: code })
    expect(res.status).toBe(200)
  })

  it('returns a temporary key and sends the master key only to Soniox', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ api_key: 'temp-1', expires_at: '2030-01-01T00:00:00Z' }), { status: 201 }))
    vi.stubGlobal('fetch', f)
    const res = await call({ headers: { Authorization: 'Bearer fictional-code-0123456789abcdef' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ api_key: 'temp-1', expires_at: '2030-01-01T00:00:00Z' })
    expect(text).not.toContain('master-key-xyz')
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(SONIOX_TEMP_KEY_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer master-key-xyz')
    expect(JSON.parse(init.body as string)).toEqual({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: 60,
      single_use: true,
      max_session_duration_seconds: 3600
    })
  })

  it('gives 502 on an upstream failure without leaking', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad master-key-xyz detail', { status: 401 })))
    const res = await call({ headers: { Authorization: 'Bearer fictional-code-0123456789abcdef' } })
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'upstream' })
    expect(text).not.toContain('master-key-xyz')
  })

  it('gives 502 when the upstream fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom master-key-xyz') }))
    const res = await call({ headers: { Authorization: 'Bearer fictional-code-0123456789abcdef' } })
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('master-key-xyz')
  })

  it('gives 404 for other API paths', async () => {
    const res = await call({ path: '/api/other' })
    expect(res.status).toBe(404)
  })

  it('gives 405 for the wrong method on the token route', async () => {
    const res = await call({ method: 'GET' })
    expect(res.status).toBe(405)
  })
})

describe('worker /api/suggest', () => {
  const senv: Env = { ...env, OPENCODE_API_KEY: 'oc-key-xyz' }
  const auth = { Authorization: 'Bearer fictional-code-0123456789abcdef' }
  const post = (body: unknown, e: Env = senv, headers: Record<string, string> = auth): Promise<Response> =>
    call({ path: '/api/suggest', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }, e)
  const sse = (): Response => new Response('data: {"choices":[{"delta":{"content":"EN: Hi."}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/plain' } })

  it('gives 405 for the wrong method', async () => {
    const res = await call({ path: '/api/suggest', method: 'GET' }, senv)
    expect(res.status).toBe(405)
  })

  it('refuses a missing or wrong code without calling upstream', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    for (const h of [{} as Record<string, string>, { Authorization: 'Bearer nope' }]) {
      const res = await post({ lines: ['hi'] }, senv, h)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'bad-code' })
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('gives 503 when the OpenCode key is not set', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const res = await post({ lines: ['hi'] }, env)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no-suggest-key' })
    expect(f).not.toHaveBeenCalled()
  })

  it('gives 413 for a body over 200 KB', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const res = await post({ lines: ['x'.repeat(200 * 1024 + 1)] })
    expect(res.status).toBe(413)
    expect(f).not.toHaveBeenCalled()
  })

  it('gives 400 for invalid JSON or a body without lines', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    for (const b of ['not json', {}, { lines: 'hi' }, { lines: [1] }, 'null']) {
      const res = await post(b)
      expect(res.status).toBe(400)
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('gives 400 for lines or context over the limits, without calling upstream', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const bad: unknown[] = [
      { lines: [] },
      { lines: Array.from({ length: 201 }, () => 'a') },
      { lines: ['x'.repeat(2001)] },
      { lines: ['hi'], context: 'c'.repeat(120_001) }
    ]
    for (const b of bad) {
      const res = await post(b)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad-request' })
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('accepts lines and context exactly at the limits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse()))
    // The 200 KB body cap leaves no room for every maximum at once, so check them in two bodies.
    const a = await post({ lines: Array.from({ length: 200 }, () => 'x'.repeat(100)), context: 'c'.repeat(120_000) })
    expect(a.status).toBe(200)
    const b = await post({ lines: ['x'.repeat(2000)] })
    expect(b.status).toBe(200)
  })

  it('streams the upstream body, fixes the model and limits, and sends the key only to OpenCode', async () => {
    const f = vi.fn(async () => sse())
    vi.stubGlobal('fetch', f)
    const res = await post({ lines: ['Hello there.'], context: 'We sell Nimbus.', model: 'evil', max_tokens: 99999, stream: false, messages: [] })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    const text = await res.text()
    expect(text).toContain('EN: Hi.')
    expect(text).not.toContain('oc-key-xyz')
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(OPENCODE_CHAT_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer oc-key-xyz')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('deepseek-v4.1-flash')
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(700)
    expect(body.temperature).toBe(0.7)
    expect(body.reasoning_effort).toBe('none')
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'reasoning_effort', 'stream', 'temperature'])
    expect(body.messages).toHaveLength(2)
    expect(body.messages[1].content).toContain('Hello there.')
    expect(body.messages[1].content).toContain('We sell Nimbus.')
  })

  it('retries once without reasoning_effort after a 400', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('bad oc-key-xyz', { status: 400 }))
      .mockResolvedValueOnce(sse())
    vi.stubGlobal('fetch', f)
    const res = await post({ lines: ['hi'] })
    expect(res.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
    const first = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    const second = JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
    expect(first.reasoning_effort).toBe('none')
    expect('reasoning_effort' in second).toBe(false)
    expect(second.model).toBe('deepseek-v4.1-flash')
  })

  it('gives 502 without echoing upstream text, also when the retry fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('secret oc-key-xyz detail', { status: 400 })))
    const res = await post({ lines: ['hi'] })
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'upstream' })
    expect(text).not.toContain('oc-key-xyz')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom oc-key-xyz', { status: 500 })))
    const res2 = await post({ lines: ['hi'] })
    expect(res2.status).toBe(502)
    expect(await res2.text()).not.toContain('oc-key-xyz')
  })

  it('gives 502 when the upstream fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom oc-key-xyz') }))
    const res = await post({ lines: ['hi'] })
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('oc-key-xyz')
  })
})

describe('worker /api/chapters', () => {
  const senv: Env = { ...env, OPENCODE_API_KEY: 'oc-key-xyz' }
  const auth = { Authorization: 'Bearer fictional-code-0123456789abcdef' }
  const post = (body: unknown, e: Env = senv, headers: Record<string, string> = auth): Promise<Response> =>
    call({ path: '/api/chapters', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }, e)
  const answer = (content: unknown = '0 | Запуск проекта\n2 | Цена'): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  const sent = (f: ReturnType<typeof vi.fn>, n: number): Record<string, unknown> =>
    JSON.parse((f.mock.calls[n] as unknown as [string, RequestInit])[1].body as string)

  it('gives 405 for the wrong method', async () => {
    const res = await call({ path: '/api/chapters', method: 'GET' }, senv)
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })

  it('refuses a missing or wrong code without calling upstream', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    for (const h of [{} as Record<string, string>, { Authorization: 'Bearer nope' }]) {
      const res = await post({ paragraphs: ['a'] }, senv, h)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'bad-code' })
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('gives 503 when the OpenCode key is not set', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const res = await post({ paragraphs: ['a'] }, env)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no-suggest-key' })
    expect(f).not.toHaveBeenCalled()
  })

  it('gives 413 for a declared or real size over 200 KB', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const real = await post({ paragraphs: ['x'.repeat(200 * 1024 + 1)] })
    expect(real.status).toBe(413)
    const declared = await post({ paragraphs: ['a'] }, senv, { ...auth, 'Content-Length': String(200 * 1024 + 1) })
    expect(declared.status).toBe(413)
    expect(f).not.toHaveBeenCalled()
  })

  it('gives 400 for bad bodies without calling upstream', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const bad: unknown[] = [
      'not json', 'null', {}, { paragraphs: 'a' }, { paragraphs: [1] }, { paragraphs: [] },
      { paragraphs: Array.from({ length: 151 }, () => 'a') },
      { paragraphs: ['x'.repeat(1001)] },
      { paragraphs: ['a'], openTitle: 5 },
      { paragraphs: ['a'], openTitle: 't'.repeat(61) }
    ]
    for (const b of bad) {
      const res = await post(b)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad-request' })
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('accepts the limits exactly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer()))
    const a = await post({ paragraphs: Array.from({ length: 150 }, () => 'я'.repeat(80)), openTitle: 't'.repeat(60) })
    expect(a.status).toBe(200)
    const b = await post({ paragraphs: Array.from({ length: 12 }, () => 'я'.repeat(1000)) })
    expect(b.status).toBe(200)
    const over = await post({ paragraphs: [...Array.from({ length: 12 }, () => 'я'.repeat(1000)), 'я'] })
    expect(over.status).toBe(400)
  })

  it('returns parsed chapters with a non-streaming request that carries the key only to OpenCode', async () => {
    const f = vi.fn(async () => answer())
    vi.stubGlobal('fetch', f)
    const res = await post({ paragraphs: ['Привет.', 'Дальше.', 'Цена.'], openTitle: 'Запуск проекта', model: 'evil', stream: true })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ chapters: [{ start: 0, title: 'Запуск проекта' }, { start: 2, title: 'Цена' }] })
    expect(text).not.toContain('oc-key-xyz')
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(OPENCODE_CHAT_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer oc-key-xyz')
    const body = sent(f, 0)
    expect(body.model).toBe('deepseek-v4.1-flash')
    expect(body.stream).toBe(false)
    expect(body.max_tokens).toBe(400)
    expect(body.temperature).toBe(0.2)
    expect(body.reasoning_effort).toBe('none')
    expect(JSON.stringify(body.messages)).toContain('[2] Цена.')
    expect(JSON.stringify(body.messages)).toContain('Запуск проекта')
  })

  it('retries once without reasoning_effort after a 400', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('bad', { status: 400 })).mockResolvedValueOnce(answer())
    vi.stubGlobal('fetch', f)
    const res = await post({ paragraphs: ['a', 'b', 'c'] })
    expect(res.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
    expect(sent(f, 0).reasoning_effort).toBe('none')
    expect('reasoning_effort' in sent(f, 1)).toBe(false)
    expect(sent(f, 1).stream).toBe(false)
  })

  it('gives 502 for upstream errors, bad JSON, no content or no chapters', async () => {
    const cases: Response[] = [
      new Response('boom oc-key-xyz', { status: 500 }),
      new Response('boom', { status: 400 }),
      new Response('not json', { status: 200 }),
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      answer(''),
      answer(null),
      answer('no chapters here'),
      answer('7 | Вне диапазона')
    ]
    for (const r of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => r.clone()))
      const res = await post({ paragraphs: ['a', 'b'] })
      expect(res.status).toBe(502)
      const text = await res.text()
      expect(JSON.parse(text)).toEqual({ error: 'upstream' })
      expect(text).not.toContain('oc-key-xyz')
    }
  })

  it('gives 502 when the upstream fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom oc-key-xyz') }))
    const res = await post({ paragraphs: ['a'] })
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('oc-key-xyz')
  })

  it('leaves the suggest request unchanged', async () => {
    const f = vi.fn(async () => new Response('data: [DONE]\n\n', { status: 200 }))
    vi.stubGlobal('fetch', f)
    const res = await call({ path: '/api/suggest', headers: auth, body: JSON.stringify({ lines: ['hi'] }) }, senv)
    expect(res.status).toBe(200)
    const body = sent(f, 0)
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBe(700)
    expect(body.temperature).toBe(0.7)
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'reasoning_effort', 'stream', 'temperature'])
  })
})

describe('worker /api/summary', () => {
  const senv: Env = { ...env, OPENCODE_API_KEY: 'oc-key-xyz' }
  const auth = { Authorization: 'Bearer fictional-code-0123456789abcdef' }
  const post = (body: unknown, e: Env = senv, headers: Record<string, string> = auth): Promise<Response> =>
    call({ path: '/api/summary', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }, e)
  const NOTES = 'TITLE: Запуск пилота\nACTION: Анна | Отправить договор\nOVERVIEW:\n- Команда обсудила пилот.\nTOPIC: Сроки пилота\n- Старт в мае.'
  const answer = (content: unknown = NOTES): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })
  const sent = (f: ReturnType<typeof vi.fn>, n: number): Record<string, unknown> =>
    JSON.parse((f.mock.calls[n] as unknown as [string, RequestInit])[1].body as string)

  it('gives 405 for the wrong method', async () => {
    const res = await call({ path: '/api/summary', method: 'GET' }, senv)
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('POST')
  })

  it('refuses a missing or wrong code without calling upstream', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    for (const h of [{} as Record<string, string>, { Authorization: 'Bearer nope' }]) {
      const res = await post({ lines: ['a'] }, senv, h)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'bad-code' })
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('gives 503 when the OpenCode key is not set', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const res = await post({ lines: ['a'] }, env)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'no-suggest-key' })
    expect(f).not.toHaveBeenCalled()
  })

  it('gives 413 for a declared or real size over the summary limit', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const real = await post({ lines: ['x'.repeat(MAX_SUMMARY_BODY_BYTES + 1)] })
    expect(real.status).toBe(413)
    const declared = await post({ lines: ['a'] }, senv, { ...auth, 'Content-Length': String(MAX_SUMMARY_BODY_BYTES + 1) })
    expect(declared.status).toBe(413)
    expect(f).not.toHaveBeenCalled()
  })

  it('accepts a body bigger than the 200 KB limit of the other routes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer()))
    const body = JSON.stringify({ lines: ['я'.repeat(115_000)] })
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(200 * 1024)
    expect(new TextEncoder().encode(body).length).toBeLessThan(MAX_SUMMARY_BODY_BYTES)
    const res = await post(body)
    expect(res.status).toBe(200)
  })

  it('gives 400 for bad bodies without calling upstream', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const bad: unknown[] = [
      'not json', 'null', {}, { lines: 'a' }, { lines: [1] }, { lines: [] },
      { lines: Array.from({ length: MAX_SUMMARY_LINES + 1 }, () => 'a') },
      { lines: ['я'.repeat(MAX_SUMMARY_CHARS), 'я'] },
      { lines: ['a'], context: 5 },
      { lines: ['a'], context: 'c'.repeat(MAX_CONTEXT_CHARS + 1) }
    ]
    for (const b of bad) {
      const res = await post(b)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad-request' })
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('accepts the limits exactly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => answer()))
    const a = await post({ lines: Array.from({ length: MAX_SUMMARY_LINES }, () => 'a'), context: 'c'.repeat(MAX_CONTEXT_CHARS) })
    expect(a.status).toBe(200)
    const b = await post({ lines: ['я'.repeat(MAX_SUMMARY_CHARS)] })
    expect(b.status).toBe(200)
  })

  it('returns the parsed summary with a non-streaming request that carries the key only to OpenCode', async () => {
    const f = vi.fn(async () => answer())
    vi.stubGlobal('fetch', f)
    const res = await post({ lines: ['We ship in May.', 'Okay.'], context: 'Acme pilot', model: 'evil', stream: true })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({
      summary: {
        title: 'Запуск пилота',
        actionItems: [{ owner: 'Анна', task: 'Отправить договор' }],
        overview: ['Команда обсудила пилот.'],
        topics: [{ title: 'Сроки пилота', bullets: ['Старт в мае.'] }]
      }
    })
    expect(text).not.toContain('oc-key-xyz')
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(OPENCODE_CHAT_URL)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer oc-key-xyz')
    const body = sent(f, 0)
    expect(body.model).toBe('deepseek-v4.1-flash')
    expect(body.stream).toBe(false)
    expect(body.max_tokens).toBe(8000)
    expect(body.temperature).toBe(0.2)
    expect(body.reasoning_effort).toBe('none')
    expect(JSON.stringify(body.messages)).toContain('We ship in May.')
    expect(JSON.stringify(body.messages)).toContain('Acme pilot')
  })

  it('retries once without reasoning_effort after a 400', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('bad', { status: 400 })).mockResolvedValueOnce(answer())
    vi.stubGlobal('fetch', f)
    const res = await post({ lines: ['a'] })
    expect(res.status).toBe(200)
    expect(f).toHaveBeenCalledTimes(2)
    expect(sent(f, 0).reasoning_effort).toBe('none')
    expect('reasoning_effort' in sent(f, 1)).toBe(false)
    expect(sent(f, 1).stream).toBe(false)
    expect(sent(f, 1).max_tokens).toBe(8000)
  })

  it('gives 502 for upstream errors, bad JSON, no content or unusable text', async () => {
    const cases: Response[] = [
      new Response('boom oc-key-xyz', { status: 500 }),
      new Response('boom', { status: 400 }),
      new Response('not json', { status: 200 }),
      new Response(JSON.stringify({ choices: [] }), { status: 200 }),
      answer(''),
      answer(null),
      answer('Sorry, I cannot do that.'),
      answer('TITLE: Только заголовок')
    ]
    for (const r of cases) {
      vi.stubGlobal('fetch', vi.fn(async () => r.clone()))
      const res = await post({ lines: ['a'] })
      expect(res.status).toBe(502)
      const text = await res.text()
      expect(JSON.parse(text)).toEqual({ error: 'upstream' })
      expect(text).not.toContain('oc-key-xyz')
    }
  })

  it('gives 502 when the upstream fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom oc-key-xyz') }))
    const res = await post({ lines: ['a'] })
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('oc-key-xyz')
  })
})
