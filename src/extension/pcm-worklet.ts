/// <reference path="./chrome.d.ts" />
import { floatToPcm16, peakOf } from './pcm'

const FRAME = 1600 // 100 ms at 16 kHz

class PcmProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(FRAME)
  private fill = 0

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0]
    if (!ch) return true
    let i = 0
    while (i < ch.length) {
      const n = Math.min(FRAME - this.fill, ch.length - i)
      this.buf.set(ch.subarray(i, i + n), this.fill)
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

registerProcessor('pcm-worklet', PcmProcessor)
