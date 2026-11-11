// AudioWorklet global scope (not in the DOM lib).
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void
declare const sampleRate: number

// Side-effect stylesheet imports are bundled by Vite.
declare module '*.css'

// SVG files imported as source text with Vite's ?raw suffix.
declare module '*.svg?raw' {
  const source: string
  export default source
}

// Image files imported as a URL with Vite's ?url suffix.
declare module '*.svg?url' {
  const url: string
  export default url
}

// Vite's glob import, used by the icon tests to read the pack as text.
interface ImportMeta {
  glob(pattern: string, options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>
}
