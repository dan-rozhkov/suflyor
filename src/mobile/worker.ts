import { SONIOX_TEMP_KEY_URL } from './soniox-url'

export interface Env {
  SONIOX_API_KEY: string
  ACCESS_CODE: string
}


/** A shorter code can be brute-forced, so the Worker refuses every request until it is longer. */
const MIN_CODE_LENGTH = 24

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** Constant-time compare: both sides are hashed, so the lengths always match. */
async function codeMatches(given: string, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < MIN_CODE_LENGTH) return false
  const [a, b] = await Promise.all([sha256(given), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function bearer(request: Request): string {
  const m = /^Bearer (.*)$/i.exec(request.headers.get('Authorization') ?? '')
  return m ? m[1].trim() : ''
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, { Allow: 'POST' })
  if (!(await codeMatches(bearer(request), env.ACCESS_CODE))) return json({ error: 'bad-code' }, 401)
  try {
    const res = await fetch(SONIOX_TEMP_KEY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SONIOX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usage_type: 'transcribe_websocket', expires_in_seconds: 60,
        single_use: true,
        max_session_duration_seconds: 3600
      })
    })
    if (!res.ok) return json({ error: 'upstream' }, 502)
    const data = (await res.json()) as { api_key?: unknown; expires_at?: unknown }
    if (typeof data.api_key !== 'string' || !data.api_key) return json({ error: 'upstream' }, 502)
    return json({ api_key: data.api_key, expires_at: data.expires_at }, 200)
  } catch {
    return json({ error: 'upstream' }, 502)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/token') return handleToken(request, env)
    return json({ error: 'not-found' }, 404)
  }
}
