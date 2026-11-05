/// <reference path="./globals.d.ts" />
import { floatToPcm16, peakOf } from './pcm'
import { Downsampler } from './downsample'

const FRAME = 1600 // 100 ms at 16 kHz

class MicProcessor extends AudioWorkletProcessor {
  private down = new Downsampler(sampleRate)
  private buf = new Float32Array(FRAME)
  private fill = 0

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0]
    if (!ch) return true
    const out = this.down.push(ch)
    let i = 0
    while (i < out.length) {
      const n = Math.min(FRAME - this.fill, out.length - i)
      this.buf.set(out.subarray(i, i + n), this.fill)
      this.fill += n
      i += n
      if (this.fill === FRAME) {
        const pcm = floatToPcm16(this.buf).buffer
        this.port.postMessage({ pcm, peak: peakOf(this.buf) }, [pcm])
        this.fill = 0
      }
    }
    return true
  }
}

registerProcessor('mic-worklet', MicProcessor)
