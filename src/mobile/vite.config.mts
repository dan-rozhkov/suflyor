import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const here = import.meta.dirname

export default defineConfig({
  root: here,
  base: './',
  build: {
    outDir: resolve(here, '../../out/mobile'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        index: resolve(here, 'index.html'),
        'mic-worklet': resolve(here, 'mic-worklet.ts')
      },
      output: { entryFileNames: '[name].js' }
    }
  }
})
