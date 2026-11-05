import '@fontsource-variable/nunito'
import './tokens.css'
import './app.css'
import type { Utterance } from './types'
import { englishForHero, splitLast } from './sentences'
import { createSonioxClient } from './soniox'
import { canAddToHomeScreen, isStandalone } from './install'
import { startMic } from './mic'
import { createSession, MIC_DENIED_MESSAGE, type SessionState } from './session'
import { BAD_CODE_MESSAGE, fetchToken } from './token'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const formEl = $<HTMLFormElement>('code-form')
const codeEl = $<HTMLInputElement>('code')
const codeErrorEl = $<HTMLElement>('code-error')
const feedWrapEl = $<HTMLElement>('feed-wrap')
const feedEl = $<HTMLElement>('feed')
const toggleEl = $<HTMLButtonElement>('toggle')
const statusEl = $<HTMLElement>('status')
const statusIconEl = $<HTMLElement>('status-icon')
const statusTextEl = $<HTMLElement>('status-text')
const diagEl = $<HTMLElement>('diag')
const forgetEl = $<HTMLButtonElement>('forget')
const installEl = $<HTMLButtonElement>('install')
const installPanelEl = $<HTMLElement>('install-panel')
const copyStepEl = $<HTMLElement>('copy-step')
const copyEl = $<HTMLButtonElement>('copy-code')
const copyFailEl = $<HTMLElement>('copy-fail')
const installDoneEl = $<HTMLButtonElement>('install-done')
const codeHintEl = $<HTMLElement>('code-hint')
const barEl = $<HTMLElement>('bar')
const timerEl = $<HTMLElement>('timer')
const waveEl = $<HTMLElement>('wave')
const elapsedEl = $<HTMLElement>('elapsed')

const STORAGE_KEY = 'suflyorAccessCode'
const NO_LOCK_NOTICE = 'Keep the screen on: locking it stops the microphone.'

const SVG_OPEN = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" '
const STOP_ICON = `${SVG_OPEN}data-pen-icon="Stop"><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.75" /></svg>`
const ALERT_ICON = `${SVG_OPEN}data-pen-icon="WarningCircle"><circle cx="8" cy="8" r="6" /><path d="M8 4.75v3.5M8 11v.01" /></svg>`
const REFRESH_ICON = `${SVG_OPEN}data-pen-icon="ArrowClockwise"><path d="M13.25 8A5.25 5.25 0 1 1 11.7 4.3M11.7 1.8v2.5H9.2" /></svg>`

function readCode(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}
function writeCode(code: string): void {
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* private mode or blocked storage: the code lasts until the page closes */
  }
}

let code = readCode()

/** Take the code from a `#code=` link and remove it from the address bar. */
function takeCodeFromHash(): boolean {
  // Not URLSearchParams: it turns '+' into a space and would corrupt the code.
  const m = /^#code=(.*)$/.exec(location.hash)
  if (!m) return false
  let fromUrl = m[1]
  try {
    fromUrl = decodeURIComponent(fromUrl)
  } catch {
    /* not valid percent-encoding: use the text as it is */
  }
  fromUrl = fromUrl.trim()
  history.replaceState(null, '', location.pathname + location.search)
  if (!fromUrl) return false
  code = fromUrl
  writeCode(code)
  return true
}
takeCodeFromHash()

let running = false
let phase: SessionState['phase'] = 'idle'
let sentSamples = 0
let peak = 0
let elapsedTimer: number | undefined
let startedAt = 0
let wakeLock: WakeLockSentinel | null = null
let wakeLockPending = false
let notice = ''
const rows = new Map<string, HTMLElement>()
let order: Utterance[] = []

/* access code */

const standalone = isStandalone(window)
codeHintEl.hidden = !standalone
const offerInstall = canAddToHomeScreen(window)
installEl.hidden = !offerInstall

function showForm(error = ''): void {
  closeInstall()
  formEl.hidden = false
  feedWrapEl.hidden = true
  codeErrorEl.hidden = !error
  codeErrorEl.textContent = error
  codeErrorEl.classList.toggle('bad', !!error)
  toggleEl.disabled = true
  codeEl.value = ''
}

function showFeed(): void {
  closeInstall()
  formEl.hidden = true
  feedWrapEl.hidden = false
}

formEl.addEventListener('submit', (e) => {
  e.preventDefault()
  const v = codeEl.value.trim()
  if (!v) return
  code = v
  writeCode(code)
  showFeed()
  toggleEl.disabled = false
})

/* install panel */

let installOpen = false
let copyTimer: number | undefined

function openInstall(): void {
  if (running || !offerInstall) return
  installOpen = true
  setToast('', null)
  formEl.hidden = true
  feedWrapEl.hidden = true
  installPanelEl.hidden = false
  copyStepEl.hidden = !code
  copyFailEl.hidden = true
  copyEl.textContent = 'Copy access code'
}

function closeInstall(): void {
  if (!installOpen) return
  installOpen = false
  window.clearTimeout(copyTimer)
  installPanelEl.hidden = true
  formEl.hidden = !!code
  feedWrapEl.hidden = !code
}

installEl.addEventListener('click', openInstall)
installDoneEl.addEventListener('click', closeInstall)
copyEl.addEventListener('click', () => {
  copyFailEl.hidden = true
  // Called inside the tap: Safari allows the clipboard only during a user gesture.
  const write = navigator.clipboard?.writeText(code)
  if (!write) {
    copyFailEl.hidden = false
    return
  }
  write.then(
    () => {
      copyEl.textContent = 'Copied'
      window.clearTimeout(copyTimer)
      copyTimer = window.setTimeout(() => {
        copyEl.textContent = 'Copy access code'
      }, 2000)
    },
    () => {
      copyFailEl.hidden = false
    }
  )
})

forgetEl.addEventListener('click', () => {
  if (running) session.stop()
  clearFeed()
  code = ''
  writeCode('')
  showForm()
})

/* feed */

function empty(title: string, text: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'feed-empty'
  const state = document.createElement('div')
  state.className = 'state'
  const h = document.createElement('h1')
  h.className = 'state-title'
  h.textContent = title
  const p = document.createElement('p')
  p.className = 'state-text'
  p.textContent = text
  state.append(h, p)
  wrap.append(state)
  return wrap
}

function renderEmpty(): void {
  if (order.length) return
  feedEl.replaceChildren(
    !running
      ? empty('Ready for your call.', 'Tap Start. The translation appears here.')
      : phase === 'listening'
        ? empty('Listening.', 'The translation appears here.')
        : empty('Getting ready.', 'Allow the microphone if asked.')
  )
}

function paintRow(row: HTMLElement, u: Utterance, latest: boolean): void {
  row.className = `utt${latest ? ' utt-latest' : ''}${u.isFinal ? '' : ' partial'}`
  const make = (cls: string, lang: string, text: string): HTMLElement => {
    const p = document.createElement('p')
    p.className = cls
    p.lang = lang
    p.textContent = text
    return p
  }
  if (!latest) {
    row.replaceChildren(make('utt-ru', 'ru', u.ru || '…'))
    return
  }
  const { head, last } = splitLast(u.ru)
  const en = englishForHero(u.ru, u.en)
  const parts: HTMLElement[] = []
  if (head) parts.push(make('utt-ru', 'ru', head))
  parts.push(make('utt-ru utt-hero', 'ru', last || '…'))
  if (en) parts.push(make('utt-en', 'en', en))
  row.replaceChildren(...parts)
}

function renderUtterances(list: Utterance[]): void {
  if (!code) return // Forget code: late text from the closing session stays forgotten.
  const stick = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 40
  if (!order.length) feedEl.replaceChildren()
  const previousLatest = order[order.length - 1]
  for (const u of list) {
    const i = order.findIndex((o) => o.id === u.id)
    if (i >= 0) order[i] = u
    else order.push(u)
  }
  const latest = order[order.length - 1]
  for (const u of list) {
    let row = rows.get(u.id)
    if (!row) {
      row = document.createElement('article')
      rows.set(u.id, row)
      feedEl.append(row)
    }
    paintRow(row, u, u === latest)
  }
  // The utterance that was latest becomes a plain muted one.
  if (previousLatest && previousLatest !== latest) {
    const prev = order.find((o) => o.id === previousLatest.id)
    const row = prev && rows.get(prev.id)
    if (prev && row && !list.some((u) => u.id === prev.id)) paintRow(row, prev, false)
  }
  if (stick) feedEl.scrollTop = feedEl.scrollHeight
}

function clearFeed(): void {
  rows.clear()
  order = []
  renderEmpty()
}

/* status, timer, diagnostics */

function setToast(text: string, tone: 'red' | 'orange' | null): void {
  statusEl.hidden = !text
  statusTextEl.textContent = text
  if (!tone) return
  statusIconEl.className = `toast-icon tone-${tone}`
  statusIconEl.innerHTML = tone === 'red' ? ALERT_ICON : REFRESH_ICON
}

function renderDiag(): void {
  diagEl.textContent = `Audio: ${(sentSamples / 16000).toFixed(1)} s, peak ${peak.toFixed(2)}`
}

function formatElapsed(sec: number): string {
  const s = String(sec % 60).padStart(2, '0')
  const m = Math.floor(sec / 60)
  return m < 60 ? `${m}:${s}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}`
}

function startTimer(): void {
  window.clearInterval(elapsedTimer)
  startedAt = Date.now()
  elapsedEl.textContent = '0:00'
  elapsedTimer = window.setInterval(() => {
    elapsedEl.textContent = formatElapsed(Math.floor((Date.now() - startedAt) / 1000))
  }, 1000)
}

/* wake lock */

function showNoLockNotice(): void {
  if (!running) return
  notice = NO_LOCK_NOTICE
  setToast(notice, 'orange')
}

async function acquireWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator)) {
    showNoLockNotice()
    return
  }
  if (wakeLock || wakeLockPending) return
  wakeLockPending = true
  try {
    const lock = await navigator.wakeLock.request('screen')
    if (!running) {
      // The session ended while the request was pending.
      void lock.release().catch(() => {})
      return
    }
    wakeLock = lock
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null
    })
  } catch {
    wakeLock = null
    showNoLockNotice()
  } finally {
    wakeLockPending = false
  }
}

function releaseWakeLock(): void {
  const l = wakeLock
  wakeLock = null
  void l?.release().catch(() => {})
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && running && !wakeLock) void acquireWakeLock()
})

/* session */

function onState(s: SessionState): void {
  phase = s.phase
  const wasRunning = running
  running = s.phase !== 'idle'
  barEl.classList.toggle('running', running)
  installEl.hidden = !offerInstall || running
  if (running) closeInstall()
  timerEl.hidden = !running
  waveEl.classList.toggle('wave-idle', s.phase !== 'listening')
  toggleEl.className = running ? 'stop' : 'start'
  toggleEl.innerHTML = running ? STOP_ICON : ''
  if (running) toggleEl.setAttribute('aria-label', 'Stop')
  else {
    toggleEl.removeAttribute('aria-label')
    toggleEl.textContent = 'Start'
  }
  toggleEl.disabled = s.phase === 'stopping' || !code

  if (running && !wasRunning) startTimer()
  if (!running) {
    window.clearInterval(elapsedTimer)
    releaseWakeLock()
  }

  if (s.phase === 'idle' && s.message === BAD_CODE_MESSAGE) {
    code = ''
    writeCode('')
    setToast('', null)
    showForm(BAD_CODE_MESSAGE)
    return
  }
  if (s.phase === 'idle' && s.message === MIC_DENIED_MESSAGE) notice = ''
  if (s.error && s.message) setToast(s.message, 'red')
  else if (s.phase === 'reconnecting') setToast(s.message ?? 'Reconnecting...', 'orange')
  else if (notice && running) setToast(notice, 'orange')
  else setToast('', null)
  if (!order.length) renderEmpty()
}

const session = createSession({
  getCode: () => code,
  startMic,
  fetchToken: (c) => fetchToken(c),
  createClient: createSonioxClient,
  onUtterances: renderUtterances,
  onState,
  onAudio: (samples, p, sent) => {
    peak = Math.max(p, peak * 0.95)
    if (sent) sentSamples += samples
    renderDiag()
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms))
})

toggleEl.addEventListener('click', () => {
  if (running) {
    session.stop()
    return
  }
  if (!code) return
  sentSamples = 0
  peak = 0
  notice = ''
  renderDiag()
  // Start first: the microphone must be requested inside this tap.
  void session.start()
  void acquireWakeLock()
})

window.addEventListener('hashchange', () => {
  if (!takeCodeFromHash()) return
  showFeed()
  toggleEl.disabled = false
})

if (code) showFeed()
else showForm()
renderDiag()
renderEmpty()
