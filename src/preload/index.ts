import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { SuflyorApi, Unsubscribe } from '../shared/api'

function on<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: SuflyorApi = {
  session: {
    start: () => ipcRenderer.invoke(IPC.sessionStart),
    stop: () => ipcRenderer.invoke(IPC.sessionStop),
    getStatus: () => ipcRenderer.invoke(IPC.sessionGetStatus),
    onStatus: (cb) => on(IPC.sessionStatus, cb)
  },
  transcript: {
    onUtterance: (cb) => on(IPC.utteranceUpdate, cb)
  },
  suggestions: {
    request: () => ipcRenderer.invoke(IPC.suggestionsRequest),
    onUpdate: (cb) => on(IPC.suggestionUpdate, cb)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  context: {
    get: () => ipcRenderer.invoke(IPC.contextGet),
    pick: () => ipcRenderer.invoke(IPC.contextPick),
    loadDropped: (file) => ipcRenderer.invoke(IPC.contextLoadPath, webUtils.getPathForFile(file)),
    clear: () => ipcRenderer.invoke(IPC.contextClear)
  },
  system: {
    openScreenRecordingSettings: () => ipcRenderer.invoke(IPC.systemOpenScreenSettings),
    openMicrophoneSettings: () => ipcRenderer.invoke(IPC.systemOpenMicSettings)
  },
  onError: (cb) => on(IPC.appError, cb)
}

contextBridge.exposeInMainWorld('suflyor', api)
