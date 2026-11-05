import { describe, expect, it, vi } from 'vitest'
import type { AppError, MicStatus } from '../shared/types'
import { createMicController, MIC_PERMISSION_TOAST, MIC_STOPPED_TOAST, type MicDeps } from './mic'

function setup(over: Partial<MicDeps> = {}) {
  const notes: AppError[] = []
  const helper = { start: vi.fn(), stop: vi.fn() }
  const session = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
  const main = { running: true }
  const deps: MicDeps = {
    enabled: () => true,
    isMainRunning: () => main.running,
    requestAccess: async () => true,
    helper,
    session,
    notify: (e) => notes.push(e),
    ...over
  }
  return { ctl: createMicController(deps), notes, helper, session, main }
}

describe('mic controller', () => {
  it('starts the mic session, then the helper', async () => {
    const s = setup()
    await s.ctl.start()
    expect(s.session.start).toHaveBeenCalledTimes(1)
    expect(s.helper.start).toHaveBeenCalledTimes(1)
  })

  it('does nothing when disabled or when the main session is not running', async () => {
    const off = setup({ enabled: () => false })
    await off.ctl.start()
    const idle = setup()
    idle.main.running = false
    await idle.ctl.start()
    for (const s of [off, idle]) {
      expect(s.helper.start).not.toHaveBeenCalled()
      expect(s.session.start).not.toHaveBeenCalled()
    }
  })

  it('permission denied: one toast with the permission text, mic parts never start', async () => {
    const s = setup({ requestAccess: async () => false })
    await s.ctl.start()
    expect(s.notes).toHaveLength(1)
    expect(s.notes[0]).toMatchObject({ code: 'no-mic-permission', message: MIC_PERMISSION_TOAST })
    expect(s.helper.start).not.toHaveBeenCalled()
    expect(s.session.start).not.toHaveBeenCalled()
  })

  it('helper error stops only the mic parts and toasts once', async () => {
    const s = setup()
    await s.ctl.start()
    s.ctl.reportError({ code: 'audio', message: 'x', detail: 'helper exit 1' })
    s.ctl.reportError({ code: 'audio', message: 'x again' }) // late duplicate
    expect(s.notes).toHaveLength(1)
    expect(s.notes[0]).toMatchObject({ code: 'mic', message: MIC_STOPPED_TOAST })
    expect(s.helper.stop).toHaveBeenCalledTimes(1)
    expect(s.session.stop).toHaveBeenCalledTimes(1)
  })

  it('mic session error without a key stays quiet but still stops the mic parts', async () => {
    const s = setup()
    await s.ctl.start()
    s.ctl.reportError({ code: 'no-keys', message: 'Add your Soniox key in Settings.' })
    expect(s.notes).toEqual([])
    expect(s.helper.stop).toHaveBeenCalled()
  })

  it('a mic session fatal error (api) toasts the generic mic text', async () => {
    const s = setup()
    await s.ctl.start()
    s.ctl.reportError({ code: 'api', message: 'Invalid Soniox key.', detail: 'Soniox 401' })
    expect(s.notes.map((n) => n.message)).toEqual([MIC_STOPPED_TOAST])
  })

  it('stop is silent and idempotent; a stop during the permission prompt cancels the start', async () => {
    let answer: (v: boolean) => void = () => {}
    const s = setup({ requestAccess: () => new Promise<boolean>((r) => (answer = r)) })
    const p = s.ctl.start()
    s.ctl.stop()
    s.ctl.stop()
    answer(true)
    await p
    expect(s.helper.start).not.toHaveBeenCalled()
    expect(s.session.start).not.toHaveBeenCalled()
    expect(s.notes).toEqual([])
  })

  it('does not block the caller: start() can be left pending while the prompt is open', async () => {
    let answer: (v: boolean) => void = () => {}
    const s = setup({ requestAccess: () => new Promise<boolean>((r) => (answer = r)) })
    let done = false
    void s.ctl.start().then(() => (done = true))
    await Promise.resolve()
    expect(done).toBe(false)
    expect(s.helper.start).not.toHaveBeenCalled()
    answer(true)
    await vi.waitFor(() => expect(s.helper.start).toHaveBeenCalled())
  })

  it('can start again after a failure', async () => {
    const s = setup()
    await s.ctl.start()
    s.ctl.reportError({ code: 'audio', message: 'x' })
    await s.ctl.start()
    expect(s.helper.start).toHaveBeenCalledTimes(2)
  })

  describe('status', () => {
    function withStatus(over: Partial<MicDeps> = {}) {
      const events: MicStatus[] = []
      const s = setup({ onStatus: (st) => events.push(st), ...over })
      return { ...s, events, last: () => events[events.length - 1] }
    }
    const st = (active: boolean, starting: boolean, muted = false): MicStatus => ({ active, starting, muted })

    it('is starting during the permission prompt and connecting, active only with helper started and session listening', async () => {
      let answer!: (v: boolean) => void
      const s = withStatus({ requestAccess: () => new Promise<boolean>((r) => (answer = r)) })
      const p = s.ctl.start()
      expect(s.ctl.getStatus()).toEqual(st(false, true))
      answer(true)
      await p
      expect(s.helper.start).toHaveBeenCalled()
      expect(s.ctl.getStatus()).toEqual(st(false, true)) // spawned, not yet started
      s.ctl.helperStarted()
      expect(s.ctl.getStatus()).toEqual(st(false, true)) // helper up, session not listening
      s.ctl.sessionState('listening')
      expect(s.ctl.getStatus()).toEqual(st(true, false))
      expect(s.last()).toEqual(st(true, false))
    })

    it('a reconnecting mic session is starting, not active', async () => {
      const s = withStatus()
      await s.ctl.start()
      s.ctl.helperStarted()
      s.ctl.sessionState('listening')
      s.ctl.sessionState('reconnecting')
      expect(s.ctl.getStatus()).toEqual(st(false, true))
      s.ctl.sessionState('listening')
      expect(s.ctl.getStatus()).toEqual(st(true, false))
    })

    it('stop makes it idle once; late helper and session events are ignored', async () => {
      const s = withStatus()
      await s.ctl.start()
      s.ctl.helperStarted()
      s.ctl.sessionState('listening')
      s.ctl.stop()
      s.ctl.stop()
      s.ctl.helperStarted()
      s.ctl.sessionState('listening')
      expect(s.ctl.getStatus()).toEqual(st(false, false))
      expect(s.events.filter((e) => !e.active && !e.starting)).toHaveLength(1)
    })

    it('a synchronous helper spawn failure never reports active', async () => {
      const s = withStatus()
      s.helper.start.mockImplementation(() => s.ctl.reportError({ code: 'audio', message: 'spawn' }))
      await s.ctl.start()
      s.ctl.helperStarted()
      s.ctl.sessionState('listening')
      expect(s.events.some((e) => e.active)).toBe(false)
      expect(s.ctl.getStatus()).toEqual(st(false, false))
      expect(s.notes).toHaveLength(1)
    })

    it('failed starts (denied, session error) end idle', async () => {
      const denied = withStatus({ requestAccess: async () => false })
      await denied.ctl.start()
      expect(denied.ctl.getStatus()).toEqual(st(false, false))
      const broken = withStatus()
      broken.session.start.mockRejectedValue(new Error('x'))
      await broken.ctl.start()
      expect(broken.ctl.getStatus()).toEqual(st(false, false))
      expect(broken.helper.start).not.toHaveBeenCalled()
    })

    it('mute stops the mic, cancels a start in flight, and is not written anywhere', async () => {
      let answer!: (v: boolean) => void
      const s = withStatus({ requestAccess: () => new Promise<boolean>((r) => (answer = r)) })
      const p = s.ctl.start()
      expect(s.ctl.setMuted(true)).toEqual(st(false, false, true))
      answer(true)
      await p
      expect(s.session.start).not.toHaveBeenCalled()
      expect(s.helper.start).not.toHaveBeenCalled()
      expect(s.notes).toEqual([])
      await s.ctl.start() // muted: a start is refused
      expect(s.session.start).not.toHaveBeenCalled()
    })

    it('mute keeps the setting untouched; unmute starts again and retries after a failure', async () => {
      const s = withStatus()
      await s.ctl.start()
      s.ctl.reportError({ code: 'audio', message: 'x' })
      expect(s.ctl.getStatus()).toEqual(st(false, false))
      expect(s.ctl.setMuted(false)).toEqual(st(false, true))
      await vi.waitFor(() => expect(s.helper.start).toHaveBeenCalledTimes(2))
      s.ctl.setMuted(true)
      expect(s.ctl.getStatus()).toEqual(st(false, false, true))
      s.ctl.setMuted(false)
      await vi.waitFor(() => expect(s.helper.start).toHaveBeenCalledTimes(3))
    })

    it('resetMute clears the mute for the next call', () => {
      const s = withStatus()
      s.ctl.setMuted(true)
      s.ctl.resetMute()
      expect(s.ctl.getStatus().muted).toBe(false)
    })

    it('when the setting is off, unmute does not start the mic', async () => {
      const s = withStatus({ enabled: () => false })
      s.ctl.setMuted(true)
      s.ctl.setMuted(false)
      await Promise.resolve()
      expect(s.session.start).not.toHaveBeenCalled()
    })

    it('a throwing listener does not break the mic', async () => {
      const s = withStatus({ onStatus: () => { throw new Error('boom') } })
      await s.ctl.start()
      expect(s.helper.start).toHaveBeenCalled()
    })
  })
})
