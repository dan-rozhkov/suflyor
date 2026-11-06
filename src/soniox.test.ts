import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSonioxClient, type SocketLike } from './soniox'

const KEY = 'secret-key-123'

class FakeSocket implements SocketLike {
  static last: FakeSocket
  readyState = 0
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onerror: SocketLike['onerror'] = null
  onclose: SocketLike['onclose'] = null
  sent: (string | ArrayBuffer)[] = []
  closed = false
  constructor(public url: string) {
    FakeSocket.last = this
  }
  send(d: string | ArrayBuffer): void {
    this.sent.push(d)
  }
  close(): void {
    this.closed = true
    this.readyState = 3
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
  msg(o: unknown): void {
    this.onmessage?.({ data: JSON.stringify(o) })
  }
}

function setup() {
  const events = { utt: [] as unknown[][], status: [] as string[], err: [] as string[] }
  const client = createSonioxClient({
    key: KEY,
    onUtterances: (u) => events.utt.push(u),
    onStatus: (s) => events.status.push(s),
    onError: (m) => events.err.push(m),
    languages: { source: 'en', target: 'ru' },
    WebSocketImpl: FakeSocket
  })
  return { client, ws: FakeSocket.last, events }
}

const audio = (): ArrayBuffer => new ArrayBuffer(3200)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('soniox client', () => {
  it('adds context to the start message only when given', () => {
    const mk = (context?: { text: string }): Record<string, unknown> => {
      createSonioxClient({ key: KEY, onUtterances: () => {}, onStatus: () => {}, onError: () => {}, context, languages: { source: 'en', target: 'ru' }, WebSocketImpl: FakeSocket })
      FakeSocket.last.open()
      return JSON.parse(FakeSocket.last.sent[0] as string)
    }
    expect(mk({ text: 'We sell Nimbus.' }).context).toEqual({ text: 'We sell Nimbus.' })
    expect('context' in mk()).toBe(false)
  })

  it('uses the given languages, and omits translation when the target is null', () => {
    const mk = (languages: { source: string; target: string | null }): Record<string, unknown> => {
      createSonioxClient({ key: KEY, onUtterances: () => {}, onStatus: () => {}, onError: () => {}, languages, WebSocketImpl: FakeSocket })
      FakeSocket.last.open()
      return JSON.parse(FakeSocket.last.sent[0] as string)
    }
    const a = mk({ source: 'de', target: 'ja' })
    expect(a.language_hints).toEqual(['de'])
    expect(a.translation).toEqual({ type: 'one_way', target_language: 'ja' })
    const b = mk({ source: 'ar', target: null })
    expect(b.language_hints).toEqual(['ar'])
    expect('translation' in b).toBe(false)
  })

  it('drops audio before open, sends config first after open', () => {
    const { client, ws, events } = setup()
    expect(events.status).toEqual(['connecting'])
    expect(client.send(audio())).toBe(false)
    expect(ws.sent).toHaveLength(0)
    ws.open()
    const cfg = JSON.parse(ws.sent[0] as string)
    expect(cfg.api_key).toBe(KEY)
    expect(cfg.language_hints).toEqual(['en'])
    expect(cfg.translation).toEqual({ type: 'one_way', target_language: 'ru' })
    expect(cfg.sample_rate).toBe(16000)
    expect(client.send(audio())).toBe(true)
    expect(ws.sent).toHaveLength(2)
    expect(events.status).toEqual(['connecting', 'listening'])
  })

  it('delivers utterances', () => {
    const { ws, events } = setup()
    ws.open()
    ws.msg({
      tokens: [
        { text: 'Hello', is_final: true, translation_status: 'original' },
        { text: 'Привет', is_final: false, translation_status: 'translation' }
      ]
    })
    expect(events.utt).toHaveLength(1)
    expect(events.utt[0][0]).toMatchObject({ original: 'Hello', translation: 'Привет', originalLang: 'en', translationLang: 'ru', isFinal: false })
  })

  it('stops gracefully on finished', () => {
    const { client, ws, events } = setup()
    ws.open()
    ws.msg({ tokens: [{ text: 'Hi', is_final: true, translation_status: 'original' }] })
    client.stop()
    expect(ws.sent[ws.sent.length - 1]).toBe('')
    expect(events.status).toContain('stopping')
    expect(client.send(audio())).toBe(false)
    ws.msg({ finished: true })
    expect(ws.closed).toBe(true)
    expect(events.status[events.status.length - 1]).toBe('closed')
    // flush delivered the open segment as final
    expect(events.utt[events.utt.length - 1][0]).toMatchObject({ original: 'Hi', isFinal: true })
  })

  it('stops after 3 s without finished', () => {
    const { client, ws, events } = setup()
    ws.open()
    client.stop()
    vi.advanceTimersByTime(2900)
    expect(ws.closed).toBe(false)
    vi.advanceTimersByTime(200)
    expect(ws.closed).toBe(true)
    expect(events.status[events.status.length - 1]).toBe('closed')
    expect(events.err).toEqual([])
  })

  it('maps auth errors', () => {
    const a = setup()
    a.ws.open()
    a.ws.msg({ error_code: 401, error_message: 'Unauthorized' })
    expect(a.events.err).toEqual(['Invalid Soniox key.'])
    expect(a.events.status[a.events.status.length - 1]).toBe('closed')

    const b = setup()
    b.ws.open()
    b.ws.msg({ error_code: 400, error_message: 'Invalid api_key.' })
    expect(b.events.err).toEqual(['Invalid Soniox key.'])
  })

  it('explains balance and access errors', () => {
    const a = setup()
    a.ws.open()
    a.ws.msg({ error_code: 402, error_message: 'Payment required' })
    expect(a.events.err).toEqual(['Your Soniox balance is empty.'])

    const b = setup()
    b.ws.open()
    b.ws.msg({ error_code: 403, error_message: 'Forbidden' })
    expect(b.events.err).toEqual(['This Soniox key has no real-time access.'])
  })

  it('does not call an unrelated error a bad key', () => {
    const { ws, events } = setup()
    ws.open()
    ws.msg({ error_code: 400, error_message: 'Invalid sample rate for this model key frame' })
    expect(events.err).toEqual(['Invalid sample rate for this model key frame'])
  })

  it('ignores a null error_code', () => {
    const { ws, events } = setup()
    ws.open()
    ws.msg({ error_code: null, tokens: [] })
    expect(events.err).toEqual([])
    expect(events.status).not.toContain('closed')
  })

  it('stays quiet about errors during a graceful stop', () => {
    const { client, ws, events } = setup()
    ws.open()
    client.stop()
    ws.msg({ error_code: 500, error_message: 'late failure' })
    expect(events.err).toEqual([])
    expect(events.status[events.status.length - 1]).toBe('closed')
  })

  it('gives each session its own utterance ids', () => {
    const tokens = [{ text: 'Hello', is_final: true, translation_status: 'original' }]
    const a = setup()
    a.ws.open()
    a.ws.msg({ tokens })
    vi.advanceTimersByTime(1)
    const b = setup()
    b.ws.open()
    b.ws.msg({ tokens })
    const id = (e: typeof a.events): string => (e.utt[0][0] as { id: string }).id
    expect(id(a.events)).not.toBe(id(b.events))
  })

  it('gives up when the socket does not open in time', () => {
    const { ws, events } = setup()
    vi.advanceTimersByTime(10_000)
    expect(events.err).toEqual(['Could not connect to Soniox.'])
    expect(ws.closed).toBe(true)
    expect(events.status[events.status.length - 1]).toBe('closed')
  })

  it('reports a stream the server ended on its own', () => {
    const { ws, events } = setup()
    ws.open()
    ws.msg({ finished: true })
    expect(events.err).toEqual(['Soniox ended the session.'])
    expect(events.status[events.status.length - 1]).toBe('closed')
  })

  it('does not leak the key in errors', () => {
    const { ws, events } = setup()
    ws.open()
    ws.msg({ error_code: 500, error_message: `bad thing with ${KEY} inside` })
    expect(events.err).toHaveLength(1)
    expect(events.err[0]).not.toContain(KEY)
  })

  it('reports a dropped connection and stops', () => {
    const { ws, events } = setup()
    ws.open()
    ws.onclose?.()
    expect(events.err).toHaveLength(1)
    expect(events.status[events.status.length - 1]).toBe('closed')
  })
})
