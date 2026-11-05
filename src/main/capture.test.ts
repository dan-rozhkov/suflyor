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
  function setup(args?: string[]) {
    const f = fake()
    const chunks: Buffer[] = []
    const errors: AppError[] = []
    const spawned: string[][] = []
    const h = createAudioHelper({
      path: '/x',
      ...(args ? { args } : {}),
      spawn: ((_p: string, a: string[]) => {
        spawned.push(a)
        return f.c
      }) as unknown as SpawnFn,
      onChunk: (b) => chunks.push(b),
      onError: (e) => errors.push(e)
    })
    return { ...f, chunks, errors, h, spawned }
  }

  it('streams chunks, kills on stop, ignores later events', () => {
    const s = setup()
    s.h.start()
    ;(s.c.stdout as PassThrough).write(Buffer.alloc(CHUNK_BYTES * 3))
    expect(s.chunks).toHaveLength(3)
    s.h.stop()
    expect(s.kills).toEqual(['SIGTERM'])
    expect(s.h.isRunning()).toBe(false)
    s.c.emit('close', 0, null)
    expect(s.errors).toEqual([])
  })

  it('reports no-screen-permission from stderr once and stops the helper', () => {
    const s = setup()
    s.h.start()
    ;(s.c.stderr as PassThrough).write('{"event":"error","code":"no-screen-permission"}\n')
    s.c.emit('close', 3, null)
    expect(s.errors.map((e) => e.code)).toEqual(['no-screen-permission'])
    expect(s.kills).toEqual(['SIGTERM'])
  })

  it('calls onStarted for the helper started event, once per run, and not after stop', () => {
    const f = fake()
    let started = 0
    const h = createAudioHelper({ path: '/x', spawn: (() => f.c) as unknown as SpawnFn, onChunk: () => {}, onError: () => {}, onStarted: () => started++ })
    h.start()
    ;(f.c.stderr as PassThrough).write('{"event":"started"}\n')
    expect(started).toBe(1)
    h.stop()
    ;(f.c.stderr as PassThrough).write('{"event":"started"}\n')
    expect(started).toBe(1)
  })

  it('reports an unexpected exit as audio error', () => {
    const s = setup()
    s.h.start()
    s.c.emit('close', 1, null)
    expect(s.errors.map((e) => e.code)).toEqual(['audio'])
  })

  it('a stderr error that arrives right before close wins over the exit code', () => {
    const s = setup(['--mic'])
    s.h.start()
    s.c.emit('exit', 3, null) // exit alone does not decide anything
    expect(s.errors).toEqual([])
    ;(s.c.stderr as PassThrough).write('{"event":"error","code":"no-mic-permission"}\n')
    s.c.emit('close', 3, null)
    expect(s.errors.map((e) => e.code)).toEqual(['no-mic-permission'])
  })

  it('stop still SIGKILLs a child that ignores SIGTERM, and the timer is cleared on exit', async () => {
    const f = fake()
    const h = createAudioHelper({ path: '/x', killAfterMs: 20, spawn: (() => f.c) as unknown as SpawnFn, onChunk: () => {}, onError: () => {} })
    h.start()
    h.stop()
    await new Promise((r) => setTimeout(r, 50))
    expect(f.kills).toEqual(['SIGTERM', 'SIGKILL'])
    const g = fake()
    const h2 = createAudioHelper({ path: '/x', killAfterMs: 20, spawn: (() => g.c) as unknown as SpawnFn, onChunk: () => {}, onError: () => {} })
    h2.start()
    h2.stop()
    g.c.emit('exit', 0, null)
    await new Promise((r) => setTimeout(r, 50))
    expect(g.kills).toEqual(['SIGTERM'])
  })

  it('spawns with no arguments by default and with the given ones', () => {
    const a = setup()
    a.h.start()
    expect(a.spawned).toEqual([[]])
    const b = setup(['--mic'])
    b.h.start()
    expect(b.spawned).toEqual([['--mic']])
  })

  it('mic helper: no-mic-permission code, no system audio wording', () => {
    const s = setup(['--mic'])
    s.h.start()
    ;(s.c.stderr as PassThrough).write('{"event":"error","code":"no-mic-permission","message":"denied"}\n')
    expect(s.errors).toHaveLength(1)
    expect(s.errors[0].code).toBe('no-mic-permission')
        const t = setup(['--mic'])
    t.h.start()
    t.c.emit('close', 1, null)
    expect(t.errors[0]).toMatchObject({ code: 'audio' })
    const u = setup(['--mic'])
    u.h.start()
    ;(u.c.stderr as PassThrough).write('{"event":"error","code":"capture-failed"}\n')
    expect(u.errors[0].message).not.toMatch(/system audio/i)
  })

  it('system helper keeps its wording', () => {
    expect(mapHelperError({ event: 'error', code: 'capture-failed' }).message).toBe("Couldn't capture system audio.")
    expect(mapHelperError({ event: 'error', code: 'no-mic-permission' }).code).toBe('audio')
  })
})
