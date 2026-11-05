import { beforeEach, describe, expect, it } from 'vitest'
import { CONTEXT_STORAGE_KEY, loadContext, MAX_CONTEXT_CHARS, resetContextMemory, saveContext } from './context'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k)
  }
}

const broken = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('blocked') },
  removeItem: () => { throw new Error('blocked') }
}

describe('context storage', () => {
  beforeEach(() => resetContextMemory())

  it('saves and loads under suflyorContext', () => {
    const s = fakeStorage()
    expect(loadContext(s)).toBe('')
    expect(saveContext('We sell Nimbus.', s)).toEqual({ stored: true, cut: false })
    expect(s.data.get('suflyorContext')).toBe('We sell Nimbus.')
    expect(CONTEXT_STORAGE_KEY).toBe('suflyorContext')
    expect(loadContext(s)).toBe('We sell Nimbus.')
  })

  it('cuts on save to 100000 characters', () => {
    const s = fakeStorage()
    const r = saveContext('a'.repeat(MAX_CONTEXT_CHARS + 50), s)
    expect(MAX_CONTEXT_CHARS).toBe(100_000)
    expect(r).toEqual({ stored: true, cut: true })
    expect(s.data.get('suflyorContext')).toHaveLength(MAX_CONTEXT_CHARS)
    expect(loadContext(s)).toHaveLength(MAX_CONTEXT_CHARS)
  })

  it('removes the key for empty or blank text', () => {
    const s = fakeStorage({ suflyorContext: 'old' })
    expect(saveContext('  \n ', s)).toEqual({ stored: true, cut: false })
    expect(s.data.has('suflyorContext')).toBe(false)
  })

  it('never throws when storage is blocked or missing', () => {
    expect(loadContext(broken)).toBe('')
    expect(saveContext('x', broken)).toEqual({ stored: false, cut: false })
    resetContextMemory()
    expect(loadContext(null)).toBe('')
    expect(saveContext('x', null)).toEqual({ stored: false, cut: false })
  })

  it('keeps a copy in memory when storage fails, and an empty save clears it', () => {
    saveContext('We sell Nimbus.', broken)
    expect(loadContext(broken)).toBe('We sell Nimbus.')
    expect(loadContext(null)).toBe('We sell Nimbus.')
    saveContext('', broken)
    expect(loadContext(broken)).toBe('')
  })
})
