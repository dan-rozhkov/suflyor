/** Shared domain types. Change the contract only in src/shared. */

export interface Utterance {
  id: string
  /** English source text (may be partial while isFinal is false). */
  en: string
  /** Russian translation (may be partial). */
  ru: string
  isFinal: boolean
  /** Who spoke. Absent means 'them' (the other side). 'me' comes from the microphone and is never shown in the feed. */
  speaker?: 'them' | 'me'
}

export type SuggestionTrigger = 'auto' | 'manual'
export type SuggestionStatus = 'streaming' | 'done' | 'cancelled' | 'error'

/** One streamed update of a suggestion set. Upsert by `id`; each update carries the full parsed state so far. */
export interface Suggestion {
  id: string
  /** Utterance this suggestion answers (last utterance at request time). */
  utteranceId: string | null
  trigger: SuggestionTrigger
  status: SuggestionStatus
  /** 2-3 short English reply options to say aloud. */
  options: string[]
  /** Russian explanation of the meaning of the options. */
  meaningRu: string
}

export type SessionState = 'idle' | 'starting' | 'listening' | 'reconnecting' | 'stopping' | 'error'

export interface SessionStatus {
  state: SessionState
  /** True when running the scripted demo (SUFLYOR_DEMO=1). */
  demo: boolean
  /** Set when state is 'error' (or a recoverable problem while reconnecting). */
  error?: AppError
}

export type AppErrorCode =
  | 'no-keys' // a required API key is missing
  | 'no-screen-permission' // macOS screen/system audio recording not granted
  | 'no-mic-permission' // macOS microphone access not granted
  | 'network' // connection lost / offline
  | 'api' // Soniox or OpenCode returned an error
  | 'context' // md context file problem (too large, unreadable, wrong type)
  | 'settings' // settings could not be saved (e.g. safeStorage unavailable)
  | 'audio' // capture / worklet failure
  | 'mic' // the microphone part stopped; translation continues
  | 'unknown'

export interface AppError {
  code: AppErrorCode
  /** Short Russian message, safe to show in UI. Never contains secrets. */
  message: string
  /** Optional technical detail, never contains secrets. */
  detail?: string
}

/** Non-secret settings. */
export interface AppSettings {
  /** OpenCode model id. */
  model: string
  autoSuggest: boolean
  alwaysOnTop: boolean
  /** Capture the microphone so suggestions know what the user said. Second Soniox stream. */
  micEnabled: boolean
}

/** What the renderer sees: settings plus whether each key is set. Key values never cross IPC to the renderer. */
export interface SettingsView extends AppSettings {
  keys: { soniox: boolean; opencode: boolean }
}

/**
 * Patch sent renderer -> main. Key fields: string sets, null clears, undefined leaves unchanged.
 * (Keys travel renderer -> main once at entry; they are never returned.)
 */
export interface SettingsPatch extends Partial<AppSettings> {
  sonioxKey?: string | null
  opencodeKey?: string | null
}

export interface ContextFile {
  name: string
  path: string
  /** Size in bytes. */
  size: number
}

export type SettingsResult = { ok: true; settings: SettingsView } | { ok: false; error: AppError }

/** Context pick/clear/load result. `context` is the current context after the call (null if none). */
export type ContextResult = { ok: true; context: ContextFile | null } | { ok: false; error: AppError }

export const DEFAULT_SETTINGS: AppSettings = {
  model: 'deepseek-v4.1-flash',
  autoSuggest: true,
  alwaysOnTop: true,
  micEnabled: true
}

export const MAX_CONTEXT_BYTES = 100 * 1024
