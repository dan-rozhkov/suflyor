import { h, iconEl, type Child } from './dom'
import { deleteMeeting, getMeeting, listMeetings, onMeetingsChange, setActionDone } from './meetings-db'
import {
  allActions,
  allMeetingsSources,
  formatDuration,
  formatOffset,
  formatWhen,
  groupByDate,
  meetingSources,
  meetingSummary,
  NOTES_NOT_WRITTEN_MESSAGE,
  openActionCount,
  type Meeting
} from './meetings'
import { chapterLineIndex, initials, languagePair, lastTurns, lineText, rowSub } from './meetings-view'
import { requestAnswer } from './ask'
import type { AskTurn } from './ask-prompt'
import { MAX_ASK_QUESTION_CHARS } from './ask-limits'
import { boldParts, summaryLabels, summaryMarkdown } from './summary'
import gmailLogo from './logos/gmail.svg?url'
import googleCalendarLogo from './logos/google-calendar.svg?url'
import notionLogo from './logos/notion.svg?url'
import slackLogo from './logos/slack.svg?url'
import zoomLogo from './logos/zoom.svg?url'
import { addHaptic } from './haptics'
import { copyToClipboard } from './dom'
import { CALL_ROUTE, parentRoute, parseRoute, routeHash, type MeetingTab, type Route } from './router'
import { ICON_ARROW_LEFT, ICON_ARROW_RIGHT, ICON_ARROW_UP, ICON_AT_SIGN, ICON_CALENDAR, ICON_CHECK, ICON_CHECK_SQUARE, ICON_CLOSE, ICON_CLOCK, ICON_COPY, ICON_PLUG, ICON_SPARK, ICON_TRANSLATE, ICON_USERS } from './icons'

export interface UiDeps {
  /** Holds the views and the Ask sheet. */
  root: HTMLElement
  /** The desktop sidebar: its links get the current marker, its Action Items link the open count. */
  sidebar: HTMLElement
  getCode: () => string
  /** The Worker refused the code. */
  onBadCode: () => void
  showError: (message: string) => void
  /** The language of the text the feed shows now. */
  feedLanguage: () => string
  /** True while a summary request for this meeting is running. */
  isSummaryBusy: (id: string) => boolean
  retrySummary: (id: string) => void
  /** A meeting is being deleted: stop what still writes to it. */
  onDelete?: (id: string) => void
  navigate: (route: Route, replace?: boolean) => void
  back: (fallback: Route) => void
}

export interface MeetingsUi {
  /** Shows a view, or hides the views for the call screen (null). */
  show: (route: Route | null) => void
}

const GLOBAL_KEY = '*'
const ARMED_MS = 4000
const mobile = (): boolean => !matchMedia('(min-width: 1024px)').matches

interface AskState {
  turns: AskTurn[]
  pending: string | null
  /** The question of the last failed try, put back in the field. */
  failed: string | null
}

interface AskPane {
  key: string
  log: HTMLElement
  input: HTMLInputElement | HTMLTextAreaElement
  send: HTMLButtonElement
  /** Shown while there are no messages. */
  empty?: HTMLElement
}

interface Built {
  view: HTMLElement
  title: HTMLElement
}

const dayFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const fullFmt = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' })

export function createMeetingsUi(deps: UiDeps): MeetingsUi {
  const { root } = deps
  const asks = new Map<string, AskState>()
  const panes = new Set<AskPane>()
  let route: Route | null = null
  let shownHash = ''
  let seq = 0
  let actionsFilter: 'all' | 'open' = 'all'
  /** A chapter picked on the notes tab: the transcript scrolls to it after it opens. */
  let scrollToLine = -1
  let sheetKey: string | null = null
  let sheetOpener: HTMLElement | null = null

  const host = h('div', { class: 'view-host' })
  root.append(host)

  const askState = (key: string): AskState => {
    let s = asks.get(key)
    if (!s) asks.set(key, (s = { turns: [], pending: null, failed: null }))
    return s
  }

  /* shared pieces */

  function backButton(label: string, to: Route, close = false): HTMLElement {
    const b = h('button', { type: 'button', class: `icon-btn ${close ? 'panel-close' : 'panel-back'}`, 'aria-label': label })
    b.append(iconEl(close ? ICON_CLOSE : ICON_ARROW_LEFT))
    b.addEventListener('click', () => deps.back(to))
    return b
  }

  function navLink(to: Route, cls: string, ...kids: Child[]): HTMLAnchorElement {
    return h('a', { href: routeHash(to) || location.pathname, class: cls, 'data-nav': '' }, ...kids)
  }

  function chip(icon: string, text: string): HTMLElement {
    return h('span', { class: 'chip' }, iconEl(icon), h('span', {}, text))
  }

  function titleEl(text: string, cls = ''): HTMLElement {
    const t = h('h1', { class: `state-title view-title ${cls}`.trim(), tabindex: '-1', dir: 'auto' })
    t.textContent = text
    return t
  }

  function viewShell(kind: string, ...kids: Child[]): HTMLElement {
    return h('section', { class: 'view', 'data-kind': kind }, ...kids)
  }

  function scroller(col: HTMLElement, ctx?: HTMLElement): HTMLElement {
    return h('div', { class: 'view-scroll' }, h('div', { class: `view-body${ctx ? ' has-ctx' : ''}` }, col, ctx))
  }

  /* meetings list */

  function meetingsView(meetings: Meeting[]): Built {
    const title = titleEl('Meetings')
    const col = h('div', { class: 'view-col' }, title)
    if (!meetings.length) {
      col.append(
        h('div', { class: 'view-empty' }, h('p', { class: 'empty-title' }, 'No meetings yet.'), h('p', { class: 'state-text' }, 'Your calls appear here after you tap Stop.'))
      )
    } else {
      const open = openActionCount(meetings)
      if (open) {
        col.append(
          navLink(
            { kind: 'actions' },
            'linkrow',
            iconEl(ICON_CHECK_SQUARE),
            h('span', { class: 'grow' }, 'Action items'),
            h('span', { class: 'muted' }, `${open} open`),
            iconEl(ICON_ARROW_RIGHT)
          )
        )
      }
      const now = Date.now()
      for (const g of groupByDate(meetings, now)) {
        col.append(h('h2', { class: 'group' }, g.label))
        for (const m of g.meetings) {
          const sub = h('div', { class: 'row-sub' }, rowSub(m))
          const name = h('div', { class: 'row-title', dir: 'auto' })
          name.textContent = m.title
          col.append(
            navLink(
              { kind: 'meeting', id: m.id, tab: 'notes' },
              'row',
              h('span', { class: 'avatar' }, initials(m.title) || '·'),
              h('div', { class: 'row-main' }, name, sub),
              h('span', { class: 'row-date' }, formatWhen(m.startedAt, now))
            )
          )
        }
      }
    }
    return { view: viewShell('meetings', backButton('Close', CALL_ROUTE, true), scroller(col)), title }
  }

  /* action items */

  function checkButton(m: Meeting, actionId: string, done: boolean, task: string): HTMLElement {
    const b = h('button', { type: 'button', class: `check${done ? ' is-done' : ''}`, role: 'checkbox', 'aria-checked': String(done), 'aria-label': task, 'data-fk': `a-${actionId}` })
    b.append(iconEl(ICON_CHECK))
    b.addEventListener('click', () => void setActionDone(m.id, actionId, !done))
    return b
  }

  function ownerBadge(owner: string): HTMLElement | null {
    if (!owner.trim()) return null
    const a = h('span', { class: 'avatar sm', title: owner, role: 'img', 'aria-label': owner }, initials(owner) || '·')
    return a
  }

  function actionsView(meetings: Meeting[]): Built {
    const title = titleEl('Action items')
    const col = h('div', { class: 'view-col' }, title)
    const all = allActions(meetings)
    const tabs = h('div', { class: 'pills', role: 'group', 'aria-label': 'Show' })
    for (const f of ['all', 'open'] as const) {
      const b = h('button', { type: 'button', class: 'pill-tab', 'aria-pressed': String(actionsFilter === f) }, f === 'all' ? 'All' : 'Open')
      b.addEventListener('click', () => {
        actionsFilter = f
        void render(route as Route, false)
      })
      tabs.append(b)
    }
    col.append(tabs)
    if (!all.length) {
      col.append(h('div', { class: 'view-empty' }, h('p', { class: 'empty-title' }, 'No action items yet.'), h('p', { class: 'state-text' }, 'Tasks from your call notes appear here.')))
    } else {
      const open = all.filter((x) => !x.action.done)
      const done = all.filter((x) => x.action.done)
      const group = (label: string, list: typeof all): void => {
        if (!list.length) return
        col.append(h('h2', { class: 'group' }, label))
        const ul = h('ul', { class: 'todos' })
        for (const { meeting, action } of list) {
          const task = h('div', { class: 'todo-text', dir: 'auto' })
          task.textContent = action.task
          const details = action.details?.trim() ? withBold(h('div', { class: 'todo-details', dir: 'auto' }), action.details) : null
          const src = navLink({ kind: 'meeting', id: meeting.id, tab: 'notes' }, 'task-src', iconEl(ICON_CALENDAR))
          const srcName = h('span', { dir: 'auto' })
          srcName.textContent = meeting.title
          src.append(srcName)
          ul.append(h('li', { class: `todo${action.done ? ' is-done' : ''}` }, checkButton(meeting, action.id, action.done, action.task), h('div', { class: 'todo-main' }, task, details, src), ownerBadge(action.owner)))
        }
        col.append(ul)
      }
      group(`Open · ${open.length}`, open)
      if (actionsFilter === 'all') group(`Done · ${done.length}`, done)
      else if (!open.length) col.append(h('div', { class: 'view-empty' }, h('p', { class: 'empty-title' }, 'Nothing open.'), h('p', { class: 'state-text' }, 'Every task is done.')))
    }
    return { view: viewShell('actions', backButton('Back', parentRoute({ kind: 'actions' })), scroller(col)), title }
  }

  /* one meeting */

  function tabsEl(m: Meeting, tab: MeetingTab): HTMLElement {
    const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Meeting' })
    for (const t of ['notes', 'transcript'] as const) {
      const b = h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(t === tab) }, t === 'notes' ? 'Notes' : 'Transcript')
      b.addEventListener('click', () => {
        if (t !== tab) deps.navigate({ kind: 'meeting', id: m.id, tab: t }, true)
      })
      tabs.append(b)
    }
    return tabs
  }

  /** Model text with `**` marks: the marked parts become <strong>, everything is set as text. */
  function withBold(el: HTMLElement, text: string): HTMLElement {
    for (const p of boldParts(text)) {
      if (p.bold) {
        const strong = document.createElement('strong')
        strong.textContent = p.text
        el.append(strong)
      } else el.append(p.text)
    }
    return el
  }

  function bullets(items: string[]): HTMLElement {
    const ul = h('ul', { class: 'bullets' })
    for (const t of items) ul.append(withBold(h('li', { dir: 'auto' }), t))
    return ul
  }

  function copyButton(m: Meeting): HTMLElement {
    const labels = summaryLabels(m.language)
    const b = h('button', { type: 'button', class: 'copy-notes' }, iconEl(ICON_COPY), h('span', {}, labels.copy))
    const label = b.lastElementChild as HTMLElement
    let timer = 0
    b.addEventListener('click', () => {
      const st = m.summaryState
      const text = summaryMarkdown({ summary: meetingSummary(m), startedAt: m.startedAt, durationMs: m.durationMs, language: m.language, cut: st.status === 'ready' && st.cut })
      const done = (ok: boolean): void => {
        if (!ok) return deps.showError(labels.copyFailed)
        label.textContent = labels.copied
        window.clearTimeout(timer)
        timer = window.setTimeout(() => {
          label.textContent = labels.copy
        }, 1500)
      }
      void copyToClipboard(text).then(done)
    })
    addHaptic(b as HTMLButtonElement)
    return b
  }

  function notesBody(m: Meeting): HTMLElement {
    const body = h('div', { class: 'notes', role: 'tabpanel', lang: m.language, dir: 'auto' })
    const st = m.summaryState
    const working = st.status === 'pending' && deps.isSummaryBusy(m.id)
    if (working) {
      body.append(
        h('p', { class: 'sr-only', role: 'status' }, 'Writing the notes'),
        h('p', { class: 'state-text', 'aria-hidden': 'true' }, 'Writing the notes…'),
        h('div', { class: 'skeletons', 'aria-hidden': 'true' }, h('span', { class: 'skeleton' }), h('span', { class: 'skeleton' }), h('span', { class: 'skeleton skeleton-short' }))
      )
    } else if (st.status === 'pending' || st.status === 'failed') {
      const msg = st.status === 'failed' && st.message ? st.message : 'The notes were not finished.'
      const retry = h('button', { type: 'button', class: 'solid' }, msg === NOTES_NOT_WRITTEN_MESSAGE ? 'Write notes' : 'Try again')
      retry.addEventListener('click', () => deps.retrySummary(m.id))
      body.append(h('p', { class: 'state-text bad', role: 'alert' }, msg), retry)
    } else if (st.status === 'none') {
      body.append(h('p', { class: 'state-text' }, 'This meeting has no notes. The transcript is in the other tab.'))
    } else {
      const labels = summaryLabels(m.language)
      const people = (m.people ?? []).filter((p) => p.trim())
      if (people.length) {
        const names = h('span', { class: 'people-names', dir: 'auto' })
        names.textContent = people.join(', ')
        body.append(h('p', { class: 'people' }, h('span', { class: 'people-label' }, labels.people), names))
      }
      if (st.cut) body.append(h('p', { class: 'note-cut' }, labels.cut))
      if (m.actions.length) {
        const ul = h('ul', { class: 'todos' })
        for (const a of m.actions) {
          const plainTask = a.task.replace(/\*\*/g, '')
          const task = h('div', { class: 'todo-text', dir: 'auto' })
          task.textContent = plainTask
          const main = h('div', { class: 'todo-main' }, task)
          if (a.details?.trim()) main.append(withBold(h('div', { class: 'todo-details', dir: 'auto' }), a.details))
          ul.append(h('li', { class: `todo${a.done ? ' is-done' : ''}` }, checkButton(m, a.id, a.done, plainTask), main, ownerBadge(a.owner)))
        }
        body.append(h('h2', { class: 'sec sec-small' }, labels.actions), ul)
      }
      if (m.overview.length) body.append(h('h2', { class: 'sec' }, labels.overview), bullets(m.overview))
      for (const t of m.topics) {
        const heading = h('h2', { class: 'sec' })
        heading.textContent = t.title
        body.append(heading, bullets(t.bullets))
      }
      if (!m.actions.length && !m.overview.length && !m.topics.length) body.append(h('p', { class: 'state-text' }, 'The call was too short for notes.'))
      else body.append(copyButton(m))
    }
    return body
  }

  function transcriptBody(m: Meeting): HTMLElement {
    const body = h('div', { class: 'transcript', role: 'tabpanel' })
    const lines = h('div', { class: 'lines' })
    if (!m.lines.length) lines.append(h('p', { class: 'state-text' }, 'No text was heard.'))
    const els: HTMLElement[] = m.lines.map((l) => {
      const v = lineText(l)
      const text = h('p', { class: 'line-text', lang: v.lang, dir: 'auto' })
      text.textContent = v.text
      const time = h('time', { class: 'line-time' }, formatOffset(l.at))
      const el = h('div', { class: 'line' }, time, text)
      if (v.original) {
        const o = h('p', { class: 'line-original', lang: l.originalLang, dir: 'auto' })
        o.textContent = v.original
        el.append(o)
      }
      return el
    })
    lines.append(...els)
    const toLine = (i: number): void => {
      els[i]?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    }
    if (m.chapters.length) {
      const chaps = h('div', { class: 'chap-chips', role: 'group', 'aria-label': 'Chapters' })
      for (const c of m.chapters) {
        const name = h('span', { dir: 'auto' })
        name.textContent = c.title
        const b = h('button', { type: 'button', class: 'chap' }, name, h('i', {}, formatOffset(c.at)))
        b.addEventListener('click', () => toLine(chapterLineIndex(m.lines, c)))
        chaps.append(b)
      }
      body.append(chaps)
    }
    body.append(lines)
    if (scrollToLine >= 0) {
      const i = scrollToLine
      scrollToLine = -1
      requestAnimationFrame(() => toLine(i))
    }
    return body
  }

  function ctxCard(title: string, ...kids: Child[]): HTMLElement {
    return h('section', { class: 'ctx-card' }, h('h2', { class: 'ctx-title' }, title), ...kids)
  }

  function ctxRow(icon: string, text: string): HTMLElement {
    return h('div', { class: 'ctx-row' }, iconEl(icon), h('span', {}, text))
  }

  function ctxColumn(m: Meeting): HTMLElement {
    const aside = h('aside', { class: 'view-ctx', 'aria-label': 'Details' })
    aside.append(ctxCard('Details', ctxRow(ICON_CALENDAR, fullFmt.format(m.startedAt)), ctxRow(ICON_CLOCK, formatDuration(m.durationMs)), ctxRow(ICON_TRANSLATE, languagePair(m))))
    if (m.chapters.length) {
      const list = h('div', { class: 'ctx-chapters' })
      for (const c of m.chapters) {
        const name = h('span', { class: 'ctx-name', dir: 'auto' })
        name.textContent = c.title
        const b = h('button', { type: 'button', class: 'ctx-link' }, name, h('span', { class: 'ctx-time' }, formatOffset(c.at)))
        b.addEventListener('click', () => {
          scrollToLine = chapterLineIndex(m.lines, c)
          deps.navigate({ kind: 'meeting', id: m.id, tab: 'transcript' }, true)
        })
        list.append(b)
      }
      aside.append(ctxCard('Chapters', list))
    }
    return aside
  }

  function deleteButton(m: Meeting): HTMLElement {
    const b = h('button', { type: 'button', class: 'danger' }, 'Delete meeting')
    let timer = 0
    b.addEventListener('click', () => {
      if (!b.classList.contains('armed')) {
        b.classList.add('armed')
        b.textContent = 'Tap again to delete'
        timer = window.setTimeout(() => {
          b.classList.remove('armed')
          b.textContent = 'Delete meeting'
        }, ARMED_MS)
        return
      }
      window.clearTimeout(timer)
      asks.delete(m.id)
      deps.onDelete?.(m.id)
      void deleteMeeting(m.id).then(() => deps.back({ kind: 'meetings' }))
    })
    return b
  }

  function askDock(m: Meeting): HTMLElement {
    const hasTurns = askState(m.id).turns.length > 0
    const field = h('button', { type: 'button', class: 'ask-field', 'data-fk': 'ask' }, h('span', { class: 'ph' }, hasTurns ? 'Ask a follow-up…' : 'Ask about this meeting…'), h('span', { class: 'send off', 'aria-hidden': 'true' }))
    field.lastElementChild!.append(iconEl(ICON_ARROW_UP))
    field.addEventListener('click', () => openSheet(m, field))
    return h('div', { class: 'ask-dock' }, field)
  }

  function meetingView(m: Meeting, tab: MeetingTab): Built {
    const title = titleEl(m.title)
    const chips = h('div', { class: 'chips' }, chip(ICON_CALENDAR, dayFmt.format(m.startedAt)), chip(ICON_CLOCK, formatDuration(m.durationMs)), chip(ICON_TRANSLATE, languagePair(m)))
    const col = h('div', { class: 'view-col' }, title, chips, tabsEl(m, tab), tab === 'notes' ? notesBody(m) : transcriptBody(m))
    if (tab === 'notes') col.append(deleteButton(m))
    return { view: viewShell('meeting', backButton('Back', parentRoute({ kind: 'meeting', id: m.id, tab: 'notes' })), scroller(col, ctxColumn(m)), askDock(m)), title }
  }

  function missingView(): Built {
    const title = titleEl('Not found')
    const col = h('div', { class: 'view-col' }, title, h('p', { class: 'state-text' }, 'This meeting is not saved in this browser.'))
    return { view: viewShell('missing', backButton('Back', { kind: 'meetings' }), scroller(col)), title }
  }

  /* Ask */

  function message(kind: 'q' | 'a', text: string): HTMLElement {
    const el = h('p', { class: `msg msg-${kind}`, dir: 'auto' })
    el.textContent = text
    return el
  }

  function paintPane(p: AskPane): void {
    const st = askState(p.key)
    const out: HTMLElement[] = []
    for (const t of st.turns) out.push(message('q', t.question), message('a', t.answer))
    if (st.pending) {
      out.push(message('q', st.pending))
      out.push(h('div', { class: 'msg msg-a msg-wait', role: 'status', 'aria-label': 'Finding the answer' }, h('span', { class: 'skeleton' }), h('span', { class: 'skeleton skeleton-short' })))
    }
    p.log.replaceChildren(...out)
    if (p.empty) p.empty.hidden = out.length > 0
    p.log.hidden = out.length === 0
    p.log.closest('.ask-col')?.classList.toggle('has-turns', out.length > 0)
    p.send.disabled = !!st.pending
    p.input.readOnly = !!st.pending
    if (st.failed && !p.input.value) {
      p.input.value = st.failed
      st.failed = null
    }
    const scroll = p.log.closest<HTMLElement>('.sheet-body, .view-scroll')
    if (scroll) scroll.scrollTop = scroll.scrollHeight
  }

  function repaint(key: string): void {
    for (const p of panes) if (p.key === key) paintPane(p)
  }

  async function ask(key: string, question: string): Promise<void> {
    const st = askState(key)
    const q = question.trim().slice(0, MAX_ASK_QUESTION_CHARS)
    if (!q || st.pending) return
    st.pending = q
    st.failed = null
    repaint(key)
    const meeting = key === GLOBAL_KEY ? null : await getMeeting(key)
    const sources = key === GLOBAL_KEY ? allMeetingsSources(await listMeetings()) : meeting ? meetingSources(meeting) : ''
    const fail = (message: string): void => {
      st.pending = null
      st.failed = q
      if (message) deps.showError(message)
      repaint(key)
    }
    if (!sources) return fail(key === GLOBAL_KEY ? 'Save a call first, then ask about it.' : 'This meeting is not saved any more.')
    const language = meeting ? meeting.language : deps.feedLanguage()
    const r = await requestAnswer({ code: deps.getCode(), sources, question: q, history: lastTurns(st.turns), language })
    if (!r.ok) {
      fail(r.badCode ? '' : r.message)
      if (r.badCode) deps.onBadCode()
      return
    }
    st.pending = null
    st.turns.push({ question: q, answer: r.answer })
    repaint(key)
  }

  /** The text field and send button of a pane. Sending clears the field; a failure puts the question back. */
  function composer(key: string, multiline: boolean, placeholder: string): { form: HTMLFormElement; pane: Pick<AskPane, 'input' | 'send'> } {
    const input = multiline
      ? h('textarea', { class: 'composer-input', rows: '2', maxlength: String(MAX_ASK_QUESTION_CHARS), placeholder, 'aria-label': placeholder })
      : h('input', { class: 'composer-input', type: 'text', maxlength: String(MAX_ASK_QUESTION_CHARS), placeholder, 'aria-label': placeholder, autocomplete: 'off', enterkeyhint: 'send' })
    const send = h('button', { type: 'submit', class: 'send', 'aria-label': 'Send' })
    send.append(iconEl(ICON_ARROW_UP))
    const form = h('form', { class: 'composer' }, input, send)
    const submit = (): void => {
      const q = input.value.trim()
      if (!q || askState(key).pending) return
      input.value = ''
      void ask(key, q)
    }
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      submit()
    })
    if (multiline) {
      input.addEventListener('keydown', (e) => {
        const ke = e as KeyboardEvent
        if (ke.key === 'Enter' && !ke.shiftKey && !ke.isComposing) {
          e.preventDefault()
          submit()
        }
      })
    }
    return { form, pane: { input, send } }
  }

  const PROMPTS: { icon: string; text: string }[] = [
    { icon: ICON_CALENDAR, text: 'Help me prepare for my next meeting' },
    { icon: ICON_USERS, text: 'What did we discuss with Sarah last time?' },
    { icon: ICON_PLUG, text: 'Connect Slack to get answers from your chats' }
  ]
  const SERVICES = [
    { name: 'Slack', src: slackLogo },
    { name: 'Notion', src: notionLogo },
    { name: 'Gmail', src: gmailLogo },
    { name: 'Google Calendar', src: googleCalendarLogo },
    { name: 'Zoom', src: zoomLogo }
  ]
  const STRIP_KEY = 'suflyorAskStripHidden'

  function stripHidden(): boolean {
    try {
      return localStorage.getItem(STRIP_KEY) === '1'
    } catch {
      return false
    }
  }

  function toolButton(label: string, svg: string): HTMLButtonElement {
    return h('button', { type: 'button', class: 'icon-btn ask-tool', 'aria-label': label, title: label }, iconEl(svg))
  }

  function askView(): Built {
    const title = h('h1', { class: 'state-title view-title ask-title', tabindex: '-1' }, iconEl(ICON_SPARK, 'ask-title-ic'), 'Ask Suflyor')
    const log = h('div', { class: 'ask-log', role: 'log', 'aria-label': 'Answers' })
    // The long hint fits the desktop box; a phone keeps the short one.
    const placeholder = window.matchMedia('(min-width: 1024px)').matches ? 'Ask a question. Type @ to mention people, companies, tags or meetings' : 'Ask about all your meetings'
    const c = composer(GLOBAL_KEY, true, placeholder)
    const input = c.pane.input
    c.form.classList.add('ask-box')

    const at = toolButton('Mention', ICON_AT_SIGN)
    at.addEventListener('click', () => {
      const start = input.selectionStart ?? input.value.length
      const end = input.selectionEnd ?? start
      if (input.value.length - (end - start) + 1 > MAX_ASK_QUESTION_CHARS) return
      input.focus()
      input.setRangeText('@', start, end, 'end')
    })
    const plug = toolButton('Connect apps', ICON_PLUG)
    const tools = h('div', { class: 'ask-tools' }, at, plug)
    const send = c.pane.send
    c.form.insertBefore(tools, send)

    const strip = h('div', { class: 'ask-connect' }, h('span', { class: 'ask-connect-text' }, 'Get better answers by connecting your apps'))
    const logos = h('span', { class: 'ask-logos' })
    for (const sv of SERVICES) logos.append(h('img', { class: 'ask-logo', src: sv.src, alt: sv.name, title: sv.name }))
    const dismiss = h('button', { type: 'button', class: 'icon-btn ask-close', 'aria-label': 'Dismiss', title: 'Dismiss' }, iconEl(ICON_CLOSE))
    strip.append(logos, dismiss)
    strip.hidden = stripHidden()
    dismiss.addEventListener('click', () => {
      strip.hidden = true
      try {
        localStorage.setItem(STRIP_KEY, '1')
      } catch {
        // The strip stays hidden for this visit only.
      }
      input.focus()
    })
    c.form.append(strip)

    const prompts = h('div', { class: 'ask-prompts' })
    for (const p of PROMPTS) {
      const b = h('button', { type: 'button', class: 'ask-prompt' }, iconEl(p.icon, 'ic'), h('span', {}, p.text))
      b.addEventListener('click', () => {
        input.value = p.text.slice(0, MAX_ASK_QUESTION_CHARS)
        input.focus()
        input.setSelectionRange(input.value.length, input.value.length)
      })
      prompts.append(b)
    }
    const empty = h('div', { class: 'ask-empty' }, prompts)
    const col = h('div', { class: 'view-col ask-col' }, title, log, h('div', { class: 'ask-compose' }, c.form), empty)
    const pane: AskPane = { key: GLOBAL_KEY, log, empty, ...c.pane }
    panes.add(pane)
    queueMicrotask(() => paintPane(pane))
    return { view: viewShell('ask', backButton('Back', CALL_ROUTE), scroller(col)), title }
  }

  /* the Ask sheet for one meeting */

  const sheetTitle = h('h2', { class: 'sheet-title', id: 'sheet-title' }, 'Ask')
  const sheetSub = h('p', { class: 'sheet-sub', dir: 'auto' })
  const sheetClose = h('button', { type: 'button', class: 'icon-btn sheet-close', 'aria-label': 'Close' })
  sheetClose.append(iconEl(ICON_CLOSE))
  const sheetLog = h('div', { class: 'sheet-log', role: 'log', 'aria-label': 'Answers' })
  const sheetHint = h('p', { class: 'state-text sheet-hint' }, 'Ask anything about this meeting.')
  const sheetComposer = composerFor()
  const sheet = h(
    'section',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title', hidden: true },
    h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
    h('div', { class: 'sheet-head' }, h('div', {}, sheetTitle, sheetSub), sheetClose),
    h('div', { class: 'sheet-body' }, sheetHint, sheetLog),
    sheetComposer
  )
  const scrim = h('div', { class: 'scrim', hidden: true })
  root.append(scrim, sheet)
  const sheetPane: AskPane = { key: '', log: sheetLog, input: sheetComposer.querySelector('.composer-input') as HTMLInputElement, send: sheetComposer.querySelector('.send') as HTMLButtonElement, empty: sheetHint }
  panes.add(sheetPane)

  /** The sheet's form is built once; the pane's key changes with the meeting, so the handlers read it. */
  function composerFor(): HTMLFormElement {
    const input = h('input', { class: 'composer-input', type: 'text', maxlength: String(MAX_ASK_QUESTION_CHARS), placeholder: 'Ask a question…', 'aria-label': 'Question', autocomplete: 'off', enterkeyhint: 'send' })
    const send = h('button', { type: 'submit', class: 'send', 'aria-label': 'Send' })
    send.append(iconEl(ICON_ARROW_UP))
    const form = h('form', { class: 'composer sheet-form' }, input, send)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const q = input.value.trim()
      if (!q || !sheetKey || askState(sheetKey).pending) return
      input.value = ''
      void ask(sheetKey, q)
    })
    return form
  }

  function openSheet(m: Meeting, opener: HTMLElement): void {
    sheetKey = m.id
    sheetOpener = opener
    sheetPane.key = m.id
    sheetSub.textContent = m.title
    const has = askState(m.id).turns.length > 0
    sheetPane.input.placeholder = has ? 'Ask a follow-up…' : 'Ask a question…'
    paintPane(sheetPane)
    scrim.hidden = false
    sheet.hidden = false
    host.inert = true
    deps.sidebar.inert = true
    sheetPane.input.focus({ preventScroll: true })
  }

  function closeSheet(returnFocus: boolean): void {
    if (sheetKey === null) return
    sheetKey = null
    sheet.hidden = true
    scrim.hidden = true
    host.inert = false
    deps.sidebar.inert = false
    const back = sheetOpener
    sheetOpener = null
    if (returnFocus && back?.isConnected) back.focus({ preventScroll: true })
  }
  sheetClose.addEventListener('click', () => closeSheet(true))
  scrim.addEventListener('click', () => closeSheet(true))

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !route || route.kind === 'call') return
    if (sheetKey !== null) {
      closeSheet(true)
      e.preventDefault()
      return
    }
    // A phone shows a view as a panel; on a desktop the sidebar is the way out.
    if (mobile() && !root.hidden) deps.back(parentRoute(route))
  })

  /* sidebar and links */

  function syncSidebar(meetings: Meeting[]): void {
    const kind = route?.kind ?? 'call'
    const current = kind === 'meeting' ? 'meetings' : kind
    deps.sidebar.querySelectorAll<HTMLElement>('[data-route]').forEach((el) => {
      if (el.dataset.route === current) el.setAttribute('aria-current', 'page')
      else el.removeAttribute('aria-current')
    })
    const count = deps.sidebar.querySelector<HTMLElement>('[data-count]')
    if (count) {
      const n = openActionCount(meetings)
      count.textContent = n ? String(n) : ''
      count.hidden = !n
      count.setAttribute('aria-label', `${n} open`)
    }
  }

  function followLink(e: Event): void {
    const me = e as MouseEvent
    if (me.defaultPrevented || me.button !== 0 || me.metaKey || me.ctrlKey || me.shiftKey || me.altKey) return
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[data-nav]')
    if (!a) return
    e.preventDefault()
    const to = parseRoute(a.getAttribute('href') ?? '')
    // The view already shown: no new history entry.
    if (routeHash(to) === routeHash(route ?? CALL_ROUTE)) return
    deps.navigate(to)
  }
  root.addEventListener('click', followLink)
  deps.sidebar.addEventListener('click', followLink)

  /* rendering */

  function build(r: Route, meetings: Meeting[]): Built {
    switch (r.kind) {
      case 'meetings':
        return meetingsView(meetings)
      case 'actions':
        return actionsView(meetings)
      case 'ask':
        return askView()
      case 'meeting': {
        const m = meetings.find((x) => x.id === r.id)
        return m ? meetingView(m, r.tab) : missingView()
      }
      case 'call':
        return meetingsView(meetings)
    }
  }

  async function render(r: Route, focusTitle: boolean): Promise<void> {
    const my = ++seq
    const meetings = await listMeetings()
    if (my !== seq || route === null) return
    syncSidebar(meetings)
    // The ask screen holds no list, so a change of the list never rebuilds it (and loses the text being typed).
    if (!focusTitle && r.kind === 'ask' && shownHash === routeHash(r) && host.firstChild) return
    const scroller = host.querySelector<HTMLElement>('.view-scroll')
    const top = scroller?.scrollTop ?? 0
    const focused = document.activeElement as HTMLElement | null
    const focusKey = host.contains(focused) ? focused?.dataset.fk : undefined
    const sameView = routeHash(r) === shownHash
    for (const p of [...panes]) if (p !== sheetPane) panes.delete(p)
    const built = build(r, meetings)
    host.replaceChildren(built.view)
    shownHash = routeHash(r)
    if (sameView && !focusTitle) {
      const next = built.view.querySelector<HTMLElement>('.view-scroll')
      if (next) next.scrollTop = top
      if (focusKey) host.querySelector<HTMLElement>(`[data-fk="${focusKey}"]`)?.focus({ preventScroll: true })
    } else if (focusTitle) {
      built.title.focus({ preventScroll: true })
    }
  }

  onMeetingsChange(() => {
    if (route && route.kind !== 'call') void render(route, false)
    else void listMeetings().then(syncSidebar)
  })

  return {
    show(r) {
      const prev = route
      route = r && r.kind !== 'call' ? r : null
      if (sheetKey !== null && !(route && route.kind === 'meeting' && route.id === sheetKey)) closeSheet(false)
      root.hidden = !route
      if (!route) {
        shownHash = ''
        seq++
        void listMeetings().then(syncSidebar)
        return
      }
      const sameRoute = !!prev && routeHash(prev) === routeHash(route)
      void render(route, !sameRoute)
    }
  }
}
