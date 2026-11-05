import { describe, expect, it } from 'vitest'
import { rootShortfall } from './viewport'

describe('rootShortfall', () => {
  it('is one status bar when iOS removed the bar twice', () => {
    expect(rootShortfall(852, 748)).toBe(52)
    expect(rootShortfall(956, 832)).toBe(62)
  })

  it('is 0 when only the status bar is missing', () => {
    expect(rootShortfall(852, 798)).toBe(0)
    expect(rootShortfall(956, 894)).toBe(0)
    expect(rootShortfall(667, 647)).toBe(0)
  })

  it('is 0 when the root fills the screen', () => {
    expect(rootShortfall(852, 852)).toBe(0)
  })
})
