import { isLanguage } from './languages'

export const SETTINGS_STORAGE_KEY = 'suflyorSettings'

export interface Settings {
  /** The language spoken on the call. */
  source: string
  /** The language to translate into. Never equal to source. */
  target: string
  /** Off means only the original is shown. */
  translate: boolean
}

export const DEFAULT_SETTINGS: Settings = { source: 'en', target: 'ru', translate: true }

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** Copy for this page session, so a storage failure does not lose the choice. Null until the first save. */
let memory: Settings | null = null

/** Test helper: forget the in-memory copy. */
export function resetSettingsMemory(): void {
  memory = null
}

/** Soniox translates nothing when both languages match, so a pair is never equal. */
const distinct = (s: Settings): Settings =>
  s.source === s.target ? { ...s, target: s.source === 'ru' ? 'en' : 'ru' } : s

/** Saved settings, with defaults for anything missing or invalid. Never throws. */
export function loadSettings(storage: StorageLike | null = defaultStorage()): Settings {
  if (memory) return { ...memory }
  let raw: unknown = null
  try {
    const text = storage?.getItem(SETTINGS_STORAGE_KEY)
    raw = text ? JSON.parse(text) : null
  } catch {
    raw = null
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return distinct({
    source: isLanguage(o.source) ? o.source : DEFAULT_SETTINGS.source,
    target: isLanguage(o.target) ? o.target : DEFAULT_SETTINGS.target,
    translate: typeof o.translate === 'boolean' ? o.translate : DEFAULT_SETTINGS.translate
  })
}

/** Keeps a copy for this page session even if storage fails. */
export function saveSettings(settings: Settings, storage: StorageLike | null = defaultStorage()): void {
  memory = { ...settings }
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* the in-memory copy stays */
  }
}

/** A new source. When it equals the target, the two swap. */
export function withSource(s: Settings, code: string): Settings {
  return code === s.target ? { ...s, source: code, target: s.source } : { ...s, source: code }
}

/** A new target. When it equals the source, the two swap. */
export function withTarget(s: Settings, code: string): Settings {
  return code === s.source ? { ...s, target: code, source: s.target } : { ...s, target: code }
}

/** The language of the text the feed shows. */
export const feedLanguage = (s: Settings): string => (s.translate ? s.target : s.source)
