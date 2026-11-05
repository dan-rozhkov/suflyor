/**
 * Microphone side of a session: second audio helper (`--mic`) feeding a second, transcription-only Soniox session.
 * Orchestration only, no Electron imports (wired in ipc.ts), so the failure rule is unit tested:
 *
 *   A mic problem must never stop translation. Any mic failure stops only the mic parts, shows one toast, and never
 *   touches the main session or its status. Reconnects of the mic session are silent.
 */
import type { AppError, Utterance } from '../shared/types'
import { stripFillers } from './fillers'

export const MIC_PERMISSION_TOAST = "Microphone access is off. Suggestions can't hear you."
export const MIC_STOPPED_TOAST = 'Microphone stopped. Translation is still on.'

export interface MicDeps {
  /** The Microphone setting. */
  enabled(): boolean
  /** True while the main session is starting, listening or reconnecting. */
  isMainRunning(): boolean
  /** True when macOS lets us record. Asks the user first if undecided. Must not throw (a throw counts as denied). */
  requestAccess(): Promise<boolean>
  helper: { start(): void; stop(): void }
  session: { start(): Promise<unknown>; stop(): Promise<unknown> }
  /** One toast per failure. */
  notify(error: AppError): void
}

export interface MicController {
  /** Start the mic parts if enabled and the main session runs. Never blocks on the permission prompt for the caller. */
  start(): Promise<void>
  /** Stop the mic parts silently. Safe to call any time. */
  stop(): void
  /** Mic helper or mic session failed. Stops only the mic, toasts once. 'no-keys' is silent (the main session reports it). */
  reportError(error: AppError): void
}

export function createMicController(deps: MicDeps): MicController {
  let running = false
  /** Bumped on every start and stop, so a start that awaited something can tell it was superseded. */
  let run = 0

  const wanted = (my: number): boolean => running && run === my && deps.enabled() && deps.isMainRunning()

  function stop(): void {
    if (!running) return
    running = false
    run += 1
    try {
      deps.helper.stop()
    } catch {
      // ignore
    }
    void deps.session.stop().catch(() => {})
  }

  function reportError(error: AppError): void {
    if (!running) return // already stopped: late events, reconnect noise after a failure
    stop()
    if (error.code === 'no-keys') return
    if (error.code === 'no-mic-permission') {
      deps.notify({ code: 'no-mic-permission', message: MIC_PERMISSION_TOAST, detail: error.detail })
    } else {
      deps.notify({ code: 'mic', message: MIC_STOPPED_TOAST, detail: error.detail ?? error.message })
    }
  }

  async function start(): Promise<void> {
    if (running || !deps.enabled() || !deps.isMainRunning()) return
    running = true
    const my = ++run
    let granted = false
    try {
      granted = await deps.requestAccess()
    } catch {
      granted = false
    }
    if (!wanted(my)) return
    if (!granted) {
      reportError({ code: 'no-mic-permission', message: 'Microphone access is not allowed.' })
      return
    }
    try {
      await deps.session.start()
    } catch (e) {
      if (wanted(my)) reportError({ code: 'audio', message: 'Mic session failed.', detail: e instanceof Error ? e.message : undefined })
      return
    }
    if (!wanted(my)) return
    deps.helper.start()
  }

  return { start, stop, reportError }
}

/**
 * Splits the mic session's output in two, so a flush can never cancel a suggestion:
 * - `sink` gets every update, flushes included, and feeds the conversation, remembering the echo verdict;
 * - `live` is the session's `onUtterance`. The session skips it for teardown flushes and, with `feedOnReconnect:
 *   false`, for reconnect flushes too. It tells suggestions about accepted text.
 * The session calls the sink first, then `live`, for the same update.
 * The feed is open only while the mic runs (`open`/`close`): a late flush from an old run is dropped.
 */
export function createMicFeed(deps: {
  conversation: { addMe(u: Utterance): boolean }
  onMine(u: Utterance): void
}): { sink(u: Utterance): void; live(u: Utterance): void; open(): void; close(): void } {
  let isOpen = false
  let verdictId: string | null = null
  let accepted = false
  return {
    open: () => {
      isOpen = true
    },
    close: () => {
      isOpen = false
      verdictId = null
    },
    sink(u) {
      if (!isOpen) return
      if (!stripFillers(u.en).trim()) {
        verdictId = null
        return
      }
      verdictId = u.id
      accepted = deps.conversation.addMe(u) // false: echo of the speakers, dropped entirely
    },
    live(u) {
      if (isOpen && verdictId === u.id && accepted) deps.onMine({ ...u, speaker: 'me' })
    }
  }
}
