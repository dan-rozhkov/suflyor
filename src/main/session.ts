/**
 * Capture session: Soniox real-time WebSocket (token assembly into utterances, reconnect with backoff, keepalive,
 * short audio buffer while offline) and the SUFLYOR_DEMO scripted session. Both emit through the same sink.
 *
 * Soniox protocol (docs.soniox.com/stt/api-reference/websocket-api):
 * - wss://stt-rt.soniox.com/transcribe-websocket, key as `Authorization: Bearer <key>` (the `api_key` field in the
 *   start message is deprecated), first message is a JSON config, then binary audio frames.
 * - `{"type":"keepalive"}` text frames while no audio flows; an empty text frame ends the stream, after which the
 *   server sends `{"finished":true}` and closes.
 * - Errors arrive as JSON with `error_code`/`error_message` and the server closes the connection.
 */
import WebSocket from 'ws'
import type { AppError, SessionStatus, Utterance } from '../shared/types'
import { stripFillers } from './fillers'
import { TokenAssembler, type SonioxToken } from './soniox-assembler'
import { buildSonioxContext, type SonioxContext } from './soniox-context'

/** Where the session reports to. Wired in src/main/ipc.ts to webContents.send. */
export interface SessionSink {
  status(status: SessionStatus): void
  /** Upsert by utterance.id. Partial updates have isFinal=false. */
  utterance(utterance: Utterance): void
  error(error: AppError): void
}

/** Timing and endpoint knobs. Defaults are for production; tests override them. */
export interface SessionTuning {
  url?: string
  model?: string
  /** Delay before reconnect attempt number `attempt` (1-based). */
  backoffMs?: (attempt: number) => number
  /** Give up (state 'error', code 'network') after this many consecutive failed attempts. */
  maxAttempts?: number
  /** Send a keepalive when no audio went out for this long. */
  keepaliveMs?: number
  /** Audio kept while offline, in ms of 16 kHz s16le mono. */
  bufferMs?: number
  /** How long stop() waits for the server to flush final tokens. */
  finishTimeoutMs?: number
  /** A connection counts as stable (attempt counter resets) after this long. Default 3000. */
  stableMs?: number
  demoWordMs?: number
  demoLineGapMs?: number
}

export interface SessionDeps {
  sink: SessionSink
  /** Soniox key, main-process only. undefined if not configured. */
  getSonioxKey(): string | undefined
  /** True when SUFLYOR_DEMO=1: scripted conversation, no key, no audio. */
  demo: boolean
  /** Called whenever an utterance is created or updated (partial or final). */
  onUtterance(utterance: Utterance): void
  /** Markdown context text for Soniox `context`. Read on every connect. */
  getContextText?(): string
  tuning?: SessionTuning
}

export interface SessionController {
  /** Start (or restart). Without key and not demo: report error code 'no-keys' via status. */
  start(): Promise<SessionStatus>
  stop(): Promise<SessionStatus>
  getStatus(): SessionStatus
  /** Last ~N utterances, oldest first, including a partial one if present. */
  getTranscript(): Utterance[]
  /** PCM s16le 16 kHz mono chunk from the audio helper. Ignored when idle or in demo. */
  pushAudio(chunk: ArrayBuffer | ArrayBufferView): void
  /** Capture-side failure (helper died, no screen permission): stops the session with state 'error'. */
  reportError(error: AppError): void
  dispose(): void
}

export const SONIOX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket'
export const SONIOX_MODEL = 'stt-rt-v6'
const BYTES_PER_MS = 32 // 16000 Hz * 2 bytes
const TRANSCRIPT_LIMIT = 30
const KEEP_LIMIT = 200

export function sonioxConfig(model: string, context?: SonioxContext): Record<string, unknown> {
  return {
    model,
    audio_format: 'pcm_s16le',
    sample_rate: 16000,
    num_channels: 1,
    language_hints: ['en'],
    enable_endpoint_detection: true,
    translation: { type: 'one_way', target_language: 'ru' },
    ...(context ? { context } : {})
  }
}

export const DEMO_SCRIPT: { en: string; ru: string }[] = [
  {
    en: "Hi everyone, thanks for joining. Let's go through the status of the checkout project.",
    ru: 'Всем привет, спасибо, что подключились. Давайте пройдёмся по статусу проекта оформления заказа.'
  },
  {
    en: 'Last week we shipped the new payment form, and the first numbers look good.',
    ru: 'На прошлой неделе мы выпустили новую форму оплаты, и первые цифры выглядят хорошо.'
  },
  {
    en: 'The main risk right now is the integration with the fraud service. It is still in testing.',
    ru: 'Главный риск сейчас — интеграция с антифрод-сервисом. Она всё ещё на тестировании.'
  },
  {
    en: 'Their team promised a fix by Thursday, but we have not seen it yet.',
    ru: 'Их команда обещала исправление к четвергу, но мы его пока не видели.'
  },
  {
    en: 'If it slips, we would have to move the release by one week.',
    ru: 'Если это сдвинется, нам придётся перенести релиз на неделю.'
  },
  {
    en: 'Can you tell us how confident you are about the current deadline?',
    ru: 'Можете сказать, насколько вы уверены в текущем сроке?'
  },
  {
    en: 'And is there anything you need from our side to keep it on track?',
    ru: 'И нужно ли вам что-то с нашей стороны, чтобы уложиться в срок?'
  }
]

function toBuffer(chunk: ArrayBuffer | ArrayBufferView): Buffer {
  if (ArrayBuffer.isView(chunk)) return Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  return Buffer.from(chunk)
}

function defaultBackoff(attempt: number): number {
  const base = Math.min(10_000, 500 * 2 ** (attempt - 1))
  return base / 2 + Math.random() * (base / 2)
}

const FATAL_MESSAGES: Record<number, string> = {
  400: 'Soniox rejected the request.',
  401: 'Invalid Soniox key.',
  402: 'Your Soniox balance is empty.',
  403: 'This Soniox key has no real-time access.'
}

export function createSession(deps: SessionDeps): SessionController {
  const tune = deps.tuning ?? {}
  const url = tune.url ?? SONIOX_URL
  const model = tune.model ?? SONIOX_MODEL
  const backoff = tune.backoffMs ?? defaultBackoff
  const maxAttempts = tune.maxAttempts ?? 10
  const keepaliveMs = tune.keepaliveMs ?? 5000
  const bufferLimit = (tune.bufferMs ?? 5000) * BYTES_PER_MS
  const finishTimeoutMs = tune.finishTimeoutMs ?? 1500
  const stableMs = tune.stableMs ?? 3000

  let status: SessionStatus = { state: 'idle', demo: deps.demo }
  const order: string[] = []
  const byId = new Map<string, Utterance>()
  let assembler = new TokenAssembler()
  let demoSeq = 0

  let ws: WebSocket | null = null
  let wsOpen = false
  let gen = 0
  let attempts = 0
  let stopRequested = false
  let buffered: Buffer[] = []
  let bufferedBytes = 0
  let lastSend = 0
  let keepaliveTimer: NodeJS.Timeout | null = null
  let reconnectTimer: NodeJS.Timeout | null = null
  let stableTimer: NodeJS.Timeout | null = null
  let demoTimer: NodeJS.Timeout | null = null
  let finishedWaiter: (() => void) | null = null

  function setStatus(next: SessionStatus): void {
    status = next
    deps.sink.status(status)
  }

  /** `suggest=false`: update the UI but do not feed suggestions (teardown and failure flushes). */
  function publish(list: Utterance[], suggest = true): void {
    for (const raw of list) {
      const en = stripFillers(raw.en)
      const ru = stripFillers(raw.ru)
      const fillerOnly = en.trim() === '' && raw.en.trim() !== ''
      // Filler-only English with no row yet: nothing to show. With a row: keep the raw text so it does not go blank.
      if (fillerOnly && !byId.has(raw.id)) continue
      const u: Utterance = { ...raw, en: fillerOnly ? raw.en : en, ru }
      if (fillerOnly) {
        // UI keeps its row; suggestions and the transcript never see filler-only text.
        deps.sink.utterance(u)
        continue
      }
      if (!byId.has(u.id)) {
        order.push(u.id)
        if (order.length > KEEP_LIMIT) byId.delete(order.shift() as string)
      }
      byId.set(u.id, u)
      deps.sink.utterance(u)
      if (suggest && !stopRequested) deps.onUtterance(u)
    }
  }

  function clearTimers(): void {
    if (keepaliveTimer) clearInterval(keepaliveTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (stableTimer) clearTimeout(stableTimer)
    keepaliveTimer = reconnectTimer = stableTimer = null
  }

  function clearStable(): void {
    if (stableTimer) clearTimeout(stableTimer)
    stableTimer = null
  }

  function dropSocket(): void {
    clearStable()
    gen += 1 // ignore late events from the old socket
    const old = ws
    ws = null
    wsOpen = false
    if (old) {
      old.removeAllListeners('message')
      old.on('error', () => {})
      try {
        old.terminate()
      } catch {
        // already closed
      }
    }
  }

  function fail(error: AppError): void {
    clearTimers()
    dropSocket()
    publish(assembler.flush(), false)
    buffered = []
    bufferedBytes = 0
    setStatus({ state: 'error', demo: false, error })
    deps.sink.error(error)
  }

  function scheduleReconnect(reason: AppError): void {
    if (stopRequested) return
    clearStable()
    publish(assembler.flush())
    attempts += 1
    if (attempts > maxAttempts) {
      fail({ code: 'network', message: "Couldn't reach Soniox. Check your connection.", detail: reason.detail })
      return
    }
    if (keepaliveTimer) clearInterval(keepaliveTimer)
    keepaliveTimer = null
    setStatus({ state: 'reconnecting', demo: false, error: reason })
    reconnectTimer = setTimeout(connect, backoff(attempts))
  }

  function sendAudio(buf: Buffer): void {
    if (ws && wsOpen) {
      ws.send(buf)
      lastSend = Date.now()
      return
    }
    buffered.push(buf)
    bufferedBytes += buf.length
    while (bufferedBytes > bufferLimit && buffered.length > 1) bufferedBytes -= (buffered.shift() as Buffer).length
  }

  function connect(): void {
    reconnectTimer = null
    const key = deps.getSonioxKey()
    if (!key) {
      fail({ code: 'no-keys', message: 'Add your Soniox key in Settings.' })
      return
    }
    const myGen = ++gen
    const sock = new WebSocket(url, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 10_000 })
    ws = sock
    wsOpen = false

    sock.on('open', () => {
      if (myGen !== gen) return
      sock.send(JSON.stringify(sonioxConfig(model, buildSonioxContext(deps.getContextText?.() ?? ''))))
      wsOpen = true
      lastSend = Date.now()
      for (const b of buffered) sock.send(b)
      buffered = []
      bufferedBytes = 0
      clearStable()
      stableTimer = setTimeout(() => {
        attempts = 0
      }, stableMs)
      keepaliveTimer = setInterval(() => {
        if (ws && wsOpen && Date.now() - lastSend >= keepaliveMs) {
          ws.send(JSON.stringify({ type: 'keepalive' }))
          lastSend = Date.now()
        }
      }, Math.max(10, Math.floor(keepaliveMs / 2)))
      setStatus({ state: 'listening', demo: false })
    })

    sock.on('message', (data) => {
      if (myGen !== gen) return
      let msg: {
        tokens?: SonioxToken[]
        finished?: boolean
        error_code?: number
        error_message?: string
      }
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (typeof msg.error_code === 'number') {
        if (stopRequested) return // graceful stop: the close handler finishes the wait
        const code = msg.error_code
        if (FATAL_MESSAGES[code]) {
          fail({ code: 'api', message: FATAL_MESSAGES[code], detail: `Soniox ${code}` })
        } else {
          const detail = `Soniox ${code}`
          dropSocket()
          scheduleReconnect({ code: 'api', message: 'Soniox returned an error. Reconnecting…', detail })
        }
        return
      }
      if (msg.tokens && msg.tokens.length > 0) publish(assembler.push(msg.tokens))
      if (msg.finished) {
        publish(assembler.flush(), false)
        finishedWaiter?.()
      }
    })

    sock.on('unexpected-response', (req, res) => {
      if (myGen !== gen) return
      const code = res.statusCode ?? 0
      req.destroy()
      dropSocket()
      if (code === 401 || code === 403) {
        fail({ code: 'api', message: code === 401 ? FATAL_MESSAGES[401] : FATAL_MESSAGES[403], detail: `HTTP ${code}` })
      } else {
        scheduleReconnect({ code: 'network', message: 'Lost connection to Soniox. Reconnecting…', detail: `HTTP ${code}` })
      }
    })

    let lastErr: string | undefined
    sock.on('error', (e) => {
      lastErr = e.message
    })

    sock.on('close', () => {
      if (myGen !== gen) return
      finishedWaiter?.()
      dropSocket()
      scheduleReconnect({ code: 'network', message: 'Lost connection to Soniox. Reconnecting…', detail: lastErr })
    })
  }

  function stopDemo(): void {
    if (demoTimer) clearTimeout(demoTimer)
    demoTimer = null
  }

  function runDemo(): void {
    const wordMs = tune.demoWordMs ?? 170
    const gapMs = tune.demoLineGapMs ?? 1500
    const steps: { u: Utterance; delay: number }[] = []
    for (const line of DEMO_SCRIPT) {
      const id = `demo-${++demoSeq}`
      const en = line.en.split(' ')
      const ru = line.ru.split(' ')
      en.forEach((_, k) => {
        steps.push({ u: { id, en: en.slice(0, k + 1).join(' '), ru: '', isFinal: false }, delay: k === 0 ? gapMs : wordMs })
      })
      ru.forEach((_, k) => {
        steps.push({
          u: { id, en: line.en, ru: ru.slice(0, k + 1).join(' '), isFinal: false },
          delay: k === 0 ? wordMs * 2 : Math.round(wordMs * 0.6)
        })
      })
      steps.push({ u: { id, en: line.en, ru: line.ru, isFinal: true }, delay: wordMs })
    }
    let i = 0
    const next = (): void => {
      if (i >= steps.length) {
        demoTimer = null
        setStatus({ state: 'idle', demo: true })
        return
      }
      const step = steps[i++]
      demoTimer = setTimeout(() => {
        publish([step.u])
        next()
      }, step.delay)
    }
    next()
  }

  async function teardown(graceful: boolean): Promise<void> {
    stopRequested = true
    stopDemo()
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = null
    const sock = ws
    if (graceful && sock && wsOpen) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, finishTimeoutMs)
        finishedWaiter = () => {
          clearTimeout(t)
          resolve()
        }
        try {
          sock.send('') // empty text frame = end of stream
        } catch {
          clearTimeout(t)
          resolve()
        }
      })
      finishedWaiter = null
    }
    clearTimers()
    dropSocket()
    publish(assembler.flush(), false)
    buffered = []
    bufferedBytes = 0
  }

  /** start/stop/dispose run one at a time so a teardown can never touch a newer session. */
  let chain: Promise<unknown> = Promise.resolve()
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = chain.then(fn, fn)
    chain = p.catch(() => {})
    return p
  }

  return {
    start: () =>
      serial(async () => {
        if (status.state !== 'idle' && status.state !== 'error') await teardown(false)
        stopRequested = false
        attempts = 0
        assembler = new TokenAssembler(`s${Date.now().toString(36)}-`)
        if (deps.demo) {
          setStatus({ state: 'listening', demo: true })
          runDemo()
          return status
        }
        if (!deps.getSonioxKey()) {
          fail({ code: 'no-keys', message: 'Add your Soniox key in Settings.' })
          return status
        }
        setStatus({ state: 'starting', demo: false })
        connect()
        return status
      }),
    stop: () =>
      serial(async () => {
        if (status.state === 'idle') return status
        setStatus({ state: 'stopping', demo: deps.demo })
        await teardown(true)
        setStatus({ state: 'idle', demo: deps.demo })
        return status
      }),
    getStatus: () => status,
    getTranscript: () =>
      order
        .slice(-TRANSCRIPT_LIMIT)
        .map((id) => byId.get(id))
        .filter((u): u is Utterance => !!u),
    pushAudio(chunk) {
      if (deps.demo) return
      const s = status.state
      if (s !== 'listening' && s !== 'starting' && s !== 'reconnecting') return
      sendAudio(toBuffer(chunk))
    },
    reportError(error) {
      if (status.state === 'idle') return
      stopRequested = true
      stopDemo()
      fail(error)
    },
    dispose() {
      void serial(() => teardown(false))
    }
  }
}
