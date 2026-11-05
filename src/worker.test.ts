import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from './worker'
import { SONIOX_TEMP_KEY_URL } from './soniox-url'
import { OPENCODE_CHAT_URL } from './opencode-url'

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
