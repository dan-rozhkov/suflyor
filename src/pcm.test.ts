import { describe, expect, it } from 'vitest'
import { floatToPcm16, peakOf } from './pcm'

describe('floatToPcm16', () => {
  it('converts and clamps', () => {
    const out = floatToPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))
    expect(Array.from(out)).toEqual([0, 32767, -32768, 32767, -32768, 16384])
  })
  it('keeps length', () => {
    expect(floatToPcm16(new Float32Array(1600)).length).toBe(1600)
  })
})

describe('peakOf', () => {
  it('returns the largest absolute value', () => {
    expect(peakOf(new Float32Array([0.1, -0.6, 0.3]))).toBeCloseTo(0.6)
  })
  it('is 0 for empty input', () => {
    expect(peakOf(new Float32Array(0))).toBe(0)
  })
})
