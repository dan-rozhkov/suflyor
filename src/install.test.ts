import { describe, expect, it } from 'vitest'
import { canAddToHomeScreen, isStandalone } from './install'

const media = (matches: boolean) => () => ({ matches })

describe('isStandalone', () => {
  it('is true when the display mode is standalone', () => {
    expect(isStandalone({ matchMedia: media(true), navigator: {} })).toBe(true)
  })
  it('is true when iOS reports navigator.standalone', () => {
    expect(isStandalone({ matchMedia: media(false), navigator: { standalone: true } })).toBe(true)
  })
  it('is false in a normal tab', () => {
    expect(isStandalone({ matchMedia: media(false), navigator: { standalone: false } })).toBe(false)
    expect(isStandalone({ matchMedia: media(false), navigator: {} })).toBe(false)
  })
  it('is false when nothing is available', () => {
    expect(isStandalone({})).toBe(false)
  })
  it('survives a matchMedia that throws', () => {
    const win = { matchMedia: () => { throw new Error('no') }, navigator: { standalone: true } }
    expect(isStandalone(win)).toBe(true)
  })
})

describe('canAddToHomeScreen', () => {
  const browser = (navigator: object) => ({ matchMedia: () => ({ matches: false }), navigator })

  it('offers it on iPhone', () => {
    expect(canAddToHomeScreen(browser({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)' }))).toBe(true)
  })

  it('offers it on iPad, which reports a Mac with touch', () => {
    expect(canAddToHomeScreen(browser({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }))).toBe(true)
  })

  it('does not offer it on desktop or Android', () => {
    expect(canAddToHomeScreen(browser({ userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 }))).toBe(false)
    expect(canAddToHomeScreen(browser({ userAgent: 'Linux; Android 16', platform: 'Linux' }))).toBe(false)
  })

  it('does not offer it inside the installed app', () => {
    expect(canAddToHomeScreen({ matchMedia: () => ({ matches: true }), navigator: { userAgent: 'iPhone' } })).toBe(false)
  })
})
