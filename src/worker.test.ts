import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from './worker'
import { SONIOX_TEMP_KEY_URL } from './soniox-url'

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
