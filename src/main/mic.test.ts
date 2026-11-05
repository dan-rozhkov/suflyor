import { describe, expect, it, vi } from 'vitest'
import type { AppError } from '../shared/types'
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
})
