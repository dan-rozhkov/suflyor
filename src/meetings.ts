import { MAX_ASK_SOURCES_CHARS } from './ask-limits'
import type { Summary } from './types'

export interface MeetingLine {
  /** Milliseconds since the call started. */
  at: number
  original: string
  translation: string
  originalLang: string
  translationLang: string | null
}

export interface MeetingChapter {
  /** Milliseconds since the call started. */
  at: number
  title: string
}

export interface MeetingAction {
  id: string
  task: string
  owner: string
  done: boolean
}

export type SummaryState =
  | { status: 'pending' }
  | { status: 'ready'; cut: boolean }
  | { status: 'failed'; message: string }
  | { status: 'none' }

export interface Meeting {
  id: string
  startedAt: number
  durationMs: number
  callLanguage: string
  /** Language of the notes and the feed. */
  language: string
  /** The summary title, or a fallback like "Call at 14:05" until the summary is ready. */
  title: string
  /** The call notes the user typed. */
  notes: string
  lines: MeetingLine[]
  chapters: MeetingChapter[]
  summaryState: SummaryState
  actions: MeetingAction[]
  overview: string[]
  topics: { title: string; bullets: string[] }[]
}

export const SOURCES_LIMIT = MAX_ASK_SOURCES_CHARS

/** Shown on notes that were never requested: a call that ended without a tap on Stop. */
export const NOTES_NOT_WRITTEN_MESSAGE = 'Notes were not written for this call.'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const pad = (n: number): string => String(n).padStart(2, '0')

export function newMeetingId(now: number, rand: () => number = Math.random): string {
  const r = Math.floor(rand() * 36 ** 6)
  return `m-${now.toString(36)}-${r.toString(36).padStart(6, '0')}`
}

export function fallbackTitle(startedAt: number): string {
  const d = new Date(startedAt)
  return `Call at ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function applySummary(m: Meeting, s: Summary, cut: boolean): Meeting {
  return {
    ...m,
    title: s.title.trim() || m.title,
    actions: s.actionItems.map((a, i) => ({
      id: `${m.id}-a${i}`,
      task: a.task,
      owner: a.owner,
      done: false,
    })),
    overview: [...s.overview],
    topics: s.topics.map((t) => ({ title: t.title, bullets: [...t.bullets] })),
    summaryState: { status: 'ready', cut },
  }
}

const startOfDay = (t: number): number => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Start of the Monday of the week containing t, local time. */
const startOfWeek = (t: number): number => {
  const d = new Date(startOfDay(t))
  const back = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime()
}

function dateLabel(t: number, now: number): string {
  const day = startOfDay(t)
  const today = startOfDay(now)
  const yesterday = new Date(new Date(today).getFullYear(), new Date(today).getMonth(), new Date(today).getDate() - 1).getTime()
  if (day === today) return 'Today'
  if (day === yesterday) return 'Yesterday'
  const week = startOfWeek(now)
  if (day >= week && day < today) return 'This week'
  const lastWeek = new Date(new Date(week).getFullYear(), new Date(week).getMonth(), new Date(week).getDate() - 7).getTime()
  if (day >= lastWeek && day < week) return 'Last week'
  const d = new Date(t)
  const month = MONTHS[d.getMonth()]
  return d.getFullYear() === new Date(now).getFullYear() ? month : `${month} ${d.getFullYear()}`
}

export function groupByDate(
  meetings: Meeting[],
  now: number,
): { label: string; meetings: Meeting[] }[] {
  const sorted = [...meetings].sort((a, b) => b.startedAt - a.startedAt)
  const groups: { label: string; meetings: Meeting[] }[] = []
  for (const m of sorted) {
    const label = dateLabel(m.startedAt, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.meetings.push(m)
    else groups.push({ label, meetings: [m] })
  }
  return groups
}

export function formatWhen(startedAt: number, now: number): string {
  const d = new Date(startedAt)
  if (startOfDay(startedAt) === startOfDay(now)) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const md = `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${md}, ${d.getFullYear()}`
}

export function formatDuration(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return '<1m'
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${pad(min % 60)}m`
}

export function formatOffset(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function allActions(meetings: Meeting[]): { meeting: Meeting; action: MeetingAction }[] {
  const sorted = [...meetings].sort((a, b) => b.startedAt - a.startedAt)
  const all = sorted.flatMap((meeting) => meeting.actions.map((action) => ({ meeting, action })))
  return [...all.filter((x) => !x.action.done), ...all.filter((x) => x.action.done)]
}

export function openActionCount(meetings: Meeting[]): number {
  let n = 0
  for (const m of meetings) for (const a of m.actions) if (!a.done) n++
  return n
}

const clock = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function notesBlock(m: Meeting): string[] {
  const out: string[] = []
  if (m.actions.length) {
    out.push('Action items:')
    for (const a of m.actions) {
      out.push(`- ${a.owner ? `${a.owner}: ` : ''}${a.task}${a.done ? ' (done)' : ''}`)
    }
  }
  if (m.overview.length) {
    out.push('Overview:')
    for (const o of m.overview) out.push(`- ${o}`)
  }
  for (const t of m.topics) {
    out.push(`${t.title}:`)
    for (const b of t.bullets) out.push(`- ${b}`)
  }
  return out
}

function header(m: Meeting): string[] {
  return [`Title: ${m.title}`, `Date: ${clock(m.startedAt)}`, `Duration: ${formatDuration(m.durationMs)}`]
}

export function transcriptLine(l: MeetingLine): string {
  const t = l.translationLang && l.translation ? l.translation : l.original
  const orig = l.translationLang && l.translation && l.original ? ` (${l.original})` : ''
  return `[${formatOffset(l.at)}] ${t}${orig}`
}

export function transcriptText(m: Meeting): string {
  return m.lines.map(transcriptLine).join('\n')
}

export function meetingSources(m: Meeting): string {
  const head = [...header(m)]
  if (m.notes.trim()) head.push('Call notes:', m.notes.trim())
  head.push(...notesBlock(m))
  const start = head.join('\n')
  const lines = m.lines.map(transcriptLine)
  if (!lines.length) return start.slice(0, SOURCES_LIMIT)
  const title = '\nTranscript:\n'
  const full = start + title + lines.join('\n')
  if (full.length <= SOURCES_LIMIT) return full
  const cappedStart = start.slice(0, Math.floor(SOURCES_LIMIT / 2))
  let room = SOURCES_LIMIT - cappedStart.length - title.length - 1
  const keep: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].length + 1 > room) break
    room -= lines[i].length + 1
    keep.unshift(lines[i])
  }
  return cappedStart + title + keep.join('\n')
}

export function allMeetingsSources(meetings: Meeting[]): string {
  const sorted = [...meetings].sort((a, b) => b.startedAt - a.startedAt)
  const parts: string[] = []
  let len = 0
  for (const m of sorted) {
    const block = [...header(m), ...notesBlock(m)].join('\n')
    const add = block.length + (parts.length ? 2 : 0)
    if (len + add > SOURCES_LIMIT) break
    parts.push(block)
    len += add
  }
  return parts.join('\n\n')
}
