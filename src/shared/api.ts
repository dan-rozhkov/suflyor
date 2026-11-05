import type {
  AppError,
  ContextResult,
  SessionStatus,
  SettingsPatch,
  SettingsResult,
  Suggestion,
  Utterance
} from './types'

/** Call to stop listening. */
export type Unsubscribe = () => void

/** Shape of `window.suflyor`, exposed by the preload script. */
export interface SuflyorApi {
  session: {
    /** Start capture session (Soniox + native audio helper, or demo). Resolves when the start request was handled; progress comes via onStatus. */
    start(): Promise<SessionStatus>
    stop(): Promise<SessionStatus>
    getStatus(): Promise<SessionStatus>
    onStatus(cb: (status: SessionStatus) => void): Unsubscribe
  }
  transcript: {
    /** Upsert by utterance.id. */
    onUtterance(cb: (utterance: Utterance) => void): Unsubscribe
  }
  suggestions: {
    /** Manual request. Updates arrive via onUpdate. */
    request(): Promise<void>
    /** Upsert by suggestion.id. */
    onUpdate(cb: (suggestion: Suggestion) => void): Unsubscribe
  }
  settings: {
    get(): Promise<import('./types').SettingsView>
    set(patch: SettingsPatch): Promise<SettingsResult>
  }
  context: {
    get(): Promise<ContextResult>
    /** Opens the native md file dialog. Cancel keeps the current context. */
    pick(): Promise<ContextResult>
    /** For drag and drop: resolves the dropped File's path in preload and loads it. */
    loadDropped(file: File): Promise<ContextResult>
    clear(): Promise<ContextResult>
  }
  system: {
    /** Opens System Settings > Privacy & Security > Screen & System Audio Recording. */
    openScreenRecordingSettings(): Promise<void>
    /** Opens System Settings > Privacy & Security > Microphone. */
    openMicrophoneSettings(): Promise<void>
  }
  /** Errors not tied to a call (network drop, API error mid-stream). */
  onError(cb: (error: AppError) => void): Unsubscribe
}
