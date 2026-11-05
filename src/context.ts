export const CONTEXT_STORAGE_KEY = 'suflyorContext'
export const MAX_CONTEXT_CHARS = 100_000

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): StorageLike | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** Copy for this page session, so a storage failure does not lose the text. Null until the first save. */
let memory: string | null = null

/** Saved call context, or an empty string. Never throws. */
export function loadContext(storage: StorageLike | null = defaultStorage()): string {
  if (memory !== null) return memory
  try {
    return storage?.getItem(CONTEXT_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Test helper: forget the in-memory copy. */
export function resetContextMemory(): void {
  memory = null
}

export interface SaveResult {
  /** The text reached storage (or was removed from it). */
  stored: boolean
  /** The text was longer than MAX_CONTEXT_CHARS and was cut. */
  cut: boolean
}

/** Saves the text, cut to MAX_CONTEXT_CHARS. Empty text removes it. The page keeps a copy even if storage fails. */
export function saveContext(text: string, storage: StorageLike | null = defaultStorage()): SaveResult {
  const has = !!text.trim()
  const kept = has ? text.slice(0, MAX_CONTEXT_CHARS) : ''
  memory = kept
  let stored = true
  try {
    if (!storage) stored = false
    else if (kept) storage.setItem(CONTEXT_STORAGE_KEY, kept)
    else storage.removeItem(CONTEXT_STORAGE_KEY)
  } catch {
    stored = false
  }
  return { stored, cut: has && text.length > MAX_CONTEXT_CHARS }
}
