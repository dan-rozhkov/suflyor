import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { AppError, ContextResult, SettingsPatch, SettingsResult } from '../shared/types'
import { ContextError, createContextStore } from './context'
import { createAudioHelper, helperPath } from './capture'
import { createSession } from './session'
import { createSettingsStore, readEnvFile, SettingsError } from './settings'
import { createSuggestions } from './suggestions'

const SCREEN_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

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

  const suggestions = createSuggestions({
    sink: {
      suggestion: (s) => send(IPC.suggestionUpdate, s),
      error: (e) => send(IPC.appError, e)
    },
    getApiKey: () => settings.getKey('opencode'),
    getModel: () => settings.get().model,
    isAutoEnabled: () => settings.get().autoSuggest,
    getContextText: () => context.getText(),
    getTranscript: () => session.getTranscript(),
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
        if (s.state === 'idle' || s.state === 'error') helper.stop()
        send(IPC.sessionStatus, s)
      },
      utterance: (u) => send(IPC.utteranceUpdate, u),
      error: (e) => send(IPC.appError, e)
    },
    getSonioxKey: () => settings.getKey('soniox'),
    getContextText: () => context.getText(),
    demo,
    onUtterance: (u) => suggestions.onUtterance(u)
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
    // A stop may have been queued behind this start: only spawn the helper if the session is still running.
    const st = session.getStatus().state
    if (!demo && (st === 'starting' || st === 'listening' || st === 'reconnecting')) helper.start()
    return session.getStatus()
  })
  ipcMain.handle(IPC.sessionStop, async () => {
    suggestions.cancel()
    helper.stop()
    return session.stop()
  })
  ipcMain.handle(IPC.sessionGetStatus, () => session.getStatus())
  ipcMain.handle(IPC.suggestionsRequest, () => suggestions.request('manual'))

  ipcMain.handle(IPC.settingsGet, () => settings.getView())
  ipcMain.handle(IPC.settingsSet, (_e, patch: SettingsPatch): SettingsResult => {
    try {
      const view = settings.update(patch ?? {})
      if (patch?.alwaysOnTop !== undefined) applyAlwaysOnTop(view.alwaysOnTop)
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

  return {
    /** Window closed: stop capture and any suggestion request. */
    stopAll() {
      suggestions.cancel()
      helper.stop()
      void session.stop().then(() => suggestions.cancel())
    },
    dispose() {
      helper.stop()
      session.dispose()
      suggestions.dispose()
    }
  }
}
