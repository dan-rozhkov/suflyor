import { TokenAssembler, type SonioxToken } from './soniox-assembler'
import type { Utterance } from './types'
import type { SonioxContext } from './soniox-context'

export type SonioxStatus = 'connecting' | 'listening' | 'stopping' | 'closed'

export interface SocketLike {
  readyState: number
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev?: unknown) => void) | null
  onclose: ((ev?: unknown) => void) | null
  send(data: string | ArrayBuffer): void
  close(): void
}

export interface SonioxClientOptions {
  key: string
  onUtterances: (u: Utterance[]) => void
  onStatus: (s: SonioxStatus) => void
  onError: (message: string) => void
  /** Names, terms and notes for the call. Sent in the start message when set. */
  context?: SonioxContext
  /** The spoken language, and the one to translate into (null: no translation). */
  languages: { source: string; target: string | null }
  WebSocketImpl?: new (url: string) => SocketLike
}

export interface SonioxClient {
  /** Returns false when the audio was dropped (socket not open or stopping). */
  send(pcm: ArrayBuffer): boolean
  stop(): void
}

const ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket'
const OPEN = 1
const STOP_TIMEOUT_MS = 3000
const CONNECT_TIMEOUT_MS = 10_000

function friendly(code: number | undefined, text: string): string | null {
  if (code === 401 || /invalid.{0,12}api.?key|unauthori[sz]ed/i.test(text)) return 'Invalid Soniox key.'
  if (code === 402) return 'Your Soniox balance is empty.'
  if (code === 403) return 'This Soniox key has no real-time access.'
  return null
}

export function createSonioxClient(opts: SonioxClientOptions): SonioxClient {
  const { key, onUtterances, onStatus, onError } = opts
  const Impl = opts.WebSocketImpl ?? (WebSocket as unknown as new (url: string) => SocketLike)
  const assembler = new TokenAssembler(`x${Date.now().toString(36)}-`, opts.languages)
  const ws = new Impl(ENDPOINT)
  let stopping = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const scrub = (s: string): string => (key ? s.split(key).join('***') : s)

  const finish = (): void => {
    if (closed) return
    closed = true
    if (timer) clearTimeout(timer)
    clearTimeout(connectTimer)
    try {
      ws.close()
    } catch {
      /* already closed */
    }
    const rest = assembler.flush()
    if (rest.length) onUtterances(rest)
    onStatus('closed')
  }

  const fail = (code: number | undefined, text: string): void => {
    if (closed) return
    if (!stopping) onError(friendly(code, text) ?? scrub(text || 'Soniox connection error.'))
    finish()
  }

  onStatus('connecting')
  const connectTimer = setTimeout(() => fail(undefined, 'Could not connect to Soniox.'), CONNECT_TIMEOUT_MS)

  ws.onopen = () => {
    clearTimeout(connectTimer)
    ws.send(
      JSON.stringify({
        // Browser sockets cannot set an Authorization header, so this uses the field Soniox marks as deprecated.
        api_key: key,
        model: 'stt-rt-v6',
        audio_format: 'pcm_s16le',
        sample_rate: 16000,
        num_channels: 1,
        language_hints: [opts.languages.source],
        enable_endpoint_detection: true,
        ...(opts.languages.target ? { translation: { type: 'one_way', target_language: opts.languages.target } } : {}),
        ...(opts.context ? { context: opts.context } : {})
      })
    )
    onStatus('listening')
  }

  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return
    let msg: { tokens?: SonioxToken[]; finished?: boolean; error_code?: number; error_message?: string }
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (typeof msg.error_code === 'number') {
      fail(msg.error_code, msg.error_message ?? `Soniox error ${msg.error_code}`)
      return
    }
    if (msg.tokens?.length) {
      const u = assembler.push(msg.tokens)
      if (u.length) onUtterances(u)
    }
    if (msg.finished) {
      if (stopping) finish()
      else fail(undefined, 'Soniox ended the session.')
    }
  }

  ws.onerror = () => fail(undefined, 'Soniox connection error.')

  ws.onclose = () => {
    if (closed) return
    if (stopping) finish()
    else fail(undefined, 'Soniox connection closed.')
  }

  return {
    send(pcm) {
      if (closed || stopping || ws.readyState !== OPEN) return false
      ws.send(pcm)
      return true
    },
    stop() {
      if (stopping || closed) return
      stopping = true
      onStatus('stopping')
      if (ws.readyState === OPEN) {
        try {
          ws.send('')
        } catch {
          finish()
          return
        }
        timer = setTimeout(finish, STOP_TIMEOUT_MS)
      } else {
        finish()
      }
    }
  }
}
