import { WATCHDOG_INTERVAL_MS, watchdogAction } from './watchdog'

const SETUP_TIMEOUT_MS = 8000

export interface MicOptions {
  onPcm: (pcm: ArrayBuffer, peak: number) => void
  /** The microphone stopped by itself: track ended or muted, the audio context was interrupted or closed, or frames stopped. */
  onLost: () => void
}

/**
 * Capture the microphone as 16 kHz mono PCM chunks. Call it directly from a tap handler:
 * the AudioContext is created and resumed before the first await, to keep the tap's user activation.
 * Returns a stop function. Throws if setup fails, after releasing everything.
 */
export async function startMic({ onPcm, onLost }: MicOptions): Promise<() => void> {
  let stopped = false
  let ready = false
  let stream: MediaStream | undefined
  let watchdog: ReturnType<typeof setInterval> | undefined
  let lastFrameAt = Date.now()
  const ctx = new AudioContext()
  void ctx.resume().catch(() => {})

  const release = (): void => {
    stopped = true
    clearInterval(watchdog)
    stream?.getTracks().forEach((t) => t.stop())
    void ctx.close().catch(() => {})
  }
  // Loss only counts after setup: an interruption during the permission prompt must not fail the first Start.
  const lost = (): void => {
    if (!stopped && ready) onLost()
  }
  // Safari reports 'interrupted' (phone call, Siri), which is not in the DOM typings.
  ctx.addEventListener('statechange', () => {
    const state: string = ctx.state
    if (state === 'suspended') {
      if (ready && !stopped) void ctx.resume().catch(() => {})
    } else if (state === 'interrupted' || state === 'closed') lost()
  })

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 }
    })
    const track = stream.getAudioTracks()[0]
    // Attach before more async setup: a track that has already ended never fires again.
    track?.addEventListener('ended', lost)
    track?.addEventListener('mute', lost)
    const media = stream
    // The prompt is over, so the rest must settle: otherwise the session would hang in 'starting'.
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The microphone setup timed out.')), SETUP_TIMEOUT_MS)
    })
    const setup = (async (): Promise<void> => {
      await ctx.audioWorklet.addModule('./mic-worklet.js')
      const node = new AudioWorkletNode(ctx, 'mic-worklet', {
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers'
      })
      node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => {
        lastFrameAt = Date.now()
        if (!stopped) onPcm(e.data.pcm, e.data.peak)
      }
      const silent = ctx.createGain()
      silent.gain.value = 0
      ctx.createMediaStreamSource(media).connect(node)
      node.connect(silent).connect(ctx.destination)
      await ctx.resume()
    })()
    setup.catch(() => {})
    try {
      await Promise.race([setup, timeout])
    } finally {
      clearTimeout(timer)
    }
    // Loss signals are ignored during setup, and they do not fire twice: check the end state once.
    const state: string = ctx.state
    if (stream?.getAudioTracks()[0]?.readyState === 'ended' || state === 'interrupted') {
      throw new Error('The microphone stopped during setup.')
    }
    lastFrameAt = Date.now()
    let lastTick = lastFrameAt
    watchdog = setInterval(() => {
      const now = Date.now()
      // A long gap between ticks means the page was frozen, not that audio stopped: start the window again.
      if (now - lastTick > WATCHDOG_INTERVAL_MS * 2) lastFrameAt = now
      lastTick = now
      const action = watchdogAction(now - lastFrameAt)
      if (action === 'resume') void ctx.resume().catch(() => {})
      else if (action === 'lost') lost()
    }, WATCHDOG_INTERVAL_MS)
    ready = true
  } catch (e) {
    release()
    throw e
  }
  return release
}
