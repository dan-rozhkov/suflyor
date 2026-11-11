import { languageName } from './languages'
import { formatDuration, type Meeting, type MeetingChapter, type MeetingLine } from './meetings'
import type { AskTurn } from './ask-prompt'
import { MAX_ASK_HISTORY_TURNS, MAX_ASK_TURN_CHARS } from './ask-limits'

/** Up to two capital letters from the first words of a title or a name. */
export function initials(text: string): string {
  const letters = text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => Array.from(w).find((c) => /\p{L}|\p{N}/u.test(c)) ?? '')
    .filter(Boolean)
    .slice(0, 2)
  return letters.join('').toLocaleUpperCase()
}

/** "Italian → English", or just the spoken language when nothing was translated. */
export function languagePair(m: Pick<Meeting, 'callLanguage' | 'language'>): string {
  const from = languageName(m.callLanguage)
  return m.language === m.callLanguage ? from : `${from} → ${languageName(m.language)}`
}

/** The second line of a meeting row. */
export function rowSub(m: Meeting): string {
  const open = m.actions.filter((a) => !a.done).length
  const parts = [languagePair(m), formatDuration(m.durationMs)]
  if (open) parts.push(`${open} open`)
  return parts.join(' · ')
}

/** Index of the first line at or after the chapter start; the last line when the chapter starts later than all of them. */
export function chapterLineIndex(lines: MeetingLine[], chapter: MeetingChapter): number {
  const i = lines.findIndex((l) => l.at >= chapter.at)
  return i < 0 ? Math.max(0, lines.length - 1) : i
}

/** The newest turns the Worker accepts, each cut to its size limit. */
export function lastTurns(turns: AskTurn[]): AskTurn[] {
  return turns.slice(-MAX_ASK_HISTORY_TURNS).map((t) => ({
    question: t.question.slice(0, MAX_ASK_TURN_CHARS),
    answer: t.answer.slice(0, MAX_ASK_TURN_CHARS)
  }))
}

/** The text a transcript line shows: the translation when there is one. */
export function lineText(l: MeetingLine): { text: string; lang: string; original: string } {
  const translated = !!l.translationLang && !!l.translation.trim()
  return {
    text: translated ? l.translation : l.original,
    lang: translated ? (l.translationLang as string) : l.originalLang,
    original: translated && l.original.trim() ? l.original : ''
  }
}
