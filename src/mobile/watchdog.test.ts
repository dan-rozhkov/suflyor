import { describe, expect, it } from 'vitest'
import { watchdogAction } from './watchdog'

describe('watchdogAction', () => {
  it('does nothing while frames are recent', () => {
    expect(watchdogAction(0)).toBe('none')
    expect(watchdogAction(3999)).toBe('none')
  })
  it('tries to resume after 4 s without a frame', () => {
    expect(watchdogAction(4000)).toBe('resume')
    expect(watchdogAction(7999)).toBe('resume')
  })
  it('reports loss after 8 s without a frame', () => {
    expect(watchdogAction(8000)).toBe('lost')
    expect(watchdogAction(60_000)).toBe('lost')
  })
})
