import { addHaptic } from './haptics'
import { ICON_CLOCK, ICON_REFRESH, ICON_SPARK, ICON_TRANSLATE } from './icons'

/** The two-column call screen of a wide window. The call itself (feed, dock, replies) stays where it is: this adds the
 *  header above the feed and the cards beside it, and moves the replies list into its card while the window is wide. */

/** The wide window. live.css uses the same 1024px in its media queries: change them together. */
export const DESKTOP_QUERY = '(min-width: 1024px)'

export interface LiveChapter {
  time: string
  title: string
  lang: string
}

export interface LiveDesktopOptions {
  /** The white panel that holds the call screen. */
  stage: HTMLElement
  /** The element the header goes before, and the one the cards go after. */
  before: HTMLElement
  after: HTMLElement
  /** The replies list: it lives in the card on a wide window and in the dock sheet otherwise. */
  repliesBody: HTMLElement
  /** `opener` is the button that asked, so focus can go back to it. */
  onNotes: (opener: HTMLElement) => void
  onRefresh: () => void
  onJump: (index: number) => void
  onLatest: () => void
}

export interface LiveDesktop {
  setHeader: (title: string, languages: string) => void
  setElapsed: (text: string) => void
  setChapters: (items: LiveChapter[]) => void
  setCurrent: (index: number) => void
  setLatest: (visible: boolean) => void
  setNotes: (text: string) => void
  setRefreshDisabled: (disabled: boolean) => void
  setStreaming: (streaming: boolean) => void
  setInert: (inert: boolean) => void
  /** The notes panel covers the cards: they leave the tab order while it is open. */
  setNotesOpen: (open: boolean) => void
  /** The status text of the replies card. A screen reader hears it only while the card is on screen. */
  setStatus: (text: string) => void
  /** Focuses the card's Refresh button. False when it cannot take focus. */
  focusRefresh: () => boolean
  focusNotesButton: () => void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function chip(icon: string, text: string, className = ''): { root: HTMLElement; label: HTMLElement } {
  const root = el('span', `live-chip ${className}`.trim())
  const label = el('span', 'live-chip-label', text)
  if (icon === 'dot') root.append(el('i', 'live-dot'))
  else if (icon) {
    const i = el('span', 'live-chip-icon')
    i.setAttribute('aria-hidden', 'true')
    i.innerHTML = icon
    root.append(i)
  }
  root.append(label)
  return { root, label }
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label)
  b.type = 'button'
  addHaptic(b)
  b.addEventListener('click', onClick)
  return b
}

function card(title: string, icon: string, className: string): { root: HTMLElement; head: HTMLElement; body: HTMLElement } {
  const root = el('section', `live-card ${className}`)
  const head = el('div', 'live-card-head')
  const h = el('h2', 'live-card-title')
  if (icon) {
    const i = el('span', 'live-card-icon')
    i.setAttribute('aria-hidden', 'true')
    i.innerHTML = icon
    h.append(i)
  }
  h.append(el('span', undefined, title))
  head.append(h)
  const body = el('div', 'live-card-body')
  root.append(head, body)
  return { root, head, body }
}

export function createLiveDesktop(o: LiveDesktopOptions): LiveDesktop {
  // header: the call title, the Notes button, and the chips
  const head = el('header', 'live-head')
  const titleRow = el('div', 'live-title-row')
  const title = el('h1', 'live-title')
  title.dir = 'auto'
  const notesBtn: HTMLButtonElement = button('Notes', 'live-notes-btn', () => o.onNotes(notesBtn))
  titleRow.append(title, notesBtn)
  const chips = el('div', 'live-chips')
  const live = chip('dot', 'Live', 'live-chip-live')
  const time = chip(ICON_CLOCK, '0:00', 'live-chip-time')
  // The dock shows the same value to a screen reader's user already.
  time.root.setAttribute('aria-hidden', 'true')
  const pair = chip(ICON_TRANSLATE, '')
  chips.append(live.root, time.root, pair.root)
  head.append(titleRow, chips)

  // cards
  const side = el('aside', 'live-side')
  side.setAttribute('aria-label', 'Call details')

  const replies = card('Suggested replies', ICON_SPARK, 'live-replies')
  const refresh = button('Refresh', 'live-ghost', o.onRefresh)
  const refreshIcon = el('span', 'live-ghost-icon')
  refreshIcon.setAttribute('aria-hidden', 'true')
  refreshIcon.innerHTML = ICON_REFRESH
  refresh.prepend(refreshIcon)
  replies.head.append(refresh)
  const status = el('p', 'sr-only')
  status.setAttribute('role', 'status')
  replies.root.prepend(status)
  const hint = el('p', 'live-hint', 'Tap Refresh for replies to what was just said.')
  replies.body.append(hint)

  const chapters = card('Chapters', '', 'live-chapters')
  const chapterList = el('div', 'live-chapter-list')
  const chaptersEmpty = el('p', 'live-hint', 'Chapters appear as the call goes on.')
  const latest = button('Back to the latest', 'live-ghost live-latest', o.onLatest)
  latest.hidden = true
  chapters.body.append(chaptersEmpty, chapterList, latest)

  const notes = card('Call notes', '', 'live-notes')
  const notesText = el('p', 'live-notes-text')
  notesText.dir = 'auto'
  const editBtn: HTMLButtonElement = button('Edit', 'live-ghost live-edit', () => o.onNotes(editBtn))
  notes.body.append(notesText, editBtn)

  side.append(replies.root, chapters.root, notes.root)
  o.before.before(head)
  o.after.after(side)

  // The replies list is built by the app and updated in place, so it is moved, never rebuilt.
  const bodyHome = { parent: o.repliesBody.parentElement!, next: o.repliesBody.nextSibling }
  const wide = window.matchMedia(DESKTOP_QUERY)
  function place(): void {
    // Moving a node drops the focus inside it: put it back afterwards.
    const active = document.activeElement
    const keep = active instanceof HTMLElement && o.repliesBody.contains(active) ? active : null
    if (wide.matches) {
      o.repliesBody.classList.add('live-replies-body')
      replies.body.append(o.repliesBody)
    } else {
      o.repliesBody.classList.remove('live-replies-body')
      bodyHome.parent.insertBefore(o.repliesBody, bodyHome.next)
    }
    if (keep && keep.isConnected && document.activeElement !== keep) keep.focus({ preventScroll: true })
  }
  place()
  wide.addEventListener('change', place)

  let viewsOpen = false
  let notesOpen = false
  const syncInert = (): void => {
    head.inert = viewsOpen
    side.inert = viewsOpen || notesOpen
  }

  let rows: HTMLButtonElement[] = []
  let current = -1

  function paintCurrent(): void {
    rows.forEach((r, i) => {
      r.classList.toggle('is-current', i === current)
      if (i === current) r.setAttribute('aria-current', 'true')
      else r.removeAttribute('aria-current')
    })
  }

  return {
    setHeader(t, languages) {
      title.textContent = t
      pair.label.textContent = languages
    },
    setElapsed(text) {
      if (time.label.textContent !== text) time.label.textContent = text
    },
    setChapters(items) {
      chaptersEmpty.hidden = items.length > 0
      while (rows.length < items.length) {
        const r = el('button', 'live-chapter')
        r.type = 'button'
        r.append(el('span', 'live-chapter-time'), el('span', 'live-chapter-title'))
        addHaptic(r)
        r.addEventListener('click', () => {
          const i = rows.indexOf(r)
          if (i >= 0) o.onJump(i)
        })
        rows.push(r)
        chapterList.append(r)
      }
      while (rows.length > items.length) rows.pop()!.remove()
      items.forEach((c, i) => {
        const [t, name] = rows[i].children as unknown as HTMLElement[]
        if (t.textContent !== c.time) t.textContent = c.time
        if (name.textContent !== c.title) name.textContent = c.title
        name.lang = c.lang
        name.dir = 'auto'
      })
      if (current >= items.length) current = -1
      paintCurrent()
    },
    setCurrent(i) {
      current = i
      paintCurrent()
    },
    setLatest(visible) {
      latest.hidden = !visible
    },
    setNotes(text) {
      const t = text.trim()
      // Only the start is shown: the style cuts it to a few lines.
      notesText.textContent = t ? t.slice(0, 600) : 'Add names and terms for this call.'
      notesText.classList.toggle('is-empty', !t)
    },
    setRefreshDisabled(disabled) {
      refresh.disabled = disabled
    },
    setStreaming(streaming) {
      replies.root.classList.toggle('is-streaming', streaming)
    },
    setInert(inert) {
      viewsOpen = inert
      syncInert()
    },
    setNotesOpen(open) {
      notesOpen = open
      syncInert()
    },
    setStatus(text) {
      if (status.textContent !== text) status.textContent = text
    },
    focusRefresh() {
      if (refresh.disabled || side.inert || !refresh.offsetParent) return false
      refresh.focus({ preventScroll: true })
      return document.activeElement === refresh
    },
    focusNotesButton() {
      notesBtn.focus({ preventScroll: true })
    }
  }
}
