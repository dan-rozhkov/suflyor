import { describe, expect, it } from 'vitest'
import { rootIsShort } from './viewport'

describe('rootIsShort', () => {
  it('is true when iOS removed the status bar twice', () => {
    expect(rootIsShort(852, 748)).toBe(true)
    expect(rootIsShort(956, 832)).toBe(true)
  })

  it('is false when only the status bar is missing', () => {
    expect(rootIsShort(852, 798)).toBe(false)
    expect(rootIsShort(956, 894)).toBe(false)
    expect(rootIsShort(667, 647)).toBe(false)
  })

  it('is false when the root fills the screen', () => {
    expect(rootIsShort(852, 852)).toBe(false)
  })
})
