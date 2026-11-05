import { describe, expect, it } from 'vitest'
import type { Utterance } from './types'
import type { SonioxClient } from './soniox'
import {
  createSession,
  MIC_DENIED_MESSAGE,
  MIC_LOST_MESSAGE,
  type ClientHandlers,
  type MicHandlers,
  type SessionState
} from './session'
import { TokenError } from './token'

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

interface FakeClient extends SonioxClient {
  h: ClientHandlers
  sent: ArrayBuffer[]
  stopped: boolean
}

function setup(opts: { tokens?: Array<string | Error>; micError?: Error; micDelay?: boolean } = {}) {
  const log: string[] = []
  const states: SessionState[] = []
  const utterances: Utterance[][] = []
  const clients: FakeClient[] = []
  const sleeps: Array<{ ms: number; resolve: () => void }> = []
  const tokens = [...(opts.tokens ?? [])]
  let mic: MicHandlers | null = null
  let micStops = 0
  let releaseMic: (() => void) | null = null
  let clock = 0

  const session = createSession({
    getCode: () => 'code',
    startMic: (h) => {
      log.push('mic')
      mic = h
      const stopFn = (): void => void micStops++
      if (opts.micError) return Promise.reject(opts.micError)
      if (opts.micDelay) return new Promise((r) => (releaseMic = () => r(stopFn)))
      return Promise.resolve(stopFn)
    },
    fetchToken: async () => {
      log.push('token')
      const t = tokens.shift() ?? `tok${clients.length + 1}`
      if (t instanceof Error) throw t
      return t
    },
    createClient: (h) => {
      log.push('client')
      const c: FakeClient = {
        h,
        sent: [],
        stopped: false,
        send(p) {
          c.sent.push(p)
          return true
        },
        stop() {
          c.stopped = true
        }
      }
      clients.push(c)
      return c
    },
    onUtterances: (u) => utterances.push(u),
    onState: (s) => states.push(s),
    sleep: (ms) => new Promise((resolve) => sleeps.push({ ms, resolve })),
    now: () => clock
  })
  return {
    session,
    log,
    states,
    utterances,
    clients,
    sleeps,
    get mic() {
      return mic!
    },
    get micStops() {
      return micStops
    },
    releaseMic: () => releaseMic!(),
    advance: (ms: number) => void (clock += ms),
    last: () => states[states.length - 1]
  }
}

describe('session', () => {
  it('starts the mic before the token, then the client', async () => {
    const t = setup()
    await t.session.start()
    expect(t.log).toEqual(['mic', 'token', 'client'])
    t.clients[0].h.onStatus('listening')
    expect(t.last().phase).toBe('listening')
  })

  it('sends mic audio to the current client', async () => {
    const t = setup()
    await t.session.start()
    const pcm = new ArrayBuffer(8)
    t.mic.onPcm(pcm, 0.5)
    expect(t.clients[0].sent).toEqual([pcm])
  })

  it('retries with a fresh token after 1 s, 2 s, 4 s and keeps the mic on', async () => {
    const t = setup()
    await t.session.start()
    for (const ms of [1000, 2000, 4000]) {
      const n = t.clients.length
      t.clients[n - 1].h.onStatus('closed')
      await flush()
      expect(t.last().phase).toBe('reconnecting')
      expect(t.sleeps[t.sleeps.length - 1].ms).toBe(ms)
      t.sleeps[t.sleeps.length - 1].resolve()
      await flush()
      expect(t.clients.length).toBe(n + 1)
    }
    expect(t.log.filter((x) => x === 'token').length).toBe(4)
    expect(t.log.filter((x) => x === 'mic').length).toBe(1)
    expect(t.micStops).toBe(0)
    // Audio goes to the newest client.
    t.mic.onPcm(new ArrayBuffer(2), 0.1)
    expect(t.clients[3].sent.length).toBe(1)
    expect(t.clients[0].sent.length).toBe(0)
  })

  it('passes the attempt number to each client and resets it after a stable run', async () => {
    const t = setup()
    await t.session.start()
    expect(t.clients[0].h.attempt).toBe(0)
    for (let i = 0; i < 3; i++) {
      t.clients[i].h.onStatus('closed')
      await flush()
      t.sleeps[i].resolve()
      await flush()
      expect(t.clients[i + 1].h.attempt).toBe(i + 1)
    }
    const t2 = setup()
    await t2.session.start()
    t2.clients[0].h.onStatus('listening')
    t2.advance(31_000)
    t2.clients[0].h.onStatus('closed')
    await flush()
    t2.sleeps[0].resolve()
    await flush()
    expect(t2.clients[1].h.attempt).toBe(1)
    t2.clients[1].h.onStatus('listening')
    t2.advance(31_000)
    t2.clients[1].h.onStatus('closed')
    await flush()
    t2.sleeps[1].resolve()
    await flush()
    expect(t2.clients[2].h.attempt).toBe(1)
  })

  it('gives up after 3 retries and releases the mic', async () => {
    const t = setup()
    await t.session.start()
    for (let i = 0; i < 3; i++) {
      t.clients[i].h.onStatus('closed')
      await flush()
      t.sleeps[i].resolve()
      await flush()
    }
    t.clients[3].h.onError('Soniox connection closed.')
    t.clients[3].h.onStatus('closed')
    await flush()
    expect(t.clients.length).toBe(4)
    expect(t.last().phase).toBe('idle')
    expect(t.last().error).toBe(true)
    expect(t.last().message).toMatch(/Tap Start to try again/)
    expect(t.micStops).toBe(1)
  })

  it('resets the attempt counter after 30 s of listening', async () => {
    const t = setup()
    await t.session.start()
    for (let i = 0; i < 5; i++) {
      t.clients[i].h.onStatus('listening')
      t.advance(31_000)
      t.clients[i].h.onStatus('closed')
      await flush()
      expect(t.sleeps[i].ms).toBe(1000)
      t.sleeps[i].resolve()
      await flush()
    }
    expect(t.last().phase).not.toBe('idle')
  })

  it.each(['Your Soniox balance is empty.', 'This Soniox key has no real-time access.'])(
    'does not retry the fatal error "%s"',
    async (msg) => {
      const t = setup()
      await t.session.start()
      t.clients[0].h.onError(msg)
      t.clients[0].h.onStatus('closed')
      await flush()
      expect(t.sleeps.length).toBe(0)
      expect(t.clients.length).toBe(1)
      expect(t.last()).toMatchObject({ phase: 'idle', message: msg, error: true })
      expect(t.micStops).toBe(1)
    }
  )

  it('retries "Invalid Soniox key." with a fresh token and names it when giving up', async () => {
    const t = setup()
    await t.session.start()
    t.clients[0].h.onError('Invalid Soniox key.')
    t.clients[0].h.onStatus('closed')
    await flush()
    expect(t.sleeps[0].ms).toBe(1000)
    expect(t.last().phase).toBe('reconnecting')
    t.sleeps[0].resolve()
    await flush()
    expect(t.clients.length).toBe(2)
    for (let i = 1; i < 4; i++) {
      t.clients[i].h.onError('Invalid Soniox key.')
      t.clients[i].h.onStatus('closed')
      await flush()
      if (i < 3) {
        t.sleeps[i].resolve()
        await flush()
      }
    }
    expect(t.last()).toMatchObject({ phase: 'idle', error: true })
    expect(t.last().message).toContain('Invalid Soniox key.')
  })

  it('does not retry a bad code', async () => {
    const t = setup({ tokens: [new TokenError('bad-code', 'This access code is wrong.')] })
    await t.session.start()
    expect(t.clients.length).toBe(0)
    expect(t.sleeps.length).toBe(0)
    expect(t.last()).toMatchObject({ phase: 'idle', message: 'This access code is wrong.', error: true })
    expect(t.micStops).toBe(1)
  })

  it('retries a network error on the token', async () => {
    const t = setup({ tokens: [new TokenError('network', 'Could not reach the server.')] })
    await t.session.start()
    expect(t.sleeps[0].ms).toBe(1000)
    t.sleeps[0].resolve()
    await flush()
    expect(t.clients.length).toBe(1)
  })

  it('stop during backoff ends cleanly', async () => {
    const t = setup()
    await t.session.start()
    t.clients[0].h.onStatus('closed')
    await flush()
    t.session.stop()
    expect(t.micStops).toBe(1)
    expect(t.last().phase).toBe('idle')
    t.sleeps[0].resolve()
    await flush()
    expect(t.clients.length).toBe(1)
    expect(t.log.filter((x) => x === 'token').length).toBe(1)
  })

  it('stop during setup releases the mic', async () => {
    const t = setup({ micDelay: true })
    const p = t.session.start()
    t.session.stop()
    expect(t.last().phase).toBe('stopping')
    t.releaseMic()
    await p
    expect(t.micStops).toBe(1)
    expect(t.last().phase).toBe('idle')
    expect(t.log).toEqual(['mic'])
  })

  it('blocks a second Start until mic setup has settled', async () => {
    const t = setup({ micDelay: true })
    const p = t.session.start()
    t.session.stop()
    await t.session.start()
    expect(t.log).toEqual(['mic'])
    t.releaseMic()
    await p
  })

  it('stop waits for the client to close, and keeps its final text', async () => {
    const t = setup()
    await t.session.start()
    t.session.stop()
    expect(t.clients[0].stopped).toBe(true)
    expect(t.micStops).toBe(1)
    expect(t.last().phase).toBe('stopping')
    t.clients[0].h.onUtterances([{ id: 'a' } as Utterance])
    t.clients[0].h.onStatus('closed')
    expect(t.utterances.length).toBe(1)
    expect(t.last().phase).toBe('idle')
    expect(t.sleeps.length).toBe(0)
  })

  it('stops with a message when the mic is lost', async () => {
    const t = setup()
    await t.session.start()
    t.mic.onLost()
    expect(t.micStops).toBe(1)
    expect(t.clients[0].stopped).toBe(true)
    t.clients[0].h.onStatus('closed')
    expect(t.last()).toMatchObject({ phase: 'idle', message: MIC_LOST_MESSAGE })
  })

  it('explains a denied microphone', async () => {
    const e = new Error('denied')
    e.name = 'NotAllowedError'
    const t = setup({ micError: e })
    await t.session.start()
    expect(t.last()).toMatchObject({ phase: 'idle', message: MIC_DENIED_MESSAGE, error: true })
    expect(t.log).toEqual(['mic'])
  })

  it('lets a new Start work after a finished run', async () => {
    const t = setup()
    await t.session.start()
    t.session.stop()
    t.clients[0].h.onStatus('closed')
    await t.session.start()
    expect(t.log.filter((x) => x === 'mic').length).toBe(2)
  })

  it('ignores callbacks of an old client', async () => {
    const t = setup()
    await t.session.start()
    const old = t.clients[0]
    old.h.onStatus('closed')
    await flush()
    t.sleeps[0].resolve()
    await flush()
    const before = t.states.length
    old.h.onUtterances([{ id: 'late' } as Utterance])
    old.h.onStatus('listening')
    old.h.onError('Invalid Soniox key.')
    old.h.onStatus('closed')
    await flush()
    expect(t.utterances.length).toBe(0)
    expect(t.states.length).toBe(before)
    expect(t.sleeps.length).toBe(1)
    expect(t.micStops).toBe(0)
  })
})
