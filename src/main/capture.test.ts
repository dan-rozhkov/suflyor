import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { AppError } from '../shared/types'
import { CHUNK_BYTES, createAudioHelper, createChunker, createLineParser, helperPath, mapHelperError, type SpawnFn } from './capture'

describe('chunker', () => {
  it('cuts into 100 ms chunks across arbitrary boundaries and keeps the remainder', () => {
    const out: Buffer[] = []
    const c = createChunker((b) => out.push(b))
    const data = Buffer.alloc(CHUNK_BYTES * 2 + 100, 7)
    c.push(data.subarray(0, 1))
    c.push(data.subarray(1, 5000))
    c.push(data.subarray(5000))
    expect(out.map((b) => b.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES])
    c.push(Buffer.alloc(CHUNK_BYTES - 100))
    expect(out).toHaveLength(3)
  })
})

describe('line parser and error mapping', () => {
  it('parses split JSON lines and ignores junk', () => {
    const ev: string[] = []
    const p = createLineParser((e) => ev.push(e.event + (e.code ?? '')))
    p.push('{"event":"sta')
    p.push('rted"}\nnoise\n{"event":"error","code":"no-screen-permission"}\n')
    expect(ev).toEqual(['started', 'errorno-screen-permission'])
  })
  it('maps codes', () => {
    expect(mapHelperError({ event: 'error', code: 'no-screen-permission' }).code).toBe('no-screen-permission')
    expect(mapHelperError({ event: 'error', code: 'capture-failed' }).code).toBe('audio')
  })
  it('resolves dev and packaged paths', () => {
    expect(helperPath(false, '/app', '/res')).toBe('/app/resources/bin/suflyor-audio')
    expect(helperPath(true, '/app', '/res')).toBe('/res/bin/suflyor-audio')
  })
})

function fake() {
  const c = new EventEmitter() as EventEmitter & Record<string, unknown>
  c.stdout = new PassThrough()
  c.stderr = new PassThrough()
  c.stdin = new PassThrough()
  c.exitCode = null
  c.signalCode = null
  const kills: string[] = []
  c.kill = (s: string) => {
    kills.push(s)
    return true
  }
  return { c, kills }
}

describe('audio helper', () => {
  function setup() {
    const f = fake()
    const chunks: Buffer[] = []
    const errors: AppError[] = []
    const h = createAudioHelper({
      path: '/x',
      spawn: (() => f.c) as unknown as SpawnFn,
      onChunk: (b) => chunks.push(b),
      onError: (e) => errors.push(e)
    })
    return { ...f, chunks, errors, h }
  }

  it('streams chunks, kills on stop, ignores later events', () => {
    const s = setup()
    s.h.start()
    ;(s.c.stdout as PassThrough).write(Buffer.alloc(CHUNK_BYTES * 3))
    expect(s.chunks).toHaveLength(3)
    s.h.stop()
    expect(s.kills).toEqual(['SIGTERM'])
    expect(s.h.isRunning()).toBe(false)
    s.c.emit('exit', 0, null)
    expect(s.errors).toEqual([])
  })

  it('reports no-screen-permission from stderr once and stops the helper', () => {
    const s = setup()
    s.h.start()
    ;(s.c.stderr as PassThrough).write('{"event":"error","code":"no-screen-permission"}\n')
    s.c.emit('exit', 3, null)
    expect(s.errors.map((e) => e.code)).toEqual(['no-screen-permission'])
    expect(s.kills).toEqual(['SIGTERM'])
  })

  it('reports an unexpected exit as audio error', () => {
    const s = setup()
    s.h.start()
    s.c.emit('exit', 1, null)
    expect(s.errors.map((e) => e.code)).toEqual(['audio'])
  })
})
