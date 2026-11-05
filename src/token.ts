export type TokenErrorKind = 'bad-code' | 'network' | 'server'

export const BAD_CODE_MESSAGE = 'This access code is wrong.'

const TOKEN_TIMEOUT_MS = 8000

export class TokenError extends Error {
  constructor(
    readonly kind: TokenErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'TokenError'
  }
}

/** Ask the Worker for a short-lived Soniox key. */
export async function fetchToken(code: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<string> {
  // A header cannot carry other characters, and fetch would report that as a network failure.
  if (!/^[\x21-\x7e]+$/.test(code)) throw new TokenError('bad-code', BAD_CODE_MESSAGE)
  let res: Response
  try {
    res = await fetchImpl('/api/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${code}` },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
    })
  } catch {
    throw new TokenError('network', 'Could not reach the server.')
  }
  if (res.status === 401) throw new TokenError('bad-code', BAD_CODE_MESSAGE)
  if (!res.ok) throw new TokenError('server', 'The server could not get a key.')
  try {
    const data = (await res.json()) as { api_key?: unknown }
    if (typeof data.api_key === 'string' && data.api_key) return data.api_key
  } catch {
    /* fall through */
  }
  throw new TokenError('server', 'The server could not get a key.')
}
