/** Float samples (-1..1) to 16-bit little-endian PCM, clamped. */
export function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

/** Largest absolute sample value. */
export function peakOf(input: Float32Array): number {
  let p = 0
  for (let i = 0; i < input.length; i++) {
    const a = Math.abs(input[i])
    if (a > p) p = a
  }
  return p
}
