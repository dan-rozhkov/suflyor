import { SseSplitter, SuggestionParser, extractDelta } from './suggestions-parser'
import { MAX_CONTEXT_CHARS, MAX_LINES } from './suggest-prompt'
import { BAD_CODE_MESSAGE, isHeaderSafe } from './token'

export const SUGGEST_TIMEOUT_MESSAGE = 'The replies are not responding. Try again.'
export const SUGGEST_NOT_SET_UP_MESSAGE = 'Reply suggestions are not set up yet.'
export const SUGGEST_TOO_LONG_MESSAGE = 'The notes are too long for replies.'
export const SUGGEST_FAILED_MESSAGE = 'Could not get replies. Try again.'
export const SUGGEST_IDLE_MS = 15_000

export interface SuggestUpdate {
  status: 'streaming' | 'done' | 'error'
  options: string[]
  message?: string
  /** Set on an error caused by a wrong access code (401): the app shows the code form. */
  badCode?: boolean
}

export interface SuggesterDeps {
  getCode: () => string
  getContext: () => string
  onUpdate: (u: SuggestUpdate) => void
  fetchImpl?: typeof fetch
}

export interface Suggester {
  request(lines: string[]): void
  cancel(): void
}

function sameOptions(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

export function createSuggester(deps: SuggesterDeps): Suggester {
  const doFetch: typeof fetch = deps.fetchImpl ?? ((...a) => fetch(...a))
  let current: { ctrl: AbortController } | null = null

  function cancel(): void {
    const c = current
    current = null
    c?.ctrl.abort()
  }

  async function run(mine: { ctrl: AbortController }, lines: string[]): Promise<void> {
    const alive = (): boolean => current === mine
    const emit = (u: SuggestUpdate): void => {
      if (alive()) deps.onUpdate(u)
    }
    const fail = (message: string, badCode = false): void => {
      emit({ status: 'error', options: [], message, ...(badCode ? { badCode: true } : {}) })
      if (alive()) current = null
    }
    let options: string[] = []
    let timedOut = false
    let idle: ReturnType<typeof setTimeout> | undefined
    const arm = (): void => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        timedOut = true
        mine.ctrl.abort()
      }, SUGGEST_IDLE_MS)
    }
    const code = deps.getCode()
    if (!isHeaderSafe(code)) {
      fail(BAD_CODE_MESSAGE, true)
      return
    }
    let shown: string[] = []
    emit({ status: 'streaming', options: [] })
    arm()
    try {
      const res = await doFetch('/api/suggest', {
        method: 'POST',
        headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: lines.slice(-MAX_LINES), context: deps.getContext().slice(0, MAX_CONTEXT_CHARS) }),
        signal: mine.ctrl.signal
      })
      if (!alive()) return
      if (res.status === 401) return fail(BAD_CODE_MESSAGE, true)
      if (res.status === 413) return fail(SUGGEST_TOO_LONG_MESSAGE)
      if (res.status === 503) return fail(SUGGEST_NOT_SET_UP_MESSAGE)
      if (!res.ok || !res.body) return fail(SUGGEST_FAILED_MESSAGE)
      arm()
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const splitter = new SseSplitter()
      const parser = new SuggestionParser()
      // A body that ignores the signal must still stop when the request is aborted.
      const aborted = new Promise<never>((_, reject) => {
        mine.ctrl.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
      aborted.catch(() => {})
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), aborted])
        if (!alive()) {
          void reader.cancel().catch(() => {})
          return
        }
        if (done) break
        arm()
        for (const payload of splitter.push(decoder.decode(value, { stream: true }))) {
          const delta = extractDelta(payload)
          if (delta) options = parser.push(delta).options
        }
        if (!sameOptions(options, shown)) {
          shown = options
          emit({ status: 'streaming', options })
        }
      }
      options = parser.end().options
      if (!options.length) return fail(SUGGEST_FAILED_MESSAGE)
      emit({ status: 'done', options })
      if (alive()) current = null
    } catch {
      if (!alive()) return
      if (options.length) {
        // The stream broke after some replies arrived: keep them.
        emit({ status: 'done', options })
        if (alive()) current = null
        return
      }
      fail(timedOut ? SUGGEST_TIMEOUT_MESSAGE : SUGGEST_FAILED_MESSAGE)
    } finally {
      clearTimeout(idle)
    }
  }

  return {
    request(lines) {
      cancel()
      const mine = { ctrl: new AbortController() }
      current = mine
      void run(mine, lines)
    },
    cancel
  }
}
