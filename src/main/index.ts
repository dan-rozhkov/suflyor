import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'

let win: BrowserWindow | null = null
/** Last requested always-on-top value; reapplied to recreated windows. */
let desiredOnTop = true
let stopAll: (() => void) | null = null

function applyAlwaysOnTop(on: boolean): void {
  desiredOnTop = on
  if (!win || win.isDestroyed()) return
  if (on) {
    win.setAlwaysOnTop(true, 'screen-saver')
    // skipTransformProcessType keeps the Dock icon.
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  } else {
    win.setAlwaysOnTop(false)
    win.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true })
  }
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 360,
    minHeight: 520,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 19 },
    backgroundColor: '#000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  // Best effort only: capture protection does not always work. The UI must not promise invisibility.
  w.setContentProtection(true)
  w.once('ready-to-show', () => w.show())
  w.on('closed', () => {
    if (win === w) win = null
    stopAll?.() // closing the window ends the capture session
  })

  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e, url) => {
    if (url !== w.webContents.getURL()) e.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void w.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void w.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return w
}

app.whenReady().then(async () => {
  win = createWindow()
  const ipc = await registerIpc(() => win, applyAlwaysOnTop)
  stopAll = () => ipc.stopAll()
  app.on('before-quit', () => ipc.dispose())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      win = createWindow()
      applyAlwaysOnTop(desiredOnTop)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
