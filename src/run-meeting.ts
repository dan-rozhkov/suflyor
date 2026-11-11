import { fallbackTitle, newMeetingId, type Meeting, type MeetingLine } from './meetings'
import type { Chapter } from './chapters'
import type { Utterance } from './types'

export interface RunInput {
  utterances: Utterance[]
  /** When each paragraph of each utterance first appeared (epoch ms). */
  stamps: Map<string, number[]>
  chapters: Chapter[]
  startedAt: number
  durationMs: number
  callLanguage: string
  language: string
  notes: string
}

/** True when the run heard any text: only then is a meeting saved. */
export const heardText = (utterances: Utterance[]): boolean => utterances.some((u) => u.original.trim() || u.translation.trim())

/** A pending meeting for one finished run. Lines carry offsets from the start of the call. */
export function buildMeeting(run: RunInput, now: number = Date.now(), id: string = newMeetingId(now)): Meeting {
  const offset = (t: number | undefined): number => Math.max(0, Math.round((t ?? run.startedAt) - run.startedAt))
  const lines: MeetingLine[] = run.utterances
    .filter((u) => u.original.trim() || u.translation.trim())
    .map((u) => ({
      at: offset(run.stamps.get(u.id)?.[0]),
      original: u.original.trim(),
      translation: u.translation.trim(),
      originalLang: u.originalLang,
      translationLang: u.translationLang
    }))
  return {
    id,
    startedAt: run.startedAt,
    durationMs: Math.max(0, run.durationMs),
    callLanguage: run.callLanguage,
    language: run.language,
    title: fallbackTitle(run.startedAt),
    notes: run.notes,
    lines,
    chapters: run.chapters
      .filter((c) => c.at >= run.startedAt)
      .map((c) => ({ at: offset(c.at), title: c.title })),
    summaryState: { status: 'pending' },
    actions: [],
    overview: [],
    topics: []
  }
}
