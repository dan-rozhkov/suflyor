import { isMissingKey } from './chapters'
import { BAD_CODE_MESSAGE, isHeaderSafe } from './token'
import type { AskTurn } from './ask-prompt'

export const ASK_FAILED_MESSAGE = 'Could not answer. Try again.'
export const ASK_TIMEOUT_MESSAGE = 'The answer is taking too long. Try again.'
export const ASK_NOT_SET_UP_MESSAGE = 'Questions are not set up yet.'
export const ASK_TOO_LONG_MESSAGE = 'The notes are too long to ask about.'
export const ASK_TIMEOUT_MS = 60_000

export type AskResult = { ok: true; answer: string } | { ok: false; message: string; badCode?: true }

export interface AskRequest {
  code: string
  sources: string
  question: string
  history: AskTurn[]
  language: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export async function requestAnswer({ code, sources, question, history, language, signal, fetchImpl }: AskRequest): Promise<AskResult> {
  if (!isHeaderSafe(code)) return { ok: false, message: BAD_CODE_MESSAGE, badCode: true }
  const doFetch: typeof fetch = fetchImpl ?? ((...a) => fetch(...a))
  const ctrl = new AbortController()
  let timedOut = false
  const onAbort = (): void => ctrl.abort()
  if (signal?.aborted) return { ok: false, message: '' }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, ASK_TIMEOUT_MS)
  try {
    const res = await doFetch('/api/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sources, question, history, language }),
      signal: ctrl.signal
    })
    if (res.status === 401) return { ok: false, message: BAD_CODE_MESSAGE, badCode: true }
    if (res.status === 413) return { ok: false, message: ASK_TOO_LONG_MESSAGE }
    if (await isMissingKey(res)) return { ok: false, message: ASK_NOT_SET_UP_MESSAGE }
    if (!res.ok) return { ok: false, message: ASK_FAILED_MESSAGE }
    const answer = ((await res.json()) as { answer?: unknown } | null)?.answer
    return typeof answer === 'string' && answer.trim() ? { ok: true, answer } : { ok: false, message: ASK_FAILED_MESSAGE }
  } catch {
    if (signal?.aborted) return { ok: false, message: '' }
    return { ok: false, message: timedOut ? ASK_TIMEOUT_MESSAGE : ASK_FAILED_MESSAGE }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
