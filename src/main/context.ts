import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { MAX_CONTEXT_BYTES } from '../shared/types'
import type { AppError, ContextFile } from '../shared/types'

export class ContextError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message)
  }
}

/** Validates and reads a markdown context file. Throws ContextError. */
export async function readContextFile(path: string): Promise<{ file: ContextFile; text: string }> {
  const ext = extname(path).toLowerCase()
  if (ext !== '.md' && ext !== '.markdown') {
    throw new ContextError({ code: 'context', message: 'Use a Markdown file (.md).' })
  }
  let size: number
  try {
    const st = await stat(path)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
  } catch {
    throw new ContextError({ code: 'context', message: "Couldn't read the file." })
  }
  if (size > MAX_CONTEXT_BYTES) {
    throw new ContextError({
      code: 'context',
      message: `File is over ${MAX_CONTEXT_BYTES / 1024} KB.`
    })
  }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    throw new ContextError({ code: 'context', message: "Couldn't read the file." })
  }
  return { file: { name: basename(path), path, size }, text }
}

export interface ContextStoreOptions {
  getPath(): string | null
  setPath(path: string | null): void
  /** Shows the native dialog; returns chosen path or null on cancel. Injected from Electron. */
  showOpenDialog(): Promise<string | null>
}

export interface ContextStore {
  /** Re-reads the remembered file. Drops the remembered path if it is gone or invalid. */
  restore(): Promise<ContextFile | null>
  current(): ContextFile | null
  /** Text for the LLM prompt, '' if no context. Main-process only. */
  getText(): string
  pick(): Promise<ContextFile | null>
  loadPath(path: string): Promise<ContextFile | null>
  clear(): void
}

export function createContextStore(opts: ContextStoreOptions): ContextStore {
  let file: ContextFile | null = null
  let text = ''

  async function load(path: string): Promise<ContextFile> {
    const res = await readContextFile(path)
    file = res.file
    text = res.text
    opts.setPath(path)
    return file
  }

  return {
    async restore() {
      const p = opts.getPath()
      if (!p) return null
      try {
        return await load(p)
      } catch {
        file = null
        text = ''
        opts.setPath(null)
        return null
      }
    },
    current: () => file,
    getText: () => text,
    async pick() {
      const p = await opts.showOpenDialog()
      if (!p) return file
      return load(p)
    },
    loadPath: (p) => load(p),
    clear() {
      file = null
      text = ''
      opts.setPath(null)
    }
  }
}
