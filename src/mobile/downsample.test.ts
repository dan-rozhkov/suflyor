import { describe, expect, it } from 'vitest'
import { Downsampler } from './downsample'

function signal(n: number): Float32Array {
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.05) * 0.8 + Math.sin(i * 0.31) * 0.1
  return x
}

function chunked(d: Downsampler, x: Float32Array, size: number): Float32Array {
  const parts: Float32Array[] = []
  for (let i = 0; i < x.length; i += size) parts.push(d.push(x.subarray(i, i + size)))
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

describe('Downsampler', () => {
  it('gives about one output per 3 inputs at 48 kHz over small chunks', () => {
    const out = chunked(new Downsampler(48000), signal(128 * 750), 128)
    expect(out.length).toBe(32000)
  })

  it('gives the right length at 44.1 kHz over small chunks', () => {
    const n = 128 * 689
    const out = chunked(new Downsampler(44100), signal(n), 128)
    const expected = Math.floor((n * 16000) / 44100)
    expect(Math.abs(out.length - expected)).toBeLessThanOrEqual(1)
  })

  it('does not depend on chunking', () => {
    for (const rate of [48000, 44100]) {
      const x = signal(48000)
      const one = new Downsampler(rate).push(x)
      const many = chunked(new Downsampler(rate), x, 128)
      expect(many.length).toBe(one.length)
      for (let i = 0; i < one.length; i++) expect(many[i]).toBeCloseTo(one[i], 5)
    }
  })

  it('keeps a DC signal at the same level', () => {
    for (const rate of [48000, 44100]) {
      const out = chunked(new Downsampler(rate), new Float32Array(rate).fill(0.5), 128)
      expect(out.length).toBeGreaterThan(15000)
      for (const v of out) expect(v).toBeCloseTo(0.5, 4)
    }
  })

  it('passes 16 kHz through unchanged', () => {
    const x = signal(1000)
    const out = chunked(new Downsampler(16000), x, 128)
    expect(out.length).toBe(x.length)
    for (let i = 0; i < x.length; i++) expect(out[i]).toBeCloseTo(x[i], 6)
  })
})
