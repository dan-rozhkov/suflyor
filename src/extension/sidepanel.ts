/// <reference path="./chrome.d.ts" />
import type { Utterance } from '../shared/types'
import { startCapture } from './capture'
import { createSonioxClient, type SonioxClient, type SonioxStatus } from './soniox'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const keyEl = $<HTMLInputElement>('key')
const targetEl = $<HTMLDivElement>('target')
const toggleEl = $<HTMLButtonElement>('toggle')
const statusEl = $<HTMLDivElement>('status')
const diagEl = $<HTMLDivElement>('diag')
const feedEl = $<HTMLElement>('feed')

type Target = { tabId: number; title: string }

/** One Start-to-closed run. Callbacks hold their own session, so a late one cannot touch a newer run. */
interface Session {
  tab: Target
  client: SonioxClient | null
  stopCapture: (() => void) | null
  /** An error or end message is on screen: status changes must not replace it. */
  keepStatus: boolean
  /** Soniox has closed. */
  done: boolean
  /** startCapture has finished, so the tab is free or held by stopCapture. */
  settled: boolean
}

let tab: Target | null = null
let current: Session | null = null
let sentSamples = 0
let peak = 0
const rows = new Map<string, HTMLElement>()

function setStatus(text: string, error = false): void {
  statusEl.textContent = text
  statusEl.classList.toggle('error', error)
}

function renderDiag(): void {
  diagEl.textContent = `Audio sent: ${(sentSamples / 16000).toFixed(1)} s, peak ${peak.toFixed(2)}`
}

function renderTarget(): void {
  // While running, show the tab being captured, even if the toolbar icon was clicked on another one.
  const t = current?.tab ?? tab
  targetEl.textContent = t ? t.title || `Tab ${t.tabId}` : 'No tab selected. Click the toolbar icon on the call tab.'
  updateButton()
}

function updateButton(): void {
  toggleEl.textContent = current ? 'Stop' : 'Start'
  toggleEl.disabled = !current && (!tab || keyEl.value.trim() === '')
}

function renderUtterances(list: Utterance[]): void {
  const stick = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 40
  for (const u of list) {
    let row = rows.get(u.id)
    if (!row) {
      row = document.createElement('div')
      row.append(document.createElement('div'), document.createElement('div'))
      row.children[0].className = 'ru'
      row.children[1].className = 'en'
      rows.set(u.id, row)
      feedEl.append(row)
    }
    row.className = u.isFinal ? 'utt' : 'utt partial'
    row.children[0].textContent = u.ru
    row.children[1].textContent = u.en
  }
  if (stick) feedEl.scrollTop = feedEl.scrollHeight
}

function endSession(s: Session): void {
  s.done = true
  s.stopCapture?.()
  s.stopCapture = null
  // Keep Start blocked until capture has settled: Chrome refuses a second stream on the same tab.
  if (s.settled && current === s) current = null
  renderTarget()
}

function requestStop(s: Session): void {
  s.stopCapture?.()
  s.stopCapture = null
  s.client?.stop()
}

function captureError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  // The grant from the toolbar click is lost when the tab moves to another site.
  if (/not been invoked/i.test(text)) return "Click the toolbar icon on the call tab again, then press Start. Chrome's own pages can't be captured."
  return `Could not capture the tab: ${text}`
}

const statusText: Record<SonioxStatus, string> = {
  connecting: 'Connecting...',
  listening: 'Listening',
  stopping: 'Stopping...',
  closed: 'Stopped'
}

async function start(): Promise<void> {
  if (!tab || current) return
  const s: Session = { tab, client: null, stopCapture: null, keepStatus: false, done: false, settled: false }
  current = s
  sentSamples = 0
  peak = 0
  renderDiag()
  renderTarget()
  const c = createSonioxClient({
    key: keyEl.value.trim(),
    onUtterances: renderUtterances,
    onStatus: (st) => {
      if (!s.keepStatus) setStatus(statusText[st])
      if (st === 'closed') endSession(s)
    },
    onError: (m) => {
      s.keepStatus = true
      setStatus(m, true)
    }
  })
  s.client = c
  try {
    const stopFn = await startCapture({
      tabId: s.tab.tabId,
      onPcm: (pcm, p) => {
        if (s.done) return
        peak = Math.max(p, peak * 0.95)
        if (c.send(pcm)) sentSamples += pcm.byteLength / 2
        renderDiag()
      },
      onEnded: () => {
        if (s.done) return
        s.keepStatus = true
        setStatus('Tab capture ended. The tab was closed or stopped sharing audio.')
        requestStop(s)
      }
    })
    s.stopCapture = stopFn
  } catch (e) {
    if (!s.done) {
      s.keepStatus = true
      setStatus(captureError(e), true)
      c.stop()
    }
  }
  s.settled = true
  // The session may have ended while capture was starting.
  if (s.done) endSession(s)
}

toggleEl.addEventListener('click', () => {
  if (current) requestStop(current)
  else void start()
})

keyEl.addEventListener('input', () => {
  void chrome.storage.session.set({ sonioxKey: keyEl.value })
  updateButton()
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return
  if (changes.targetTab) {
    tab = (changes.targetTab.newValue as typeof tab) ?? null
    renderTarget()
  }
  if (changes.sonioxKey) {
    const v = (changes.sonioxKey.newValue as string | undefined) ?? ''
    if (v !== keyEl.value) keyEl.value = v
    updateButton()
  }
})

void chrome.storage.session.get(['targetTab', 'sonioxKey']).then((s) => {
  tab = (s.targetTab as typeof tab) ?? null
  keyEl.value = (s.sonioxKey as string | undefined) ?? ''
  renderTarget()
})
renderDiag()
