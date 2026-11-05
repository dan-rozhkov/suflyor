/**
 * Converts audio to a lower sample rate by averaging the input samples that fall in each output sample
 * (a box low-pass). The fractional position and the partial sum carry over between calls, so chunk
 * boundaries do not change the result.
 */
export class Downsampler {
  private readonly ratio: number
  /** Input samples still needed to finish the current output sample. */
  private need: number
  private sum = 0

  constructor(
    inRate: number,
    outRate = 16000
  ) {
    this.ratio = inRate / outRate
    this.need = this.ratio
  }

  push(input: Float32Array): Float32Array {
    const out: number[] = []
    for (let i = 0; i < input.length; i++) {
      const s = input[i]
      if (this.need > 1) {
        this.sum += s
        this.need -= 1
      } else {
        // The sample is split between this output sample and the next.
        this.sum += s * this.need
        out.push(this.sum / this.ratio)
        this.sum = s * (1 - this.need)
        this.need = this.ratio - (1 - this.need)
      }
    }
    return Float32Array.from(out)
  }
}
