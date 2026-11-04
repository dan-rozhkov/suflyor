import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_SETTINGS } from '../shared/types'
import type { AppError, AppSettings, SettingsPatch, SettingsView } from '../shared/types'

/** Abstraction over Electron safeStorage so the store is testable without Electron. */
export interface SecretCipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export type KeyName = 'soniox' | 'opencode'

interface StoredFile {
  settings: AppSettings
  /** base64 of safeStorage-encrypted key. */
  keys: Partial<Record<KeyName, string>>
  /** Remembered md context path. */
  contextPath: string | null
}

export class SettingsError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message)
  }
}

/** Parse a .env file body. Supports `KEY=value`, quotes, comments. Never logs values. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export function readEnvFile(path: string): Record<string, string> {
  try {
    return parseEnv(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

const ENV_NAMES: Record<KeyName, string> = { soniox: 'SONIOX_API_KEY', opencode: 'OPENCODE_API_KEY' }

export interface SettingsStoreOptions {
  /** Absolute path to settings.json (inside userData). */
  filePath: string
  cipher: SecretCipher
  /** Dev-only fallback values (from project .env). Pass {} in production. */
  envFallback?: Record<string, string>
}

export interface SettingsStore {
  get(): AppSettings
  /** Safe for renderer: no key values. */
  getView(): SettingsView
  /** Main-process only. Stored key first, then dev .env fallback. */
  getKey(name: KeyName): string | undefined
  hasKey(name: KeyName): boolean
  /** Applies patch, persists. Throws SettingsError if a key cannot be encrypted. */
  update(patch: SettingsPatch): SettingsView
  getContextPath(): string | null
  setContextPath(path: string | null): void
}

function sanitize(input: unknown): AppSettings {
  const o = (input ?? {}) as Partial<AppSettings>
  return {
    model: typeof o.model === 'string' && o.model.trim() ? o.model.trim() : DEFAULT_SETTINGS.model,
    autoSuggest: typeof o.autoSuggest === 'boolean' ? o.autoSuggest : DEFAULT_SETTINGS.autoSuggest,
    alwaysOnTop: typeof o.alwaysOnTop === 'boolean' ? o.alwaysOnTop : DEFAULT_SETTINGS.alwaysOnTop
  }
}

export function createSettingsStore(opts: SettingsStoreOptions): SettingsStore {
  const env = opts.envFallback ?? {}

  function load(): StoredFile {
    try {
      const parsed = JSON.parse(readFileSync(opts.filePath, 'utf8')) as Partial<StoredFile>
      return {
        settings: sanitize(parsed.settings),
        keys: parsed.keys && typeof parsed.keys === 'object' ? { ...parsed.keys } : {},
        contextPath: typeof parsed.contextPath === 'string' ? parsed.contextPath : null
      }
    } catch {
      return { settings: { ...DEFAULT_SETTINGS }, keys: {}, contextPath: null }
    }
  }

  let state = load()

  function save(): void {
    mkdirSync(dirname(opts.filePath), { recursive: true })
    const tmp = join(dirname(opts.filePath), `.settings.${process.pid}.tmp`)
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
    renameSync(tmp, opts.filePath)
  }

  function getKey(name: KeyName): string | undefined {
    const enc = state.keys[name]
    if (enc && opts.cipher.isAvailable()) {
      try {
        const v = opts.cipher.decrypt(Buffer.from(enc, 'base64'))
        if (v) return v
      } catch {
        // fall through to env fallback
      }
    }
    const fromEnv = env[ENV_NAMES[name]]
    return fromEnv ? fromEnv : undefined
  }

  const store: SettingsStore = {
    get: () => ({ ...state.settings }),
    getView: () => ({
      ...state.settings,
      keys: { soniox: !!getKey('soniox'), opencode: !!getKey('opencode') }
    }),
    getKey,
    hasKey: (name) => !!getKey(name),
    update(patch) {
      const next = { ...state, settings: { ...state.settings }, keys: { ...state.keys } }
      next.settings = sanitize({ ...state.settings, ...stripKeys(patch) })
      for (const [field, name] of [
        ['sonioxKey', 'soniox'],
        ['opencodeKey', 'opencode']
      ] as const) {
        const v = patch[field]
        if (v === undefined) continue
        if (v === null || v.trim() === '') {
          delete next.keys[name]
          continue
        }
        if (!opts.cipher.isAvailable()) {
          throw new SettingsError({
            code: 'settings',
            message: 'Secure storage is unavailable. Key not saved.'
          })
        }
        next.keys[name] = opts.cipher.encrypt(v.trim()).toString('base64')
      }
      state = next
      save()
      return store.getView()
    },
    getContextPath: () => state.contextPath,
    setContextPath(path) {
      state = { ...state, contextPath: path }
      save()
    }
  }
  return store
}

function stripKeys(patch: SettingsPatch): Partial<AppSettings> {
  const { sonioxKey: _s, opencodeKey: _o, ...rest } = patch
  void _s
  void _o
  return rest
}
