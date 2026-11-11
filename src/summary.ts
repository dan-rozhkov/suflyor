import { MAX_CONTEXT_CHARS } from './suggest-prompt'
import { isMissingKey } from './chapters'
import { MAX_SUMMARY_CHARS, MAX_SUMMARY_LINES } from './summary-limits'
import { BAD_CODE_MESSAGE, isHeaderSafe } from './token'
import type { Summary } from './types'

export const SUMMARY_FAILED_MESSAGE = 'Could not summarize the call. Try again.'
export const SUMMARY_TIMEOUT_MESSAGE = 'The summary is taking too long. Try again.'
export const SUMMARY_NOT_SET_UP_MESSAGE = 'Summaries are not set up yet.'
export const SUMMARY_TOO_LONG_MESSAGE = 'The call is too long to summarize.'
export const SUMMARY_TIMEOUT_MS = 90_000

export type SummaryResult = { ok: true; summary: Summary } | { ok: false; message: string; badCode?: true }

/** The newest lines that fit the request limits. A single line over the limit keeps its last part. */
export function summaryLines(lines: string[]): { lines: string[]; cut: boolean } {
  const kept: string[] = []
  let chars = 0
  for (let i = lines.length - 1; i >= 0 && kept.length < MAX_SUMMARY_LINES; i--) {
    const next = chars + lines[i].length + (kept.length ? 1 : 0)
    if (next > MAX_SUMMARY_CHARS) {
      if (!kept.length) kept.push(lines[i].slice(-MAX_SUMMARY_CHARS))
      break
    }
    kept.push(lines[i])
    chars = next
  }
  kept.reverse()
  return { lines: kept, cut: kept.length < lines.length || (kept.length === 1 && kept[0].length < lines[lines.length - 1].length) }
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Keeps only what the page draws; anything that does not fit the shape is a failure. People and action context are optional, so an older Worker still works. */
function parseSummary(data: unknown): Summary | null {
  const s = isObject(data) ? data.summary : null
  if (!isObject(s) || typeof s.title !== 'string') return null
  const { actionItems, overview, topics, people } = s
  if (!Array.isArray(actionItems) || !isStrings(overview) || !Array.isArray(topics)) return null
  if (people !== undefined && !isStrings(people)) return null
  const actions: Summary['actionItems'] = []
  for (const a of actionItems) {
    if (!isObject(a) || typeof a.task !== 'string') return null
    const owner = typeof a.owner === 'string' ? a.owner : ''
    const details = typeof a.details === 'string' ? a.details.trim() : ''
    actions.push(details ? { owner, task: a.task, details } : { owner, task: a.task })
  }
  const parsedTopics: Summary['topics'] = []
  for (const t of topics) {
    if (!isObject(t) || typeof t.title !== 'string' || !isStrings(t.bullets)) return null
    parsedTopics.push({ title: t.title, bullets: t.bullets })
  }
  const named = (people ?? []).map((p) => p.trim()).filter(Boolean)
  const out: Summary = { title: s.title, actionItems: actions, overview, topics: parsedTopics }
  if (named.length) out.people = named
  return out
}

export interface SummaryRequest {
  code: string
  lines: string[]
  context: string
  /** The language of the lines, and the language the notes are written in. */
  callLanguage: string
  language: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export async function requestSummary({ code, lines, context, callLanguage, language, signal, fetchImpl }: SummaryRequest): Promise<SummaryResult> {
  if (!isHeaderSafe(code)) return { ok: false, message: BAD_CODE_MESSAGE, badCode: true }
  const doFetch: typeof fetch = fetchImpl ?? ((...a) => fetch(...a))
  const ctrl = new AbortController()
  let timedOut = false
  const onAbort = (): void => ctrl.abort()
  if (signal?.aborted) return { ok: false, message: '' }
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, SUMMARY_TIMEOUT_MS)
  try {
    const res = await doFetch('/api/summary', {
      method: 'POST',
      headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, context: context.slice(0, MAX_CONTEXT_CHARS), callLanguage, language }),
      signal: ctrl.signal
    })
    if (res.status === 401) return { ok: false, message: BAD_CODE_MESSAGE, badCode: true }
    if (res.status === 413) return { ok: false, message: SUMMARY_TOO_LONG_MESSAGE }
    if (await isMissingKey(res)) return { ok: false, message: SUMMARY_NOT_SET_UP_MESSAGE }
    if (!res.ok) return { ok: false, message: SUMMARY_FAILED_MESSAGE }
    const summary = parseSummary(await res.json())
    return summary ? { ok: true, summary } : { ok: false, message: SUMMARY_FAILED_MESSAGE }
  } catch {
    if (signal?.aborted) return { ok: false, message: '' }
    return { ok: false, message: timedOut ? SUMMARY_TIMEOUT_MESSAGE : SUMMARY_FAILED_MESSAGE }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

const dateFmts = {
  ru: new Intl.DateTimeFormat('ru', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
  en: new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "Tuesday, November 10, 2026 at 11:00 AM": when the call began. Any language but Russian gets English. */
export function summaryDate(startedAt: number, language: string): string {
  return language === 'ru' ? dateFmts.ru.format(startedAt).replace(/\s?г\./, '') : dateFmts.en.format(startedAt)
}

/** "13:41", or "1:02:05" past an hour: how long the call ran, to the second. */
export function summaryDuration(durationMs: number): string {
  const total = Math.max(0, Math.round(durationMs / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export interface SummaryDetail {
  label: string
  value: string
}

/** Date, Duration and People. The first two are measured by the page; People shows only when the call named someone. */
export function summaryDetails(summary: Pick<Summary, 'people'>, startedAt: number, durationMs: number, language: string): SummaryDetail[] {
  const labels = summaryLabels(language)
  const rows = [
    { label: labels.date, value: summaryDate(startedAt, language) },
    { label: labels.duration, value: summaryDuration(durationMs) }
  ]
  const people = (summary.people ?? []).filter((p) => p.trim())
  if (people.length) rows.push({ label: labels.people, value: people.join(', ') })
  return rows
}

/** The page UI is English, so every language but Russian gets English headings. */
export function summaryLabels(language: string): {
  actions: string
  overview: string
  date: string
  duration: string
  people: string
  cut: string
  ready: string
  copy: string
  copied: string
  copyFailed: string
} {
  return language === 'ru'
    ? {
        actions: 'Задачи',
        overview: 'Обзор',
        date: 'Дата',
        duration: 'Длительность',
        people: 'Участники',
        cut: 'Итоги только по последней части разговора.',
        ready: 'Итоги готовы',
        copy: 'Скопировать итоги',
        copied: 'Скопировано',
        copyFailed: 'Не удалось скопировать итоги.'
      }
    : {
        actions: 'Action items',
        overview: 'Overview',
        date: 'Date',
        duration: 'Duration',
        people: 'People',
        cut: 'This summary covers only the last part of the call.',
        ready: 'Summary ready',
        copy: 'Copy notes',
        copied: 'Copied',
        copyFailed: 'Could not copy the notes.'
      }
}

/** Splits text on its `**` marks: odd pieces are the numbers the model marked. Text without marks is one plain piece. */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  const parts = text.split('**')
  // An unpaired mark is not bold: notes from before the marks, or a broken pair, show as written minus the mark.
  if (parts.length % 2 === 0) return [{ text: parts.join(''), bold: false }].filter((p) => p.text)
  return parts.map((part, i) => ({ text: part, bold: i % 2 === 1 })).filter((p) => p.text)
}

/** Line breaks and runs of spaces become one space. The no-break space in "30 000" stays. */
const oneLine = (s: string): string => s.replace(/[ \t\r\n\f\v]+/g, ' ').trim()

export interface SummaryMarkdownInput {
  summary: Summary
  startedAt: number
  durationMs: number
  language: string
  /** The notes cover only the latest part of a long call. */
  cut?: boolean
}

/**
 * The notes as markdown, in the meeting-notes layout: an H1 title, Date, Duration and People, then H4 sections
 * for action items, the overview and each topic. Nothing is added that the notes do not hold.
 */
export function summaryMarkdown({ summary, startedAt, durationMs, language, cut }: SummaryMarkdownInput): string {
  const labels = summaryLabels(language)
  const head = [`# ${oneLine(summary.title)}`]
  const details = summaryDetails(summary, startedAt, durationMs, language)
  // Two trailing spaces keep each detail on its own line.
  head.push(details.map((d) => `**${d.label}**: ${oneLine(d.value)}`).join('  \n'))
  if (cut) head.push(`_${labels.cut}_`)
  const sections: string[] = []
  if (summary.actionItems.length) {
    const items = summary.actionItems.map((a) => {
      const owner = oneLine(a.owner)
      const task = `**${oneLine(a.task).replace(/\*+/g, '')}**`
      const line = `- [ ] ${owner ? `${owner} - ` : ''}${task}`
      return a.details?.trim() ? `${line}\n${oneLine(a.details)}` : line
    })
    sections.push([`#### ${labels.actions}`, ...items].join('\n'))
  }
  const bullets = (title: string, list: string[]): string => [`#### ${oneLine(title)}`, ...list.map((b) => `* ${oneLine(b)}`)].join('\n')
  if (summary.overview.length) sections.push(bullets(labels.overview, summary.overview))
  for (const t of summary.topics) if (t.bullets.length) sections.push(bullets(t.title, t.bullets))
  return `${[...head, ...sections].join('\n\n')}\n`
}
