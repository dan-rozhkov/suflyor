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

/** Splits text on the model's `**` marks: odd pieces are the numbers and dates it marked. */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  return text
    .split('**')
    .map((part, i) => ({ text: part, bold: i % 2 === 1 }))
    .filter((p) => p.text)
}

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

/** Keeps only what the page draws; anything that does not fit the shape is a failure. */
function parseSummary(data: unknown): Summary | null {
  const s = isObject(data) ? data.summary : null
  if (!isObject(s) || typeof s.title !== 'string') return null
  const { actionItems, overview, topics } = s
  if (!Array.isArray(actionItems) || !isStrings(overview) || !Array.isArray(topics)) return null
  const actions: Summary['actionItems'] = []
  for (const a of actionItems) {
    if (!isObject(a) || typeof a.task !== 'string') return null
    actions.push({ owner: typeof a.owner === 'string' ? a.owner : '', task: a.task })
  }
  const parsedTopics: Summary['topics'] = []
  for (const t of topics) {
    if (!isObject(t) || typeof t.title !== 'string' || !isStrings(t.bullets)) return null
    parsedTopics.push({ title: t.title, bullets: t.bullets })
  }
  return { title: s.title, actionItems: actions, overview, topics: parsedTopics }
}

export interface SummaryRequest {
  code: string
  lines: string[]
  context: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export async function requestSummary({ code, lines, context, signal, fetchImpl }: SummaryRequest): Promise<SummaryResult> {
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
      body: JSON.stringify({ lines, context: context.slice(0, MAX_CONTEXT_CHARS) }),
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

const dateFmt = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' })

/** "6 ноября 2026 · 12 мин": the day the call began and how long it ran. */
export function summaryMeta(startedAt: number, durationMs: number): string {
  const date = dateFmt.format(startedAt).replace(/\s?г\.$/, '')
  const minutes = Math.round(durationMs / 60_000)
  return `${date} · ${durationMs < 60_000 ? 'меньше минуты' : `${minutes} мин`}`
}
