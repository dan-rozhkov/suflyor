import type { Utterance } from './types'
import type { SonioxClient, SonioxStatus } from './soniox'
import { TokenError } from './token'

export type SessionPhase = 'idle' | 'starting' | 'listening' | 'reconnecting' | 'stopping'

export interface SessionState {
  phase: SessionPhase
  message?: string
  error?: boolean
}

export interface MicHandlers {
  onPcm: (pcm: ArrayBuffer, peak: number) => void
  onLost: () => void
}

export interface ClientHandlers {
  key: string
  onUtterances: (u: Utterance[]) => void
  onStatus: (s: SonioxStatus) => void
  onError: (message: string) => void
}

export interface SessionDeps {
  getCode: () => string
  startMic: (h: MicHandlers) => Promise<() => void>
  fetchToken: (code: string) => Promise<string>
  createClient: (h: ClientHandlers) => SonioxClient
  onUtterances: (u: Utterance[]) => void
  onState: (s: SessionState) => void
  /** Each chunk from the microphone. `sent` is false when no connection took it. */
  onAudio?: (samples: number, peak: number, sent: boolean) => void
  sleep: (ms: number) => Promise<void>
  now?: () => number
}

export interface Session {
  start(): Promise<void>
  stop(): void
}

export const BACKOFF_MS = [1000, 2000, 4000]
const STABLE_MS = 30_000
const FATAL = /^(Your Soniox balance is empty\.|This Soniox key has no real-time access\.)$/

export const MIC_LOST_MESSAGE = 'The microphone stopped. Tap Start to continue.'
export const MIC_DENIED_MESSAGE = 'Allow the microphone in your phone or browser settings, then tap Start.'

function micErrorMessage(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return MIC_DENIED_MESSAGE
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found on this device.'
  return `Could not start the microphone: ${e instanceof Error ? e.message : String(e)}`
}

/** One Start-to-idle run. Callbacks hold their own run, so a late one cannot touch a newer run. */
interface Run {
  done: boolean
  finalized: boolean
  /** startMic has finished, so the microphone is free or held by stopMic. */
  micSettled: boolean
  stopMic: (() => void) | null
  client: SonioxClient | null
  /** Bumped on each new client and on each drop, so callbacks of older clients are ignored. */
  gen: number
  /** The client was told to stop and has not reported closed yet. */
  closing: boolean
  attempt: number
  listeningSince: number | null
  lastError: string
  message?: string
  error: boolean
}

export function createSession(deps: SessionDeps): Session {
  const now = deps.now ?? Date.now
  let current: Run | null = null

  const emit = (phase: SessionPhase, message?: string, error = false): void => deps.onState({ phase, message, error })

  function settle(run: Run): void {
    if (run.finalized) return
    if (!run.micSettled || run.closing) {
      emit('stopping', run.message, run.error)
      return
    }
    run.finalized = true
    if (current === run) current = null
    emit('idle', run.message, run.error)
  }

  function end(run: Run, message?: string, error = false): void {
    if (run.done) return
    run.done = true
    run.message = message
    run.error = error
    run.stopMic?.()
    run.stopMic = null
    const c = run.client
    run.client = null
    if (c) {
      run.closing = true
      c.stop()
    }
    settle(run)
  }

  async function dropped(run: Run): Promise<void> {
    run.gen++
    run.client = null
    if (run.listeningSince !== null && now() - run.listeningSince >= STABLE_MS) run.attempt = 0
    run.listeningSince = null
    if (run.attempt >= BACKOFF_MS.length) {
      const why = run.lastError ? ` ${run.lastError}` : ''
      end(run, `The connection was lost.${why} Tap Start to try again.`, true)
      return
    }
    const wait = BACKOFF_MS[run.attempt++]
    emit('reconnecting', 'Reconnecting...')
    await deps.sleep(wait)
    if (run.done) return
    await connect(run)
  }

  async function connect(run: Run): Promise<void> {
    let key: string
    try {
      key = await deps.fetchToken(deps.getCode())
    } catch (e) {
      if (run.done) return
      if (e instanceof TokenError && e.kind === 'bad-code') {
        end(run, e.message, true)
        return
      }
      run.lastError = e instanceof Error ? e.message : 'Could not get a key.'
      void dropped(run)
      return
    }
    if (run.done) return
    const gen = ++run.gen
    const mine = (): boolean => run.gen === gen
    const client = deps.createClient({
      key,
      // Final text from a client that is being stopped still counts.
      onUtterances: (u) => {
        if (mine()) deps.onUtterances(u)
      },
      onStatus: (st) => {
        if (!mine()) return
        if (st === 'closed') {
          if (run.done) {
            run.closing = false
            settle(run)
          } else {
            void dropped(run)
          }
          return
        }
        if (run.done) return
        if (st === 'connecting') emit(run.attempt ? 'reconnecting' : 'starting', run.attempt ? 'Reconnecting...' : 'Connecting...')
        else if (st === 'listening') {
          run.listeningSince = now()
          emit('listening', 'Listening')
        }
      },
      onError: (m) => {
        if (!mine() || run.done) return
        run.lastError = m
        if (FATAL.test(m)) end(run, m, true)
      }
    })
    if (run.gen === gen) run.client = client
    // A fatal error or stop may have fired while the client was being created.
    if (run.done && run.client === client) {
      run.client = null
      run.closing = true
      client.stop()
    }
  }

  async function start(): Promise<void> {
    if (current) return
    const run: Run = {
      done: false,
      finalized: false,
      micSettled: false,
      stopMic: null,
      client: null,
      gen: 0,
      closing: false,
      attempt: 0,
      listeningSince: null,
      lastError: '',
      error: false
    }
    current = run
    emit('starting', 'Starting the microphone...')
    let stopMic: () => void
    try {
      // Called first and without a preceding await: the mic needs the tap's user activation.
      stopMic = await deps.startMic({
        onPcm: (pcm, peak) => {
          if (run.done) return
          const sent = run.client?.send(pcm) ?? false
          deps.onAudio?.(pcm.byteLength / 2, peak, sent)
        },
        onLost: () => end(run, MIC_LOST_MESSAGE, true)
      })
    } catch (e) {
      run.micSettled = true
      end(run, micErrorMessage(e), true)
      settle(run)
      return
    }
    run.micSettled = true
    if (run.done) {
      stopMic()
      settle(run)
      return
    }
    run.stopMic = stopMic
    await connect(run)
  }

  function stop(): void {
    if (current) end(current)
  }

  return { start, stop }
}
