import { describe, expect, it, vi } from 'vitest'
import { fetchToken, TokenError } from './token'

const res = (status: number, body: unknown): Response => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

async function kindOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
  } catch (e) {
    return e instanceof TokenError ? e.kind : 'other'
  }
  return undefined
}

describe('fetchToken', () => {
  it('posts the code as a bearer and returns the key', async () => {
    const f = vi.fn(async () => res(200, { api_key: 'k1', expires_at: 'x' }))
    expect(await fetchToken('abc', f as unknown as typeof fetch)).toBe('k1')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/token')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc')
  })

  it('refuses a code that a header cannot carry, without a request', async () => {
    const f = vi.fn()
    expect(await kindOf(fetchToken('код-доступа', f as unknown as typeof fetch))).toBe('bad-code')
    expect(f).not.toHaveBeenCalled()
  })

  it('gives the request a timeout', async () => {
    const f = vi.fn(async () => res(200, { api_key: 'k1' }))
    await fetchToken('abc', f as unknown as typeof fetch)
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps 401 to bad-code', async () => {
    expect(await kindOf(fetchToken('x', (async () => res(401, { error: 'bad-code' })) as unknown as typeof fetch))).toBe('bad-code')
  })

  it('maps a thrown fetch to network', async () => {
    expect(await kindOf(fetchToken('x', (async () => { throw new TypeError('offline') }) as unknown as typeof fetch))).toBe('network')
  })

  it('maps 502 and bad bodies to server', async () => {
    expect(await kindOf(fetchToken('x', (async () => res(502, { error: 'upstream' })) as unknown as typeof fetch))).toBe('server')
    expect(await kindOf(fetchToken('x', (async () => res(200, 'not json')) as unknown as typeof fetch))).toBe('server')
    expect(await kindOf(fetchToken('x', (async () => res(200, {})) as unknown as typeof fetch))).toBe('server')
  })
})
