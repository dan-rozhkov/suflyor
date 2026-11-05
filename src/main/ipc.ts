import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, systemPreferences } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { AppError, ContextResult, SettingsPatch, SettingsResult } from '../shared/types'
import { ContextError, createContextStore } from './context'
import { createAudioHelper, helperPath } from './capture'
import { createConversation } from './conversation'
import { stripFillers } from './fillers'
import { createMicController, createMicFeed } from './mic'
import { createSession } from './session'
import { createSettingsStore, readEnvFile, SettingsError } from './settings'
import { createSuggestions } from './suggestions'

const SCREEN_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
const MIC_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'

function unknownError(e: unknown): AppError {
  return { code: 'unknown', message: 'Something went wrong.', detail: e instanceof Error ? e.message : undefined }
}

/** Wires settings, context, session and suggestions to IPC. Call once after app ready. */
export async function registerIpc(getWindow: () => BrowserWindow | null, applyAlwaysOnTop: (on: boolean) => void) {
  const demo = process.env.SUFLYOR_DEMO === '1'
  const send = (channel: string, payload: unknown): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }

  const settings = createSettingsStore({
    filePath: join(app.getPath('userData'), 'settings.json'),
    cipher: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s),
      decrypt: (b) => safeStorage.decryptString(b)
    },
    envFallback: app.isPackaged ? {} : readEnvFile(join(app.getAppPath(), '.env'))
  })

  const context = createContextStore({
    getPath: () => settings.getContextPath(),
    setPath: (p) => settings.setContextPath(p),
    async showOpenDialog() {
      const w = getWindow()
      const opts = {
        title: 'Context file',
        properties: ['openFile' as const],
        filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
      }
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
    }
  })
  await context.restore()

  /** Both sides of the call, for suggestions only. The user's speech never reaches the renderer. */
  const conversation = createConversation()

  const suggestions = createSuggestions({
    sink: {
      suggestion: (s) => send(IPC.suggestionUpdate, s),
      error: (e) => send(IPC.appError, e)
    },
    getApiKey: () => settings.getKey('opencode'),
    getModel: () => settings.get().model,
    isAutoEnabled: () => settings.get().autoSuggest,
    getContextText: () => context.getText(),
    getTranscript: () => conversation.list(),
    demo
  })

  const helper = createAudioHelper({
    path: helperPath(app.isPackaged, app.getAppPath(), process.resourcesPath),
    onChunk: (b) => session.pushAudio(b),
    onError: (e) => session.reportError(e)
  })

  const session = createSession({
    sink: {
      status: (s) => {
        if (s.state === 'idle' || s.state === 'error') {
          helper.stop()
          mic.stop()
        }
        send(IPC.sessionStatus, s)
      },
      utterance: (u) => {
        send(IPC.utteranceUpdate, u)
        if (stripFillers(u.en).trim()) conversation.addThem(u)
      },
      error: (e) => send(IPC.appError, e)
    },
    getSonioxKey: () => settings.getKey('soniox'),
    getContextText: () => context.getText(),
    demo,
    onUtterance: (u) => suggestions.onUtterance(u)
  })

  // Microphone: a second helper and a transcription-only Soniox session. Failures stay inside `mic` (see mic.ts):
  // they never touch the main session, and the mic session's status is never sent to the renderer.
  const micHelper = createAudioHelper({
    path: helperPath(app.isPackaged, app.getAppPath(), process.resourcesPath),
    args: ['--mic'],
    onChunk: (b) => micSession.pushAudio(b),
    onError: (e) => mic.reportError(e)
  })
  const micFeed = createMicFeed({ conversation, onMine: (u) => suggestions.onMyUtterance(u) })
  const micSession = createSession({
    sink: {
      status: () => {},
      utterance: (u) => micFeed.sink(u),
      error: (e) => mic.reportError(e)
    },
    getSonioxKey: () => settings.getKey('soniox'),
    getContextText: () => context.getText(),
    demo: false,
    translate: false,
    idPrefix: 'm',
    // Neither teardown nor reconnect flushes reach onUtterance (feedOnReconnect false), so they cannot cancel a suggestion.
    feedOnReconnect: false,
    onUtterance: (u) => micFeed.live(u)
  })
  const isMainRunning = (): boolean => {
    const st = session.getStatus().state
    return st === 'starting' || st === 'listening' || st === 'reconnecting'
  }
  const mic = createMicController({
    enabled: () => settings.get().micEnabled,
    isMainRunning,
    async requestAccess() {
      const st = systemPreferences.getMediaAccessStatus('microphone')
      if (st === 'granted') return true
      if (st === 'not-determined') return systemPreferences.askForMediaAccess('microphone')
      return false
    },
    helper: micHelper,
    // The feed is open only while the mic runs: a flush from an old run's async stop is dropped, not added to the next call.
    session: {
      start: () => {
        micFeed.open()
        return micSession.start()
      },
      stop: () => {
        micFeed.close()
        return micSession.stop()
      }
    },
    notify: (e) => send(IPC.appError, e)
  })

  applyAlwaysOnTop(settings.get().alwaysOnTop)

  const ctxResult = async (fn: () => Promise<unknown> | unknown): Promise<ContextResult> => {
    try {
      await fn()
      return { ok: true, context: context.current() }
    } catch (e) {
      return { ok: false, error: e instanceof ContextError ? e.appError : unknownError(e) }
    }
  }

  ipcMain.handle(IPC.sessionStart, async () => {
    await session.start()
    // After start: it first tears down the previous run, so that run's flushes are already in. New speech cannot be earlier.
    conversation.clear() // one call's turns never reach the next
    // A stop may have been queued behind this start: only spawn the helper if the session is still running.
    if (!demo && isMainRunning()) {
      helper.start()
      // Not awaited: the permission prompt must never hold up translation.
      void mic.start()
    }
    return session.getStatus()
  })
  ipcMain.handle(IPC.sessionStop, async () => {
    suggestions.cancel()
    helper.stop()
    mic.stop()
    return session.stop()
  })
  ipcMain.handle(IPC.sessionGetStatus, () => session.getStatus())
  ipcMain.handle(IPC.suggestionsRequest, () => suggestions.request('manual'))

  ipcMain.handle(IPC.settingsGet, () => settings.getView())
  ipcMain.handle(IPC.settingsSet, (_e, patch: SettingsPatch): SettingsResult => {
    try {
      const view = settings.update(patch ?? {})
      if (patch?.alwaysOnTop !== undefined) applyAlwaysOnTop(view.alwaysOnTop)
      if (patch?.micEnabled !== undefined && !demo) {
        if (view.micEnabled) void mic.start()
        else mic.stop()
      }
      return { ok: true, settings: view }
    } catch (e) {
      return { ok: false, error: e instanceof SettingsError ? e.appError : unknownError(e) }
    }
  })

  ipcMain.handle(IPC.contextGet, () => ctxResult(() => {}))
  ipcMain.handle(IPC.contextPick, () => ctxResult(() => context.pick()))
  ipcMain.handle(IPC.contextLoadPath, (_e, path: unknown) =>
    ctxResult(() => {
      if (typeof path !== 'string' || !path) throw new ContextError({ code: 'context', message: "Couldn't read the file." })
      return context.loadPath(path)
    })
  )
  ipcMain.handle(IPC.contextClear, () => ctxResult(() => context.clear()))

  ipcMain.handle(IPC.systemOpenScreenSettings, async () => {
    await shell.openExternal(SCREEN_SETTINGS_URL)
  })
  ipcMain.handle(IPC.systemOpenMicSettings, async () => {
    await shell.openExternal(MIC_SETTINGS_URL)
  })

  return {
    /** Window closed: stop capture and any suggestion request. */
    stopAll() {
      suggestions.cancel()
      helper.stop()
      mic.stop()
      void session.stop().then(() => suggestions.cancel())
    },
    dispose() {
      helper.stop()
      mic.stop()
      micFeed.close()
      micSession.dispose()
      session.dispose()
      suggestions.dispose()
    }
  }
}
