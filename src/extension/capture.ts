/// <reference path="./chrome.d.ts" />
export interface CaptureOptions {
  tabId: number
  onPcm: (pcm: ArrayBuffer, peak: number) => void
  onEnded: () => void
}

/** Capture a tab's audio as 16 kHz mono PCM chunks. Returns a stop function. */
export async function startCapture({ tabId, onPcm, onEnded }: CaptureOptions): Promise<() => void> {
  const id = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId })
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: id } },
    video: false
  } as unknown as MediaStreamConstraints)

  // Attach before any async setup: a track that has already ended never fires again.
  stream.getAudioTracks()[0]?.addEventListener('ended', onEnded)

  let playCtx: AudioContext | undefined
  let pcmCtx: AudioContext | undefined
  const stop = (): void => {
    stream.getTracks().forEach((t) => t.stop())
    void playCtx?.close().catch(() => {})
    void pcmCtx?.close().catch(() => {})
  }

  try {
    playCtx = new AudioContext()
    pcmCtx = new AudioContext({ sampleRate: 16000 })
    // Tab capture mutes the tab: play it back at full quality.
    playCtx.createMediaStreamSource(stream).connect(playCtx.destination)

    await pcmCtx.audioWorklet.addModule(chrome.runtime.getURL('pcm-worklet.js'))
    const node = new AudioWorkletNode(pcmCtx, 'pcm-worklet', {
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    })
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => onPcm(e.data.pcm, e.data.peak)
    const silent = pcmCtx.createGain()
    silent.gain.value = 0
    pcmCtx.createMediaStreamSource(stream).connect(node)
    node.connect(silent).connect(pcmCtx.destination)

    await Promise.all([playCtx.resume(), pcmCtx.resume()])
  } catch (e) {
    stop()
    throw e
  }

  return stop
}
