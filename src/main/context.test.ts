import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createContextStore, ContextError, readContextFile } from './context'

const dir = mkdtempSync(join(tmpdir(), 'suflyor-ctx-'))
const write = (name: string, body: string): string => {
  const p = join(dir, name)
  writeFileSync(p, body)
  return p
}

describe('context', () => {
  it('reads a small md file', async () => {
    const { file, text } = await readContextFile(write('a.md', '# hi'))
    expect(file.name).toBe('a.md')
    expect(text).toBe('# hi')
  })

  it('rejects non-md and oversized files', async () => {
    await expect(readContextFile(write('a.txt', 'x'))).rejects.toBeInstanceOf(ContextError)
    await expect(readContextFile(write('big.md', 'x'.repeat(100 * 1024 + 1)))).rejects.toBeInstanceOf(ContextError)
  })

  it('remembers, restores and clears the path', async () => {
    let saved: string | null = null
    const p = write('c.md', 'ctx')
    const mk = () =>
      createContextStore({ getPath: () => saved, setPath: (x) => (saved = x), showOpenDialog: async () => p })
    const a = mk()
    expect((await a.pick())?.name).toBe('c.md')
    expect(saved).toBe(p)
    const b = mk()
    expect((await b.restore())?.name).toBe('c.md')
    expect(b.getText()).toBe('ctx')
    b.clear()
    expect(saved).toBeNull()
    expect(b.current()).toBeNull()
  })
})
