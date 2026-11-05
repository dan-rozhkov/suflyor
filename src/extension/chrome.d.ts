// Minimal declarations for the Chrome APIs this prototype uses (@types/chrome is not installed).
declare namespace chrome {
  namespace action {
    const onClicked: { addListener(cb: (tab: tabs.Tab) => void): void }
  }
  namespace tabs {
    interface Tab {
      id?: number
      windowId?: number
      title?: string
    }
  }
  namespace sidePanel {
    function open(options: { windowId: number }): Promise<void>
  }
  namespace storage {
    interface StorageChange {
      oldValue?: unknown
      newValue?: unknown
    }
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
    }
    const session: StorageArea
    const onChanged: {
      addListener(cb: (changes: Record<string, StorageChange>, area: string) => void): void
    }
  }
  namespace tabCapture {
    function getMediaStreamId(options: { targetTabId?: number }): Promise<string>
  }
  namespace runtime {
    function getURL(path: string): string
  }
}

// AudioWorklet global scope (not in the DOM lib).
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void
