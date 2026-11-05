import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer, type WebSocket as WS } from 'ws'
import type { AppError, SessionStatus, Utterance } from '../shared/types'
import { createMicController, createMicFeed } from './mic'
import { createConversation } from './conversation'
import { createSession, DEMO_SCRIPT, sonioxConfig } from './session'

interface Conn {
  ws: WS
  headers: Record<string, string | string[] | undefined>
  texts: string[]
  bytes: number
}

async function startServer(): Promise<{ wss: WebSocketServer; url: string; conns: Conn[] }> {
  const wss = new WebSocketServer({ port: 0 })
  const conns: Conn[] = []
  wss.on('connection', (ws, req) => {
    const c: Conn = { ws, headers: req.headers, texts: [], bytes: 0 }
    conns.push(c)
    ws.on('message', (data, isBinary) => {
      if (isBinary) c.bytes += (data as Buffer).length
      else c.texts.push(data.toString())
    })
  })
  await new Promise<void>((r) => wss.once('listening', () => r()))
  const port = (wss.address() as { port: number }).port
  return { wss, url: `ws://127.0.0.1:${port}`, conns }
}

const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 10))
  }
}

function harness(url: string, key: string | null = 'test-key', extra = {}) {
  const statuses: SessionStatus[] = []
  const utterances: Utterance[] = []
  const seen: Utterance[] = []
  const errors: AppError[] = []
  const session = createSession({
    sink: { status: (s) => statuses.push(s), utterance: (u) => utterances.push(u), error: (e) => errors.push(e) },
    getSonioxKey: () => key ?? undefined,
    demo: false,
    onUtterance: (u) => seen.push(u),
    tuning: { url, backoffMs: () => 30, keepaliveMs: 60, finishTimeoutMs: 200, ...extra }
  })
  return { session, statuses, utterances, seen, errors }
}

let toClose: (() => void)[] = []
afterEach(() => {
  for (const f of toClose) f()
  toClose = []
})

describe('session (mock Soniox server)', () => {
  it('sends config with auth header, audio, keepalive; assembles utterances', async () => {
    const srv = await startServer()
    const h = harness(srv.url)
    toClose.push(() => h.session.dispose(), () => srv.wss.close())

    await h.session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    const c = srv.conns[0]
    expect(c.headers.authorization).toBe('Bearer test-key')
    const cfg = JSON.parse(c.texts[0])
    expect(cfg).toMatchObject({
      model: 'stt-rt-v6',
      audio_format: 'pcm_s16le',
      sample_rate: 16000,
      num_channels: 1,
      language_hints: ['en'],
      enable_endpoint_detection: true,
      translation: { type: 'one_way', target_language: 'ru' }
    })
    expect(cfg.api_key).toBeUndefined()
    expect(h.session.getStatus().state).toBe('listening')

    h.session.pushAudio(new Uint8Array(3200).buffer)
    await until(() => c.bytes === 3200)

    // silence: keepalive
    await until(() => c.texts.some((t) => JSON.parse(t).type === 'keepalive'))

    c.ws.send(JSON.stringify({ tokens: [{ text: 'Hello', is_final: false, translation_status: 'original' }] }))
    c.ws.send(
      JSON.stringify({
        tokens: [
          { text: 'Hello', is_final: true, translation_status: 'original' },
          { text: 'Привет', is_final: true, translation_status: 'translation' },
          { text: '<end>', is_final: true }
        ]
      })
    )
    await until(() => h.seen.some((u) => u.isFinal))
    expect(h.seen[0]).toMatchObject({ en: 'Hello', ru: '', isFinal: false })
    expect(h.seen.at(-1)).toMatchObject({ en: 'Hello', ru: 'Привет', isFinal: true })
    expect(h.utterances.length).toBe(h.seen.length)
    expect(h.session.getTranscript().at(-1)?.ru).toBe('Привет')

    await h.session.stop()
    await until(() => c.texts.includes(''))
    expect(h.session.getStatus().state).toBe('idle')
  })

  it('reconnects after a drop, buffers audio meanwhile, and flushes it', async () => {
    const srv = await startServer()
    const h = harness(srv.url, 'k', { backoffMs: () => 150 })
    toClose.push(() => h.session.dispose(), () => srv.wss.close())

    await h.session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    srv.conns[0].ws.send(JSON.stringify({ tokens: [{ text: 'Half', is_final: false, translation_status: 'original' }] }))
    await until(() => h.seen.length === 1)

    srv.conns[0].ws.terminate()
    await until(() => h.session.getStatus().state === 'reconnecting')
    expect(h.session.getStatus().error?.code).toBe('network')
    // the open partial is closed as final on drop
    expect(h.seen.at(-1)).toMatchObject({ en: 'Half', isFinal: true })

    h.session.pushAudio(new Uint8Array(1600).buffer)
    h.session.pushAudio(new Uint8Array(1600).buffer)

    await until(() => srv.conns.length === 2 && srv.conns[1].bytes === 3200)
    expect(JSON.parse(srv.conns[1].texts[0]).model).toBe('stt-rt-v6')
    await until(() => h.session.getStatus().state === 'listening')
    expect(h.statuses.map((s) => s.state)).toEqual(['starting', 'listening', 'reconnecting', 'listening'])
  })

  it('caps the offline buffer', async () => {
    const srv = await startServer()
    const h = harness(srv.url, 'k', { bufferMs: 100, backoffMs: () => 200 })
    toClose.push(() => h.session.dispose(), () => srv.wss.close())
    await h.session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    srv.conns[0].ws.terminate()
    await until(() => h.session.getStatus().state === 'reconnecting')
    for (let i = 0; i < 10; i++) h.session.pushAudio(new Uint8Array(3200).buffer) // 100 ms each
    await until(() => srv.conns.length === 2 && srv.conns[1].bytes > 0)
    await new Promise((r) => setTimeout(r, 50))
    expect(srv.conns[1].bytes).toBeLessThanOrEqual(3200)
  })

  it('maps a Soniox 401 error to an api error and does not reconnect', async () => {
    const srv = await startServer()
    const h = harness(srv.url)
    toClose.push(() => h.session.dispose(), () => srv.wss.close())
    await h.session.start()
    await until(() => srv.conns.length === 1)
    srv.conns[0].ws.send(JSON.stringify({ error_code: 401, error_message: 'Incorrect API key provided.' }))
    await until(() => h.session.getStatus().state === 'error')
    expect(h.session.getStatus().error?.code).toBe('api')
    expect(h.errors[0].code).toBe('api')
    expect(JSON.stringify(h.errors)).not.toContain('Incorrect')
    await new Promise((r) => setTimeout(r, 150))
    expect(srv.conns.length).toBe(1)
  })

  it('maps an HTTP 401 on upgrade to api error', async () => {
    const wss = new WebSocketServer({ port: 0, verifyClient: (_i, cb) => cb(false, 401, 'no') })
    await new Promise<void>((r) => wss.once('listening', () => r()))
    const h = harness(`ws://127.0.0.1:${(wss.address() as { port: number }).port}`)
    toClose.push(() => h.session.dispose(), () => wss.close())
    await h.session.start()
    await until(() => h.session.getStatus().state === 'error')
    expect(h.session.getStatus().error?.code).toBe('api')
  })

  it('reports network error after repeated connection failures', async () => {
    const srv = await startServer()
    const url = srv.url
    await new Promise((r) => srv.wss.close(r))
    const h = harness(url, 'k', { maxAttempts: 2, backoffMs: () => 10 })
    toClose.push(() => h.session.dispose())
    await h.session.start()
    await until(() => h.session.getStatus().state === 'error')
    expect(h.session.getStatus().error?.code).toBe('network')
    expect(h.statuses.some((s) => s.state === 'reconnecting')).toBe(true)
  })

  it('reports no-keys without a key', async () => {
    const h = harness('ws://127.0.0.1:1', null)
    const st = await h.session.start()
    expect(st.state).toBe('error')
    expect(st.error?.code).toBe('no-keys')
  })
})

describe('session lifecycle fixes', () => {
  const tokens = (...t: object[]) => JSON.stringify({ tokens: t })
  const orig = (text: string, is_final = false) => ({ text, is_final, translation_status: 'original' })

  it('flush on stop updates the UI but does not feed suggestions', async () => {
    const srv = await startServer()
    const h = harness(srv.url)
    toClose.push(() => h.session.dispose(), () => srv.wss.close())
    await h.session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    srv.conns[0].ws.send(tokens(orig('Open utter')))
    await until(() => h.seen.length === 1)
    const seenBefore = h.seen.length
    await h.session.stop()
    expect(h.utterances.at(-1)).toMatchObject({ en: 'Open utter', isFinal: true })
    expect(h.seen.length).toBe(seenBefore) // no onUtterance for the flushed final
    expect(h.session.getTranscript().at(-1)?.isFinal).toBe(true)
  })

  it('flush on reportError updates the UI but does not feed suggestions', async () => {
    const srv = await startServer()
    const h = harness(srv.url)
    toClose.push(() => h.session.dispose(), () => srv.wss.close())
    await h.session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    srv.conns[0].ws.send(tokens(orig('Cut off')))
    await until(() => h.seen.length === 1)
    h.session.reportError({ code: 'audio', message: 'x' })
    expect(h.utterances.at(-1)).toMatchObject({ en: 'Cut off', isFinal: true })
    expect(h.seen.length).toBe(1)
  })

  it('a Soniox error during graceful stop is ignored', async () => {
    const srv = await startServer()
    const h = harness(srv.url, 'k', { finishTimeoutMs: 300 })
    toClose.push(() => h.session.dispose(), () => srv.wss.close())
    await h.session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    srv.conns[0].ws.on('message', (_d, isBinary) => {
      if (!isBinary) srv.conns[0].ws.send(JSON.stringify({ error_code: 500, error_message: 'boom' }))
    })
    const st = await h.session.stop()
    expect(st.state).toBe('idle')
    expect(h.statuses.map((s) => s.state)).not.toContain('reconnecting')
    expect(h.statuses.map((s) => s.state)).not.toContain('error')
    expect(h.errors).toEqual([])
  })

  it('gives up when the server accepts then drops quickly (stable timer cleared on drop)', async () => {
    const srv = await startServer()
    srv.wss.on('connection', (ws) => setTimeout(() => ws.terminate(), 10))
    const h = harness(srv.url, 'k', { maxAttempts: 3, backoffMs: () => 100, stableMs: 150 })
    toClose.push(() => h.session.dispose(), () => srv.wss.close())
    await h.session.start()
    await until(() => h.session.getStatus().state === 'error', 5000)
    expect(h.session.getStatus().error?.code).toBe('network')
    expect(srv.conns.length).toBeLessThanOrEqual(4)
  })

  it('double stop is safe and start/stop overlap leaves a clean state', async () => {
    const srv = await startServer()
    const h = harness(srv.url)
    toClose.push(() => h.session.dispose(), () => srv.wss.close())
    await h.session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    const [a, b] = await Promise.all([h.session.stop(), h.session.stop()])
    expect(a.state).toBe('idle')
    expect(b.state).toBe('idle')
    // overlapping: stop then immediately start; the teardown must not kill the new session
    const stopP = h.session.stop()
    const startP = h.session.start()
    await Promise.all([stopP, startP])
    expect(h.session.getStatus().state).not.toBe('idle')
    await until(() => h.session.getStatus().state === 'listening')
    // and start,stop back-to-back ends idle
    const s1 = h.session.start()
    const s2 = h.session.stop()
    await Promise.all([s1, s2])
    expect(h.session.getStatus().state).toBe('idle')
  })
})

describe('session demo', () => {
  it('streams the script word by word and stops at the end', async () => {
    const statuses: SessionStatus[] = []
    const got: Utterance[] = []
    const seen: Utterance[] = []
    const session = createSession({
      sink: { status: (s) => statuses.push(s), utterance: (u) => got.push(u), error: () => {} },
      getSonioxKey: () => undefined,
      demo: true,
      onUtterance: (u) => seen.push(u),
      tuning: { demoWordMs: 0, demoLineGapMs: 0 }
    })
    await session.start()
    expect(session.getStatus()).toMatchObject({ state: 'listening', demo: true })
    await until(() => session.getStatus().state === 'idle', 5000)
    const finals = got.filter((u) => u.isFinal)
    expect(finals.length).toBe(DEMO_SCRIPT.length)
    expect(DEMO_SCRIPT.length).toBeGreaterThanOrEqual(6)
    expect(DEMO_SCRIPT.length).toBeLessThanOrEqual(8)
    expect(finals[0].ru).toBe(DEMO_SCRIPT[0].ru)
    expect(got.some((u) => !u.isFinal && u.en !== '' && u.ru === '')).toBe(true)
    expect(seen.length).toBe(got.length)
    expect(session.getTranscript().length).toBe(DEMO_SCRIPT.length)
  })

  it('reportError stops the session with state error and surfaces the error in status', async () => {
    const statuses: SessionStatus[] = []
    const srv = await startServer()
    toClose.push(() => srv.wss.close())
    const ctl = createSession({
      sink: { status: (x) => statuses.push(x), utterance: () => {}, error: () => {} },
      getSonioxKey: () => 'k',
      demo: false,
      onUtterance: () => {},
      tuning: { url: srv.url }
    })
    await ctl.start()
    ctl.reportError({ code: 'no-screen-permission', message: 'x' })
    const last = ctl.getStatus()
    expect(last.state).toBe('error')
    expect(last.error?.code).toBe('no-screen-permission')
    ctl.dispose()
  })

  it('sends Soniox context built from the md on every connect, none without md', async () => {
    const srv = await startServer()
    let md = '## Call\n- Company: Acme\n\n## Terms\n- Nimbus\n\n## Notes\nWe sell Nimbus.'
    const h = harness(srv.url, 'k', { backoffMs: () => 30 })
    // rebuild a session that has getContextText
    const session = createSession({
      sink: { status: () => {}, utterance: () => {}, error: () => {} },
      getSonioxKey: () => 'k',
      getContextText: () => md,
      demo: false,
      onUtterance: () => {},
      tuning: { url: srv.url, backoffMs: () => 30, finishTimeoutMs: 100 }
    })
    toClose.push(() => session.dispose(), () => h.session.dispose(), () => srv.wss.close())
    await session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    expect(JSON.parse(srv.conns[0].texts[0]).context).toEqual({
      general: [{ key: 'Company', value: 'Acme' }],
      text: '## Notes\nWe sell Nimbus.',
      terms: ['Nimbus']
    })
    md = ''
    srv.conns[0].ws.terminate()
    await until(() => srv.conns.length === 2 && srv.conns[1].texts.length === 1)
    expect('context' in JSON.parse(srv.conns[1].texts[0])).toBe(false)
  })

  it('strips fillers from en and ru, skips filler-only rows, keeps raw text for existing rows', async () => {
    const srv = await startServer()
    const h = harness(srv.url)
    toClose.push(() => h.session.dispose(), () => srv.wss.close())
    await h.session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    const send = (tokens: unknown[]): void => srv.conns[0].ws.send(JSON.stringify({ tokens }))
    const o = (text: string, fin = false) => ({ text, is_final: fin, translation_status: 'original' })
    const t = (text: string, fin = false) => ({ text, is_final: fin, translation_status: 'translation' })

    send([o('Um', false)])
    await new Promise((r) => setTimeout(r, 100))
    expect(h.utterances).toHaveLength(0)
    expect(h.seen).toHaveLength(0)
    expect(h.session.getTranscript()).toHaveLength(0)

    send([o('Um, I think', false), t('Э-э, я думаю', false)])
    await until(() => h.seen.length === 1)
    expect(h.seen[0]).toMatchObject({ en: 'I think', ru: 'Я думаю' })

    // row exists: filler-only update keeps raw en
    send([o('Um', true)])
    await until(() => h.utterances.length === 2)
    // sink only: UI keeps the row; no onUtterance, transcript untouched
    expect(h.utterances[1]).toMatchObject({ en: 'Um', ru: '' })
    await new Promise((r) => setTimeout(r, 50))
    expect(h.seen).toHaveLength(1)
    const tr = h.session.getTranscript()
    expect(tr).toHaveLength(1)
    expect(tr[0]).toMatchObject({ en: 'I think', isFinal: false })
  })
})

describe('session as the microphone stream (translate: false)', () => {
  const MD = '## Terms\n- manual tests = ручные тесты\n- Nimbus\n\nSome notes.'

  it('sends no translation and no translation_terms, keeps hints, terms and text', async () => {
    const srv = await startServer()
    const session = createSession({
      sink: { status: () => {}, utterance: () => {}, error: () => {} },
      getSonioxKey: () => 'k',
      demo: false,
      translate: false,
      idPrefix: 'm',
      getContextText: () => MD,
      onUtterance: () => {},
      tuning: { url: srv.url, backoffMs: () => 30, finishTimeoutMs: 100 }
    })
    toClose.push(() => session.dispose(), () => srv.wss.close())
    await session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    const cfg = JSON.parse(srv.conns[0].texts[0])
    expect('translation' in cfg).toBe(false)
    expect(cfg.language_hints).toEqual(['en'])
    expect(cfg.context.terms).toEqual(['manual tests', 'Nimbus'])
    expect('translation_terms' in cfg.context).toBe(false)
    expect(cfg.context.text).toContain('Some notes.')
  })

  it('sonioxConfig: default still translates; translate=false drops translation_terms and an emptied context', () => {
    expect(sonioxConfig('m')).toMatchObject({ translation: { type: 'one_way', target_language: 'ru' } })
    const ctx = { terms: ['a'], translation_terms: [{ source: 'a', target: 'б' }] }
    expect(sonioxConfig('m', ctx)).toMatchObject({ context: ctx })
    const mic = sonioxConfig('m', ctx, false)
    expect(mic.context).toEqual({ terms: ['a'] })
    expect('translation' in mic).toBe(false)
    const only = sonioxConfig('m', { translation_terms: [{ source: 'a', target: 'б' }] }, false)
    expect('context' in only).toBe(false)
  })

  it('idPrefix prefixes utterance ids, default stays s', async () => {
    const srv = await startServer()
    toClose.push(() => srv.wss.close())
    const ids: string[] = []
    for (const [prefix, expected] of [[undefined, 's'], ['m', 'm']] as const) {
      const before = srv.conns.length
      const session = createSession({
        sink: { status: () => {}, utterance: (u) => ids.push(u.id), error: () => {} },
        getSonioxKey: () => 'k',
        demo: false,
        ...(prefix ? { idPrefix: prefix } : {}),
        onUtterance: () => {},
        tuning: { url: srv.url, finishTimeoutMs: 100 }
      })
      toClose.push(() => session.dispose())
      await session.start()
      await until(() => srv.conns.length === before + 1 && srv.conns[before].texts.length === 1)
      srv.conns[before].ws.send(JSON.stringify({ tokens: [{ text: 'Hello', is_final: false, translation_status: 'none' }] }))
      await until(() => ids.length === (expected === 's' ? 1 : 2))
      expect(ids.at(-1)?.startsWith(expected)).toBe(true)
    }
  })

  it('failure rule: a mic session error and a mic helper error leave the main session listening', async () => {
    const mainSrv = await startServer()
    const micSrv = await startServer()
    const mainStatuses: SessionStatus[] = []
    const main = createSession({
      sink: { status: (s) => mainStatuses.push(s), utterance: () => {}, error: () => {} },
      getSonioxKey: () => 'k',
      demo: false,
      onUtterance: () => {},
      tuning: { url: mainSrv.url, backoffMs: () => 30, finishTimeoutMs: 100 }
    })
    const micSession = createSession({
      sink: { status: () => {}, utterance: () => {}, error: (e) => mic.reportError(e) },
      getSonioxKey: () => 'k',
      demo: false,
      translate: false,
      idPrefix: 'm',
      onUtterance: () => {},
      tuning: { url: micSrv.url, backoffMs: () => 30, finishTimeoutMs: 100 }
    })
    const helper = { start: () => {}, stop: () => {} }
    const toasts: AppError[] = []
    const mic = createMicController({
      enabled: () => true,
      isMainRunning: () => main.getStatus().state === 'listening',
      requestAccess: async () => true,
      helper,
      session: micSession,
      notify: (e) => toasts.push(e)
    })
    toClose.push(() => main.dispose(), () => micSession.dispose(), () => mainSrv.wss.close(), () => micSrv.wss.close())

    await main.start()
    await until(() => main.getStatus().state === 'listening')
    await mic.start()
    await until(() => micSrv.conns.length === 1 && micSrv.conns[0].texts.length === 1)
    const seen = mainStatuses.length

    // Fatal Soniox error on the mic stream only.
    micSrv.conns[0].ws.send(JSON.stringify({ error_code: 402, error_message: 'balance' }))
    await until(() => toasts.length === 1)
    expect(toasts[0].message).toBe('Microphone stopped. Translation is still on.')
    expect(micSrv.conns[0].ws.readyState).not.toBe(1)
    // Helper error after that: no second toast.
    mic.reportError({ code: 'audio', message: 'x' })
    expect(toasts).toHaveLength(1)

    expect(main.getStatus().state).toBe('listening')
    expect(mainStatuses.length).toBe(seen)
    expect(mainSrv.conns[0].ws.readyState).toBe(1)
  })

  it('a mic flush on stop never reaches suggestions; live speech does, echoes do not', async () => {
    const srv = await startServer()
    const conversation = createConversation()
    const told: string[] = []
    const feed = createMicFeed({ conversation, onMine: (u) => told.push(u.en) })
    const session = createSession({
      sink: { status: () => {}, utterance: (u) => feed.sink(u), error: () => {} },
      getSonioxKey: () => 'k',
      demo: false,
      translate: false,
      idPrefix: 'm',
      onUtterance: (u) => feed.live(u),
      tuning: { url: srv.url, finishTimeoutMs: 100 }
    })
    toClose.push(() => session.dispose(), () => srv.wss.close())
    feed.open()
    await session.start()
    await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
    const tok = (text: string) => ({ text, is_final: false, translation_status: 'none' })
    srv.conns[0].ws.send(JSON.stringify({ tokens: [tok('I can do Friday next week')] }))
    await until(() => told.length === 1)
    srv.conns[0].ws.send(JSON.stringify({ tokens: [tok('I can do Friday next week then')] }))
    await until(() => told.length === 2)
    await session.stop() // flushes the open utterance as final
    await new Promise((r) => setTimeout(r, 50))
    expect(told).toHaveLength(2) // the flush did not tell suggestions
    expect(conversation.list().map((x) => [x.speaker, x.en, x.isFinal])).toEqual([['me', 'I can do Friday next week then', true]])
  })

  it('feedOnReconnect false keeps a reconnect flush out of onUtterance; the default still feeds it', async () => {
    for (const [feedOnReconnect, expected] of [[false, 1], [undefined, 2]] as const) {
      const srv = await startServer()
      const seen: Utterance[] = []
      const session = createSession({
        sink: { status: () => {}, utterance: () => {}, error: () => {} },
        getSonioxKey: () => 'k',
        demo: false,
        ...(feedOnReconnect === undefined ? {} : { feedOnReconnect }),
        onUtterance: (u) => seen.push(u),
        tuning: { url: srv.url, backoffMs: () => 30, finishTimeoutMs: 100 }
      })
      toClose.push(() => session.dispose(), () => srv.wss.close())
      await session.start()
      await until(() => srv.conns.length === 1 && srv.conns[0].texts.length === 1)
      srv.conns[0].ws.send(JSON.stringify({ tokens: [{ text: 'hello there', is_final: false, translation_status: 'none' }] }))
      await until(() => seen.length === 1)
      srv.conns[0].ws.terminate() // reconnect: the open utterance is flushed as final
      await until(() => srv.conns.length === 2)
      await new Promise((r) => setTimeout(r, 30))
      expect(seen).toHaveLength(expected)
    }
  })

  it('a closed mic feed drops late flushes; an open one passes them', () => {
    const conversation = createConversation()
    const told: string[] = []
    const feed = createMicFeed({ conversation, onMine: (u) => told.push(u.en) })
    const u = { id: 'm1', en: 'something I said earlier', ru: '', isFinal: true }
    feed.sink(u)
    feed.live(u)
    expect(conversation.list()).toEqual([])
    expect(told).toEqual([])
    feed.open()
    feed.sink(u)
    feed.live(u)
    expect(conversation.list()).toHaveLength(1)
    expect(told).toEqual(['something I said earlier'])
    feed.close()
    feed.sink({ ...u, id: 'm2' })
    expect(conversation.list()).toHaveLength(1)
  })
})
