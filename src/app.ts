import '@fontsource-variable/nunito'
import './tokens.css'
import './app.css'
import type { Utterance } from './types'
import { englishForHero, paragraphParts, paragraphs } from './sentences'
import { createSonioxClient } from './soniox'
import { startMic } from './mic'
import { createSession, MIC_DENIED_MESSAGE, type SessionState } from './session'
import { BAD_CODE_MESSAGE, fetchToken } from './token'
import { loadContext, saveContext } from './context'
import { buildSonioxContext } from './soniox-context'
import { createSuggester, type SuggestUpdate } from './suggest'
import { createChapterer, type Chapter, type ChapterPara } from './chapters'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const formEl = $<HTMLFormElement>('code-form')
const codeEl = $<HTMLInputElement>('code')
const codeErrorEl = $<HTMLElement>('code-error')
const feedWrapEl = $<HTMLElement>('feed-wrap')
const feedEl = $<HTMLElement>('feed')
const chaptersEl = $<HTMLElement>('chapters')
const toggleEl = $<HTMLButtonElement>('toggle')
const statusEl = $<HTMLElement>('status')
const statusIconEl = $<HTMLElement>('status-icon')
const statusTextEl = $<HTMLElement>('status-text')
const diagEl = $<HTMLElement>('diag')
const forgetEl = $<HTMLButtonElement>('forget')
const moreEl = $<HTMLButtonElement>('more')
const menuEl = $<HTMLElement>('menu')
const appEl = document.querySelector<HTMLElement>('.app')!
const dockEl = $<HTMLElement>('dock')
const stopEl = $<HTMLButtonElement>('stop')
const idleEl = $<HTMLElement>('idle')
const suggestEl = $<HTMLButtonElement>('suggest')
const sparkEl = $<HTMLElement>('spark')
const repliesEl = $<HTMLElement>('replies')
const repliesBodyEl = $<HTMLElement>('replies-body')
const repliesStatusEl = $<HTMLElement>('replies-status')
const repliesCloseEl = $<HTMLButtonElement>('replies-close')
const contextEl = $<HTMLButtonElement>('context')
const contextPanelEl = $<HTMLElement>('context-panel')
const contextTextEl = $<HTMLTextAreaElement>('context-text')
const contextErrorEl = $<HTMLElement>('context-error')
const contextFileBtnEl = $<HTMLButtonElement>('context-file-btn')
const contextFileEl = $<HTMLInputElement>('context-file')
const contextSaveEl = $<HTMLButtonElement>('context-save')
const contextCloseEl = $<HTMLButtonElement>('context-close')
const waveEl = $<HTMLElement>('wave')
const elapsedEl = $<HTMLElement>('elapsed')

const STORAGE_KEY = 'suflyorAccessCode'
const CODE_PLACEHOLDER = 'Access code'
const MAX_FILE_BYTES = 1024 * 1024
const NO_CONTEXT_NOTICE = 'Translation continues without the call notes.'
const NO_LOCK_NOTICE = 'Keep the screen on: locking it stops the microphone.'

const SVG_OPEN = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" '
const STOP_ICON = `${SVG_OPEN}data-pen-icon="Stop"><rect x="2.75" y="2.75" width="10.5" height="10.5" rx="1.75" /></svg>`
const ALERT_ICON = `${SVG_OPEN}data-pen-icon="WarningCircle"><circle cx="8" cy="8" r="6" /><path d="M8 4.75v3.5M8 11v.01" /></svg>`
const SPARK_ICON = `${SVG_OPEN}data-pen-icon="Sparkle"><path transform="translate(8 8) scale(1.07) translate(-8 -8)" d="M8 2.25Q9 7 13.75 8Q9 9 8 13.75Q7 9 2.25 8Q7 7 8 2.25Z" /></svg>`
const CHECK_ICON = `${SVG_OPEN}data-pen-icon="Check"><path d="M2.75 8.5l3.25 3.25 7.25-7.5" /></svg>`
const CHEVRON_ICON = `${SVG_OPEN}data-pen-icon="CaretDown"><path d="M4 6l4 4 4-4" /></svg>`
const CLOSE_ICON = `${SVG_OPEN}data-pen-icon="X"><path d="M3.75 3.75l8.5 8.5M12.25 3.75l-8.5 8.5" /></svg>`
const RECORD_ICON = `${SVG_OPEN}data-pen-icon="Record"><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="2.75" fill="currentColor" stroke="none" /></svg>`
const DOTS_ICON = `${SVG_OPEN}data-pen-icon="DotsThree"><circle cx="3" cy="8" r="1.25" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none" /><circle cx="13" cy="8" r="1.25" fill="currentColor" stroke="none" /></svg>`
const CLIP_ICON = `${SVG_OPEN}data-pen-icon="Paperclip"><path d="M13.5 7.5l-5.6 5.6a3.2 3.2 0 0 1-4.5-4.5l6-6a2.1 2.1 0 0 1 3 3l-6 6a1 1 0 0 1-1.5-1.5l5.6-5.6" /></svg>`
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
/** Index in `order` where the current run began: earlier calls are not sent for replies. */
let runStart = 0
let lastState: SessionState | undefined
/** When each paragraph of each utterance first appeared. Never changes afterwards, even if the text is revised. */
const stamps = new Map<string, number[]>()
let chapters: Chapter[] = []

stopEl.innerHTML = STOP_ICON
sparkEl.innerHTML = SPARK_ICON
repliesCloseEl.innerHTML = CLOSE_ICON
toggleEl.insertAdjacentHTML('afterbegin', RECORD_ICON)
moreEl.innerHTML = DOTS_ICON
contextFileBtnEl.innerHTML = CLIP_ICON
contextCloseEl.innerHTML = CLOSE_ICON

function logoIcon(): Node {
  return $<HTMLTemplateElement>('logo-icon').content.firstElementChild!.cloneNode(true)
}
document.querySelector('.brand')!.prepend(logoIcon())

/* access code */


/** The error sits inside the field, in place of the placeholder. Screen readers get it from the hidden alert. */
function setCodeError(error: string): void {
  codeErrorEl.textContent = error
  codeEl.placeholder = error || CODE_PLACEHOLDER
  codeEl.classList.toggle('field-error', !!error)
  if (error) codeEl.setAttribute('aria-invalid', 'true')
  else codeEl.removeAttribute('aria-invalid')
}

function showForm(error = ''): void {
  closePanel()
  formEl.hidden = false
  feedWrapEl.hidden = true
  setCodeError(error)
  toggleEl.disabled = true
  codeEl.value = ''
}

function showFeed(): void {
  closePanel()
  formEl.hidden = true
  feedWrapEl.hidden = false
}

codeEl.addEventListener('input', () => setCodeError(''))

formEl.addEventListener('submit', (e) => {
  e.preventDefault()
  const v = codeEl.value.trim()
  if (!v) return
  code = v
  writeCode(code)
  showFeed()
  toggleEl.disabled = false
})

/* context panel */

let contextOpen = false
const CONTEXT_CUT_NOTE = 'Saved the first 100,000 characters.'
const CONTEXT_MEMORY_NOTE = 'Saved for this session only.'

function renderContextLink(): void {
  const on = !!loadContext()
  if (on) {
    contextEl.dataset.on = ''
    contextEl.setAttribute('aria-label', 'Notes, on')
  } else {
    delete contextEl.dataset.on
    contextEl.removeAttribute('aria-label')
  }
}

function setContextError(text: string): void {
  contextErrorEl.hidden = !text
  contextErrorEl.textContent = text
  contextTextEl.classList.toggle('field-error', !!text)
}

function openContext(): void {
  if (running || !code) return
  contextOpen = true
  setToast('', null)
  formEl.hidden = true
  feedWrapEl.hidden = true
  contextPanelEl.hidden = false
  contextTextEl.value = loadContext()
  setContextError('')
}

function closePanel(): void {
  if (!contextOpen) return
  contextOpen = false
  contextPanelEl.hidden = true
  formEl.hidden = !!code
  feedWrapEl.hidden = !code
}

contextEl.addEventListener('click', openContext)
contextCloseEl.addEventListener('click', closePanel)
contextSaveEl.addEventListener('click', () => {
  const r = saveContext(contextTextEl.value)
  renderContextLink()
  const note = r.cut ? CONTEXT_CUT_NOTE : !r.stored ? CONTEXT_MEMORY_NOTE : ''
  // Say it first and keep the panel open; a second Save with the same note closes it.
  if (note && contextErrorEl.textContent !== note) {
    contextTextEl.value = loadContext()
    setContextError(note)
    return
  }
  closePanel()
})
contextTextEl.addEventListener('input', () => setContextError(''))
contextFileBtnEl.addEventListener('click', () => contextFileEl.click())
contextFileEl.addEventListener('change', () => {
  const file = contextFileEl.files?.[0]
  contextFileEl.value = ''
  if (!file) return
  setContextError('')
  if (file.size > MAX_FILE_BYTES) {
    setContextError('This file is too large.')
    return
  }
  file.text().then(
    (text) => {
      const have = contextTextEl.value.replace(/\s+$/, '')
      contextTextEl.value = have ? `${have}\n\n${text}` : text
    },
    () => setContextError('Could not read this file.')
  )
})

/* menu */

function setMenu(open: boolean): void {
  menuEl.hidden = !open
  moreEl.setAttribute('aria-expanded', String(open))
}

moreEl.addEventListener('click', () => {
  setMenu(menuEl.hasAttribute('hidden'))
  if (!menuEl.hidden) forgetEl.focus()
})
document.addEventListener('click', (e) => {
  if (!menuEl.hidden && !moreEl.contains(e.target as Node) && !menuEl.contains(e.target as Node)) setMenu(false)
})
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || menuEl.hidden) return
  setMenu(false)
  moreEl.focus()
})

forgetEl.addEventListener('click', () => {
  setMenu(false)
  if (running) session.stop()
  resetReplies()
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
  state.append(logoIcon(), h, p)
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

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
const clockShortFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** Stamps of the first `count` paragraphs of an utterance; a paragraph seen for the first time gets the current time. */
function stampsFor(id: string, count: number): number[] {
  let list = stamps.get(id)
  if (!list) stamps.set(id, (list = []))
  while (list.length < count) list.push(Date.now())
  return list
}

function paintRow(row: HTMLElement, u: Utterance, latest: boolean): void {
  row.className = `utt${latest ? ' utt-latest' : ''}${u.isFinal ? '' : ' partial'}`
  const parts = u.ru.trim() ? paragraphParts(u.ru) : [{ done: '', live: '' }]
  const empty = !u.ru.trim()
  const times = stampsFor(u.id, parts.length)
  const out: HTMLElement[] = parts.map((part, i) => {
    const p = document.createElement('p')
    p.className = 'utt-ru'
    p.lang = 'ru'
    const time = document.createElement('time')
    time.className = 'utt-time'
    time.dateTime = new Date(times[i]).toISOString()
    time.textContent = clockFmt.format(times[i])
    p.append(time)
    if (!latest) {
      p.append(empty ? '…' : [part.done, part.live].filter(Boolean).join(' '))
      return p
    }
    if (part.done) p.append(`${part.done} `)
    const live = document.createElement('span')
    live.className = 'utt-live'
    live.textContent = empty ? '…' : part.live
    if (part.live || empty) p.append(live)
    return p
  })
  if (latest) {
    const en = englishForHero(u.ru, u.en)
    if (en) {
      const p = document.createElement('p')
      p.className = 'utt-en'
      p.lang = 'en'
      p.textContent = en
      out.push(p)
    }
  }
  row.replaceChildren(...out)
}

function renderUtterances(list: Utterance[]): void {
  if (!code) return // Forget code: late text from the closing session stays forgotten.
  const stick = !jumping() && feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 40
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
  renderSuggestButton()
  chapterer.onText(order.slice(runStart).reduce((n, u) => n + u.ru.length, 0))
  scheduleCurrent()
}

/* The dark area grows and shrinks the feed: keep it pinned to the bottom when it was there. */
let pinned = true
/** While a smooth jump starts the feed is still at the bottom, and new text must not pull it back. */
const JUMP_MS = 1000
let jumpUntil = 0
let jumpTimer: number | undefined
const jumping = (): boolean => performance.now() < jumpUntil
feedEl.addEventListener('scroll', () => {
  pinned = !jumping() && feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 40
})
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (pinned) feedEl.scrollTop = feedEl.scrollHeight
  }).observe(feedEl)
}

function clearFeed(): void {
  chapterer.reset()
  chapters = []
  stamps.clear()
  closeRail()
  renderChapters()
  rows.clear()
  order = []
  runStart = 0
  renderEmpty()
  renderSuggestButton()
}

/* chapters */

function currentParagraphs(): ChapterPara[] {
  const out: ChapterPara[] = []
  for (const u of order.slice(runStart)) {
    const times = stamps.get(u.id) ?? []
    paragraphs(u.ru).forEach((text, i) => out.push({ key: { id: u.id, para: i }, text, at: times[i] ?? Date.now() }))
  }
  return out
}

const chapterer = createChapterer({
  getCode: () => code,
  getParagraphs: currentParagraphs,
  onChange: (list) => {
    chapters = list
    renderChapters()
    scheduleCurrent()
  }
})

const hoverNone = window.matchMedia('(hover: none)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const JUMP_OFFSET = 56
const CURRENT_OFFSET = 72
let chapterBtns: HTMLButtonElement[] = []
let currentChapter = -1
let currentFrame = 0
const latestBtn = document.createElement('button')
latestBtn.type = 'button'
latestBtn.className = 'ch-row ch-latest'
latestBtn.hidden = true
const latestLabel = document.createElement('span')
latestLabel.className = 'ch-latest-label'
latestLabel.textContent = 'Latest'
latestBtn.append(latestLabel)

function railOpen(): boolean {
  return chaptersEl.classList.contains('open')
}

function closeRail(): void {
  chaptersEl.classList.remove('open')
  if (chaptersEl.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
}

/** On a phone the first tap only opens the rail; the next tap acts. Returns true when the tap was used to open. */
function openedByTap(e: Event): boolean {
  if (!hoverNone.matches || railOpen()) return false
  e.preventDefault()
  chaptersEl.classList.add('open')
  revealCurrent()
  return true
}

function paragraphEl(c: Chapter): HTMLElement | null {
  const row = rows.get(c.key.id)
  if (!row) return null
  return (row.children[c.key.para] as HTMLElement | undefined) ?? row
}

function jumpTo(c: Chapter): void {
  const el = paragraphEl(c)
  if (!el) return
  jumpUntil = performance.now() + JUMP_MS
  pinned = false
  // A jump can end at the bottom, or not scroll at all: no scroll event would say so.
  window.clearTimeout(jumpTimer)
  jumpTimer = window.setTimeout(() => {
    pinned = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 40
    scheduleCurrent()
  }, JUMP_MS)
  const top = el.getBoundingClientRect().top - feedEl.getBoundingClientRect().top + feedEl.scrollTop - JUMP_OFFSET
  feedEl.scrollTo({ top: Math.max(0, top), behavior: reducedMotion.matches ? 'auto' : 'smooth' })
}

function newChapterBtn(): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'ch-row'
  const title = document.createElement('span')
  title.className = 'ch-title'
  title.lang = 'ru'
  const time = document.createElement('span')
  time.className = 'ch-time'
  const dash = document.createElement('span')
  dash.className = 'ch-dash'
  dash.setAttribute('aria-hidden', 'true')
  b.append(title, time, dash)
  b.addEventListener('click', (e) => {
    if (openedByTap(e)) return
    const c = chapters[chapterBtns.indexOf(b)]
    if (c) jumpTo(c)
    if (hoverNone.matches) closeRail()
  })
  return b
}

/* Rows are updated in place, so hover and focus survive a new title. */
function renderChapters(): void {
  chaptersEl.hidden = chapters.length === 0
  // Rows go before this button, so it must be in the rail first.
  if (!latestBtn.parentElement) chaptersEl.append(latestBtn)
  while (chapterBtns.length < chapters.length) {
    const b = newChapterBtn()
    chapterBtns.push(b)
    chaptersEl.insertBefore(b, latestBtn)
  }
  while (chapterBtns.length > chapters.length) chapterBtns.pop()!.remove()
  chapters.forEach((c, i) => {
    const [title, time] = chapterBtns[i].children as unknown as HTMLElement[]
    if (title.textContent !== c.title) title.textContent = c.title
    const t = clockShortFmt.format(c.at)
    if (time.textContent !== t) time.textContent = t
  })
  currentChapter = -1
  updateCurrent()
}

function updateCurrent(): void {
  latestBtn.hidden = pinned
  const feedTop = feedEl.getBoundingClientRect().top
  let cur = 0
  chapters.forEach((c, i) => {
    const el = paragraphEl(c)
    if (el && el.getBoundingClientRect().top - feedTop <= CURRENT_OFFSET) cur = i
  })
  // At the bottom the reader is in the newest chapter, even when it starts lower on the screen.
  if (pinned) cur = chapters.length - 1
  if (cur === currentChapter || !chapterBtns.length) return
  currentChapter = cur
  chapterBtns.forEach((b, i) => {
    if (i === cur) b.setAttribute('aria-current', 'true')
    else b.removeAttribute('aria-current')
  })
  revealCurrent()
}

/** Keep the current row in view when the rail scrolls. */
function revealCurrent(): void {
  const b = chapterBtns[currentChapter]
  if (!b) return
  if (b.offsetTop < chaptersEl.scrollTop) chaptersEl.scrollTop = b.offsetTop
  else if (b.offsetTop + b.offsetHeight > chaptersEl.scrollTop + chaptersEl.clientHeight)
    chaptersEl.scrollTop = b.offsetTop + b.offsetHeight - chaptersEl.clientHeight
}

function scheduleCurrent(): void {
  if (currentFrame) return
  currentFrame = requestAnimationFrame(() => {
    currentFrame = 0
    updateCurrent()
  })
}

latestBtn.addEventListener('click', (e) => {
  if (openedByTap(e)) return
  // At once: text arriving during a smooth scroll would leave the feed short of the bottom.
  jumpUntil = 0
  window.clearTimeout(jumpTimer)
  feedEl.scrollTop = feedEl.scrollHeight
  pinned = true
  scheduleCurrent()
  if (hoverNone.matches) closeRail()
})
feedEl.addEventListener('scroll', scheduleCurrent)
// Rows are taller in the open rail, so the position set while it was closed is off.
chaptersEl.addEventListener('transitionend', (e) => {
  if (e.target === chaptersEl && e.propertyName === 'width') revealCurrent()
})
document.addEventListener('pointerdown', (e) => {
  if (railOpen() && !chaptersEl.contains(e.target as Node)) closeRail()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (railOpen() || chaptersEl.contains(document.activeElement))) closeRail()
})

/* status, timer, diagnostics */

function setToast(text: string, tone: 'red' | 'orange' | null): void {
  statusEl.hidden = !text
  statusTextEl.textContent = text
  if (!tone) return
  statusIconEl.className = `toast-icon tone-${tone}`
  statusIconEl.innerHTML = tone === 'red' ? ALERT_ICON : REFRESH_ICON
}

let toastTimer: number | undefined

/** The session's own message: an error, reconnecting, the wake-lock notice or nothing. */
function applyToast(s: SessionState | undefined): void {
  window.clearTimeout(toastTimer)
  if (s?.error && s.message) setToast(s.message, 'red')
  else if (s?.phase === 'reconnecting') setToast(s.message ?? 'Reconnecting...', 'orange')
  else if (notice && running) setToast(notice, 'orange')
  else setToast('', null)
}

function showTransientError(message: string): void {
  setToast(message, 'red')
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => applyToast(lastState), 6000)
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
  lastState = s
  const wasRunning = running
  const darkHadFocus = dockEl.contains(document.activeElement)
  running = s.phase !== 'idle'
  appEl.classList.toggle('running', running)
  dockEl.inert = !running
  idleEl.inert = running
  contextEl.hidden = running
  if (running) {
    closePanel()
  } else resetReplies()
  waveEl.classList.toggle('wave-idle', s.phase !== 'listening')
  toggleEl.disabled = !code
  stopEl.disabled = s.phase === 'stopping'
  if (!running && wasRunning && s.message !== BAD_CODE_MESSAGE) chapterer.flush()
  renderSuggestButton()
  if (running && !wasRunning) stopEl.focus()
  if (!running && wasRunning && darkHadFocus) toggleEl.focus()

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
  applyToast(s)
  if (!order.length) renderEmpty()
}

/* reply suggestions */

let replyState: SuggestUpdate | null = null
let moreOpen = false
let copied = ''
let copiedTimer: number | undefined

const suggester = createSuggester({
  getCode: () => code,
  getContext: () => loadContext(),
  onUpdate: onSuggestUpdate
})

/** The English of this run, including the open utterance, so the line just spoken is sent. */
function suggestLines(): string[] {
  return order
    .slice(runStart)
    .filter((u) => u.en.trim())
    .map((u) => u.en.trim())
}

function renderSuggestButton(): void {
  suggestEl.disabled =
    !running || phase === 'stopping' || replyState?.status === 'streaming' || suggestLines().length === 0
}

function copyText(text: string): void {
  const done = (): void => {
    copied = text
    window.clearTimeout(copiedTimer)
    copiedTimer = window.setTimeout(() => {
      copied = ''
      renderReplies()
    }, 1500)
    renderReplies()
  }
  // Called inside the tap: Safari allows the clipboard only during a user gesture.
  const write = navigator.clipboard?.writeText(text)
  if (write) {
    write.then(done, () => showTransientError('Could not copy the reply.'))
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.append(ta)
  ta.select()
  const ok = document.execCommand('copy')
  ta.remove()
  if (ok) done()
  else showTransientError('Could not copy the reply.')
}

function paintReply(li: HTMLElement, text: string, live: boolean): void {
  const b = li.firstElementChild as HTMLButtonElement
  const hidden = b.querySelector<HTMLElement>('.sr-only')!
  const t = b.querySelector<HTMLElement>('.opt-text')!
  b.dataset.text = text
  const label = copied === text ? 'Copied: ' : 'Copy: '
  if (hidden.textContent !== label) hidden.textContent = label
  if (t.textContent !== text) t.textContent = text
  const cls = live ? 'opt-text opt-live' : 'opt-text'
  if (t.className !== cls) t.className = cls
  const check = b.querySelector('.opt-check')
  if (copied === text && !check) {
    const c = document.createElement('span')
    c.className = 'opt-check'
    c.innerHTML = CHECK_ICON
    b.append(c)
  } else if (copied !== text && check) check.remove()
}

function newReplyItem(): HTMLElement {
  const li = document.createElement('li')
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'opt'
  const hidden = document.createElement('span')
  hidden.className = 'sr-only'
  const t = document.createElement('span')
  t.className = 'opt-text'
  t.lang = 'en'
  b.append(hidden, t)
  b.addEventListener('click', () => copyText(b.dataset.text ?? ''))
  li.append(b)
  return li
}

/** Make `ul` hold exactly `texts.length` items, reusing the ones it has. */
function syncReplyList(ul: HTMLElement, texts: string[], live: (i: number) => boolean): void {
  while (ul.children.length < texts.length) ul.append(newReplyItem())
  while (ul.children.length > texts.length) ul.lastElementChild!.remove()
  texts.forEach((text, i) => paintReply(ul.children[i] as HTMLElement, text, live(i)))
}

/* The body is built once per suggestion and then updated in place, so a tap, scroll or focus survives streaming. */
let repliesGen = 0
let renderedGen = -1
let skelEl: HTMLElement | null = null
let firstUl: HTMLElement | null = null
let moreBtn: HTMLElement | null = null
let moreLabel: HTMLElement | null = null
let restUl: HTMLElement | null = null
let clearTimer: number | undefined
let clearHandler: ((e: TransitionEvent) => void) | null = null

function cancelClear(): void {
  window.clearTimeout(clearTimer)
  clearTimer = undefined
  if (clearHandler) repliesEl.removeEventListener('transitionend', clearHandler)
  clearHandler = null
}

function clearBody(): void {
  repliesBodyEl.replaceChildren()
  skelEl = firstUl = moreBtn = moreLabel = restUl = null
  renderedGen = -1
}

/** Keep the old content while the panel collapses, then clear it. */
function scheduleClear(): void {
  if (clearHandler || !repliesBodyEl.firstChild) return
  const finish = (): void => {
    cancelClear()
    if (!replyState) clearBody()
  }
  clearHandler = (e) => {
    if (e.target === repliesEl) finish()
  }
  repliesEl.addEventListener('transitionend', clearHandler)
  clearTimer = window.setTimeout(finish, 400)
}

function renderReplies(): void {
  const st = replyState
  const open = !!st
  repliesEl.classList.toggle('open', open)
  repliesEl.inert = !open
  const streaming = st?.status === 'streaming'
  sparkEl.classList.toggle('spark-live', streaming)
  repliesStatusEl.textContent = streaming ? 'Finding replies' : st?.options.length ? 'Replies ready' : ''
  renderSuggestButton()
  if (!st) {
    scheduleClear()
    return
  }
  cancelClear()
  if (renderedGen !== repliesGen) {
    clearBody()
    renderedGen = repliesGen
  }
  const options = st.options

  const needSkeleton = streaming && !options.length
  if (needSkeleton && !skelEl) {
    skelEl = document.createElement('div')
    skelEl.className = 'skeletons'
    skelEl.setAttribute('aria-hidden', 'true')
    skelEl.innerHTML = '<span class="skeleton"></span><span class="skeleton skeleton-short"></span>'
    repliesBodyEl.append(skelEl)
  } else if (!needSkeleton && skelEl) {
    skelEl.remove()
    skelEl = null
  }

  if (options.length && !firstUl) {
    firstUl = document.createElement('ul')
    firstUl.className = 'opts'
    repliesBodyEl.append(firstUl)
  }
  if (firstUl) syncReplyList(firstUl, options.slice(0, 1), () => streaming && options.length === 1)

  if (options.length > 1) {
    if (!moreBtn) {
      const more = document.createElement('button')
      more.type = 'button'
      more.className = 'more'
      moreLabel = document.createElement('span')
      const chev = document.createElement('span')
      chev.innerHTML = CHEVRON_ICON
      chev.setAttribute('aria-hidden', 'true')
      more.append(moreLabel, chev)
      more.addEventListener('click', () => {
        moreOpen = !moreOpen
        renderReplies()
      })
      moreBtn = more
      repliesBodyEl.append(more)
    }
    moreBtn.setAttribute('aria-expanded', String(moreOpen))
    const label = moreOpen ? 'Hide' : `${options.length - 1} more`
    if (moreLabel && moreLabel.textContent !== label) moreLabel.textContent = label
  } else if (moreBtn) {
    moreBtn.remove()
    moreBtn = moreLabel = null
  }

  if (moreOpen && options.length > 1) {
    if (!restUl) {
      restUl = document.createElement('ul')
      restUl.className = 'opts'
      repliesBodyEl.append(restUl)
    }
    const rest = options.slice(1)
    syncReplyList(restUl, rest, (i) => streaming && i === rest.length - 1)
  } else if (restUl) {
    restUl.remove()
    restUl = null
  }
}

function resetReplies(): void {
  const hadFocus = repliesEl.contains(document.activeElement)
  repliesGen++
  suggester.cancel()
  window.clearTimeout(copiedTimer)
  copied = ''
  replyState = null
  moreOpen = false
  renderReplies()
  if (hadFocus) suggestEl.focus()
}

function onSuggestUpdate(u: SuggestUpdate): void {
  if (u.status === 'error') {
    replyState = null
    renderReplies()
    if (u.badCode) {
      if (running) session.stop()
      resetReplies()
      clearFeed()
      code = ''
      writeCode('')
      setToast('', null)
      showForm(BAD_CODE_MESSAGE)
      return
    }
    showTransientError(u.message ?? 'Could not get replies. Try again.')
    return
  }
  replyState = u
  renderReplies()
}

suggestEl.addEventListener('click', () => {
  const lines = suggestLines()
  // A tap during streaming would start a new paid call.
  if (!running || !lines.length || replyState?.status === 'streaming') return
  repliesGen++
  moreOpen = false
  copied = ''
  replyState = { status: 'streaming', options: [] }
  renderReplies()
  suggester.request(lines)
})
repliesCloseEl.addEventListener('click', () => {
  resetReplies()
  suggestEl.focus()
})

const session = createSession({
  getCode: () => code,
  startMic,
  fetchToken: (c) => fetchToken(c),
  // Read when each client is created, so a reconnect picks up the saved context.
  createClient: ({ attempt, ...h }) => {
    // After two failed reconnects, try without context: a rejected context must not stop the translation.
    const context = buildSonioxContext(loadContext())
    if (attempt < 2) {
      if (notice === NO_CONTEXT_NOTICE) notice = ''
      return createSonioxClient({ ...h, context })
    }
    if (context && running) {
      notice = NO_CONTEXT_NOTICE
      applyToast(lastState)
    }
    return createSonioxClient(h)
  },
  onUtterances: renderUtterances,
  onState,
  onAudio: (samples, p, sent) => {
    peak = Math.max(p, peak * 0.95)
    if (sent) sentSamples += samples
    renderDiag()
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms))
})

stopEl.addEventListener('click', () => {
  resetReplies()
  session.stop()
})

toggleEl.addEventListener('click', () => {
  if (running || !code) return
  sentSamples = 0
  peak = 0
  notice = ''
  runStart = order.length
  chapterer.startRun()
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

renderContextLink()
if (code) showFeed()
else showForm()
renderDiag()
renderEmpty()
