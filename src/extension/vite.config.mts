import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const here = import.meta.dirname

export default defineConfig({
  root: here,
  base: './',
  publicDir: resolve(here, 'public'),
  build: {
    outDir: resolve(here, '../../out/extension'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(here, 'sidepanel.html'),
        background: resolve(here, 'background.ts'),
        'pcm-worklet': resolve(here, 'pcm-worklet.ts')
      },
      output: { entryFileNames: '[name].js' }
    }
  }
})
