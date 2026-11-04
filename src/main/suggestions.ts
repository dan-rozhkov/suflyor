/**
 * OpenCode streaming chat completion -> Suggestion updates. Debounce (~1.2 s), AbortController, demo mode.
 * The API key is only used in the Authorization header and never appears in errors or logs.
 */
import type { AppError, Suggestion, SuggestionTrigger, Utterance } from '../shared/types'
import { buildMessages } from './suggestions-prompt'
import { extractDelta, SseSplitter, SuggestionParser } from './suggestions-parser'

export const OPENCODE_URL = 'https://opencode.ai/inference/openai/v1/chat/completions'
export const AUTO_DEBOUNCE_MS = 1200
/** No bytes from OpenCode for this long: the request fails with a 'network' error. */
export const STREAM_IDLE_TIMEOUT_MS = 15_000
const DEMO_DELAY_MS = 120

export interface SuggestionsSink {
  /** Upsert by suggestion.id; each call carries the full parsed state so far. */
  suggestion(suggestion: Suggestion): void
  error(error: AppError): void
}

export interface SuggestionsDeps {
  sink: SuggestionsSink
  /** OpenCode key, main-process only. */
  getApiKey(): string | undefined
  getModel(): string
  isAutoEnabled(): boolean
  /** Markdown context text, '' if none. Treat as data. */
  getContextText(): string
  /** Last utterances, oldest first. */
  getTranscript(): Utterance[]
  /** True when SUFLYOR_DEMO=1: emit fake suggestions, no network. */
  demo: boolean
  /** Per-chunk idle timeout, default 15 s. Tests override. */
  idleTimeoutMs?: number
}

export interface SuggestionsController {
  /** Manual suggest. Cancels any in-flight request first. */
  request(trigger?: SuggestionTrigger): Promise<void>
  /** Feed every utterance update. Final one + ~1.2 s pause triggers an auto request; any new utterance cancels in-flight. */
  onUtterance(utterance: Utterance): void
  /** Abort in-flight request and pending debounce (e.g. on session stop). */
  cancel(): void
  dispose(): void
}

const DEMO_OPTIONS = [
  'Sure, that works for me. Could you share the details?',
  'Thanks for the update. What are the next steps on your side?',
  'I need a bit more time to think it over. Can we sync tomorrow?'
]
const DEMO_MEANING =
  'Первый вариант: согласиться и попросить детали. Второй: уточнить дальнейшие шаги. Третий: взять паузу и вернуться завтра.'

class RequestError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message)
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
}

function httpError(status: number): AppError {
  if (status === 401 || status === 403) {
    return { code: 'api', message: 'OpenCode rejected the key. Check it in Settings.', detail: `HTTP ${status}` }
  }
  if (status === 429) {
    return { code: 'api', message: 'Too many OpenCode requests. Try again soon.', detail: 'HTTP 429' }
  }
  return { code: 'api', message: 'OpenCode returned an error. Try again.', detail: `HTTP ${status}` }
}

export function createSuggestions(deps: SuggestionsDeps): SuggestionsController {
  let debounce: ReturnType<typeof setTimeout> | null = null
  let current: { ac: AbortController; state: Suggestion } | null = null
  let counter = 0
  let disposed = false
  /** Utterance the pending debounce was armed for. */
  let pendingFor: string | null = null
  /** Ids already seen as final: later updates to them (e.g. a late translation) never cancel anything. */
  const finalSeen = new Set<string>()
  const idleMs = deps.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS

  function clearDebounce(): void {
    if (debounce) clearTimeout(debounce)
    debounce = null
    pendingFor = null
  }

  function abortInFlight(): void {
    const c = current
    if (!c) return
    current = null
    c.ac.abort()
    if (c.state.status === 'streaming') {
      deps.sink.suggestion({ ...c.state, status: 'cancelled' })
    }
  }

  function cancel(): void {
    clearDebounce()
    abortInFlight()
  }

  async function stream(ac: AbortController, state: Suggestion, messages: ReturnType<typeof buildMessages>): Promise<void> {
    const emit = (patch: Partial<Suggestion>): void => {
      if (ac.signal.aborted) return
      Object.assign(state, patch)
      deps.sink.suggestion({ ...state, options: [...state.options] })
    }
    const parser = new SuggestionParser()

    if (deps.demo) {
      const text = DEMO_OPTIONS.map((o) => `EN: ${o}`).join('\n') + `\nRU: ${DEMO_MEANING}\n`
      for (let i = 0; i < text.length; i += 24) {
        await sleep(DEMO_DELAY_MS, ac.signal)
        const p = parser.push(text.slice(i, i + 24))
        emit({ options: p.options, meaningRu: p.meaningRu })
      }
      const p = parser.end()
      emit({ options: p.options, meaningRu: p.meaningRu, status: 'done' })
      return
    }

    const key = deps.getApiKey()?.trim()
    if (!key) {
      throw new RequestError({ code: 'no-keys', message: 'Add your OpenCode key in Settings.' })
    }

    // Linked controller: lets the idle timer abort the network without looking like a user cancel.
    const net = new AbortController()
    ac.signal.addEventListener('abort', () => net.abort(), { once: true })
    let timedOut = false
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    const arm = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        timedOut = true
        net.abort()
      }, idleMs)
    }
    const timeoutError = (): RequestError =>
      new RequestError({ code: 'network', message: 'OpenCode is not responding. Try again.', detail: 'idle timeout' })
    arm()

    const send = (withReasoning: boolean): Promise<Response> =>
      fetch(OPENCODE_URL, {
        method: 'POST',
        signal: net.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Accept: 'text/event-stream' },
        body: JSON.stringify({
          model: deps.getModel(),
          messages,
          stream: true,
          max_tokens: 700,
          temperature: 0.7,
          // Measured: first token ~1.1 s with 'none' vs 3-4 s without. Some models reject the field (400): retry once without.
          ...(withReasoning ? { reasoning_effort: 'none' } : {})
        })
      })
    let res: Response
    try {
      res = await send(true)
      if (res.status === 400) {
        void res.body?.cancel().catch(() => {})
        res = await send(false)
      }
    } catch (e) {
      if (idleTimer) clearTimeout(idleTimer)
      if (timedOut && !ac.signal.aborted) throw timeoutError()
      if (isAbort(e)) throw e
      throw new RequestError({ code: 'network', message: "Couldn't reach OpenCode. Check your connection." })
    }
    if (!res.ok) {
      if (idleTimer) clearTimeout(idleTimer)
      void res.body?.cancel().catch(() => {})
      throw new RequestError(httpError(res.status))
    }
    if (!res.body) {
      if (idleTimer) clearTimeout(idleTimer)
    }
    if (!res.body) throw new RequestError({ code: 'api', message: 'OpenCode returned an empty response.' })

    const decoder = new TextDecoder()
    const sse = new SseSplitter()
    const reader = res.body.getReader()
    let done = false
    try {
      while (!done) {
        const { value, done: d } = await reader.read()
        if (d) break
        arm()
        for (const payload of sse.push(decoder.decode(value, { stream: true }))) {
          if (payload === '[DONE]') {
            done = true
            break
          }
          const delta = extractDelta(payload)
          if (delta) {
            const p = parser.push(delta)
            emit({ options: p.options, meaningRu: p.meaningRu })
          }
        }
      }
    } catch (e) {
      if (timedOut && !ac.signal.aborted) throw timeoutError()
      if (isAbort(e)) throw e
      throw new RequestError({ code: 'network', message: 'The OpenCode connection dropped.' })
    } finally {
      if (idleTimer) clearTimeout(idleTimer)
      void reader.cancel().catch(() => {})
    }
    const p = parser.end()
    if (p.options.length === 0) {
      throw new RequestError({ code: 'api', message: 'The model returned no replies. Try again.' })
    }
    emit({ options: p.options, meaningRu: p.meaningRu, status: 'done' })
  }

  async function request(trigger: SuggestionTrigger = 'manual'): Promise<void> {
    if (disposed) return
    cancel()
    const transcript = deps.getTranscript()
    // Auto requests without a key stay silent; the error is for manual presses only.
    if (trigger === 'auto' && !deps.demo && !deps.getApiKey()?.trim()) return
    const finals = transcript.filter((u) => u.isFinal && u.en.trim())
    if (finals.length === 0) {
      if (trigger === 'manual') {
        deps.sink.error({ code: 'unknown', message: 'Nothing to reply to yet.' })
      }
      return
    }
    const ac = new AbortController()
    const state: Suggestion = {
      id: `sg-${Date.now().toString(36)}-${++counter}`,
      utteranceId: finals[finals.length - 1].id,
      trigger,
      status: 'streaming',
      options: [],
      meaningRu: ''
    }
    current = { ac, state }
    deps.sink.suggestion({ ...state })
    try {
      await stream(ac, state, buildMessages(deps.getContextText(), transcript))
    } catch (e) {
      if (ac.signal.aborted || isAbort(e)) return // already reported as cancelled by whoever aborted
      const err: AppError =
        e instanceof RequestError ? e.appError : { code: 'unknown', message: "Couldn't get a suggestion." }
      deps.sink.suggestion({ ...state, status: 'error' })
      deps.sink.error(err)
    } finally {
      if (current?.ac === ac) current = null
    }
  }

  return {
    request,
    onUtterance(u) {
      if (disposed) return
      // An update to an utterance that is already final (late translation) changes nothing.
      if (finalSeen.has(u.id)) return
      if (u.isFinal) {
        finalSeen.add(u.id)
        if (finalSeen.size > 500) finalSeen.delete(finalSeen.values().next().value as string)
      }
      const hasText = u.en.trim() !== ''
      if (hasText) {
        // A new utterance started: drop a pending debounce and an in-flight AUTO request (never a manual one).
        if (debounce && u.id !== pendingFor) clearDebounce()
        if (current && current.state.trigger === 'auto' && u.id !== current.state.utteranceId) abortInFlight()
      }
      if (!u.isFinal || !hasText || !deps.isAutoEnabled()) return
      clearDebounce()
      pendingFor = u.id
      debounce = setTimeout(() => {
        debounce = null
        pendingFor = null
        if (deps.isAutoEnabled()) void request('auto')
      }, AUTO_DEBOUNCE_MS)
    },
    cancel,
    dispose() {
      cancel()
      disposed = true
    }
  }
}
