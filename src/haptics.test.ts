import { describe, expect, it } from 'vitest'
import { hapticKind } from './haptics'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Example/1.0'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Example/1.0'
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Example) Example/1.0'

const base = { userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, installed: true, canVibrate: false }

describe('hapticKind', () => {
  it('is off outside the installed app, even on iPhone or with vibrate', () => {
    expect(hapticKind({ ...base, installed: false })).toBeNull()
    expect(hapticKind({ ...base, installed: false, canVibrate: true })).toBeNull()
  })
  it('uses the switch on an installed iPhone', () => {
    expect(hapticKind(base)).toBe('switch')
  })
  it('uses the switch on an iPad that asks for the desktop site', () => {
    expect(hapticKind({ ...base, userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('switch')
  })
  it('is off on a real Mac', () => {
    expect(hapticKind({ ...base, userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 })).toBeNull()
  })
  it('vibrates on Android', () => {
    expect(hapticKind({ ...base, userAgent: ANDROID, platform: 'Linux armv81', canVibrate: true })).toBe('vibrate')
  })
  it('prefers the switch on an iPhone even when vibrate exists', () => {
    expect(hapticKind({ ...base, canVibrate: true })).toBe('switch')
  })
})
