import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const here = import.meta.dirname

export default defineConfig({
  root: resolve(here, 'src'),
  publicDir: resolve(here, 'src/public'),
  // A manifest and icons need stable absolute paths.
  base: '/',
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        index: resolve(here, 'src/index.html'),
        'mic-worklet': resolve(here, 'src/mic-worklet.ts')
      },
      output: { entryFileNames: '[name].js' }
    }
  }
})
