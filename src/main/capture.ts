/**
 * System audio capture through the native helper (native/suflyor-audio.swift, ScreenCaptureKit).
 * The helper writes PCM s16le 16 kHz mono to stdout and JSON status lines to stderr. This module spawns it, cuts the
 * byte stream into ~100 ms chunks, maps stderr events and exits to AppError, and kills it on stop.
 * The pure parts (chunker, stderr line parser, error mapping, path) have no Electron imports and are unit tested.
 */
import { spawn as nodeSpawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { join } from 'node:path'
import type { AppError } from '../shared/types'

/** 100 ms of 16 kHz s16le mono. */
export const CHUNK_BYTES = 3200

/** Cuts an arbitrary byte stream into fixed-size chunks (a multiple of 2, so samples never split). */
export function createChunker(onChunk: (chunk: Buffer) => void, chunkBytes: number = CHUNK_BYTES) {
  let pending: Buffer = Buffer.alloc(0)
  return {
    push(data: Buffer): void {
      pending = pending.length === 0 ? data : Buffer.concat([pending, data])
      while (pending.length >= chunkBytes) {
        onChunk(Buffer.from(pending.subarray(0, chunkBytes)))
        pending = pending.subarray(chunkBytes)
      }
    },
    reset(): void {
      pending = Buffer.alloc(0)
    }
  }
}

export interface HelperEvent {
  event: string
  code?: string
  message?: string
}

/** Splits stderr text into complete JSON lines. Non-JSON lines are ignored. */
export function createLineParser(onEvent: (e: HelperEvent) => void) {
  let rest = ''
  return {
    push(text: string): void {
      rest += text
      let nl: number
      while ((nl = rest.indexOf('\n')) >= 0) {
        const line = rest.slice(0, nl).trim()
        rest = rest.slice(nl + 1)
        if (!line) continue
        try {
          const obj = JSON.parse(line) as HelperEvent
          if (obj && typeof obj.event === 'string') onEvent(obj)
        } catch {
          // not a status line
        }
      }
    }
  }
}

export function mapHelperError(e: HelperEvent, mic = false): AppError {
  const detail = e.code ? `${e.code}${e.message ? `: ${e.message}` : ''}` : e.message
  // Mic mode: only the code matters, the toast text comes from mic.ts.
  if (mic) return { code: e.code === 'no-mic-permission' ? 'no-mic-permission' : 'audio', message: 'Audio helper error.', detail }
  if (e.code === 'no-screen-permission') {
    return {
      code: 'no-screen-permission',
      message: 'Screen and system audio recording is not allowed.',
      detail: e.message
    }
  }
  return { code: 'audio', message: "Couldn't capture system audio.", detail }
}

export function exitError(code: number | null, signal: string | null, mic = false): AppError {
  return { code: 'audio', message: mic ? 'Audio helper stopped.' : 'System audio capture stopped.', detail: `helper exit ${code ?? signal ?? '?'}` }
}

/** Dev: <project>/resources/bin. Packaged: <Resources>/bin (electron-builder extraResources, see package.json). */
export function helperPath(isPackaged: boolean, appPath: string, resourcesPath: string): string {
  return isPackaged ? join(resourcesPath, 'bin', 'suflyor-audio') : join(appPath, 'resources', 'bin', 'suflyor-audio')
}

type Child = ChildProcessByStdio<Writable, Readable, Readable>
export type SpawnFn = (path: string, args: string[]) => Child

export interface HelperDeps {
  path: string
  onChunk(chunk: Buffer): void
  /** The helper printed its `started` event: audio is flowing. Ignored for a stopped run. */
  onStarted?(): void
  /** Called at most once per run; the helper is already stopped when it fires. */
  onError(error: AppError): void
  spawn?: SpawnFn
  /** Extra helper arguments, e.g. ['--mic']. A '--mic' argument also selects the mic error mapping (codes only; mic.ts words the toast). */
  args?: string[]
  /** How long to wait after SIGTERM before SIGKILL. */
  killAfterMs?: number
}

export interface AudioHelper {
  start(): void
  stop(): void
  isRunning(): boolean
}

export function createAudioHelper(deps: HelperDeps): AudioHelper {
  const args = deps.args ?? []
  const mic = args.includes('--mic')
  const spawnFn: SpawnFn =
    deps.spawn ?? ((p, a) => nodeSpawn(p, a, { stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as Child)
  const killAfterMs = deps.killAfterMs ?? 1500
  let child: Child | null = null

  function stop(): void {
    const c = child
    if (!c) return
    child = null // late events from this child are ignored
    try {
      c.stdin.end()
    } catch {
      // ignore
    }
    c.kill('SIGTERM')
    const t = setTimeout(() => {
      if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL')
    }, killAfterMs)
    t.unref?.()
    c.once('exit', () => clearTimeout(t))
  }

  function start(): void {
    if (child) return
    let c: Child
    try {
      c = spawnFn(deps.path, args)
    } catch (e) {
      deps.onError({ code: 'audio', message: "Couldn't start audio capture.", detail: e instanceof Error ? e.message : undefined })
      return
    }
    child = c
    let failed = false
    const fail = (err: AppError): void => {
      if (child !== c || failed) return
      failed = true
      stop()
      deps.onError(err)
    }
    const chunker = createChunker((b) => {
      if (child === c) deps.onChunk(b)
    })
    const lines = createLineParser((e) => {
      if (e.event === 'started' && child === c && !failed) deps.onStarted?.()
      else if (e.event === 'error') fail(mapHelperError(e, mic))
    })
    c.stdout.on('data', (d: Buffer) => chunker.push(d))
    c.stderr.setEncoding('utf8')
    c.stderr.on('data', (t: string) => lines.push(t))
    c.stdin.on('error', () => {})
    c.on('error', (e) =>
      fail({ code: 'audio', message: "Couldn't start audio capture.", detail: (e as NodeJS.ErrnoException).code ?? e.message })
    )
    // 'close', not 'exit': stderr is drained first, so a last `error` line (e.g. no-mic-permission) wins over the exit code.
    c.on('close', (code, signal) => fail(exitError(code, signal, mic)))
  }

  return { start, stop, isRunning: () => child !== null }
}
