import type { AppError, SessionStatus, Suggestion, Utterance } from '@shared/types'

export const MAX_UTTERANCES = 300

/** Upsert by id; new ids append, existing ids update in place (keeps order). Keeps the last 300. */
export function upsertUtterance(list: Utterance[], next: Utterance): Utterance[] {
  // Updates almost always hit the tail, so search from the end.
  let i = -1
  for (let k = list.length - 1; k >= 0; k--) {
    if (list[k].id === next.id) {
      i = k
      break
    }
  }
  if (i === -1) {
    const grown = [...list, next]
    return grown.length > MAX_UTTERANCES ? grown.slice(grown.length - MAX_UTTERANCES) : grown
  }
  const copy = list.slice()
  copy[i] = next
  return copy
}

/** Keep the latest suggestion set; a different id replaces, same id updates. */
export function upsertSuggestion(current: Suggestion | null, next: Suggestion): Suggestion {
  void current
  return next
}

export function isExpectedFile(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

/** Replies answer one line. Once the other side finishes a newer line, they no longer apply. */
export function staleAfter(s: Suggestion | null, u: Utterance): Suggestion | null {
  if (!s || s.status === 'streaming' || !u.isFinal || !s.utteranceId || s.utteranceId === u.id) return s
  return null
}

/** Going 'listening' clears session errors, but never a mic notice: the mic stream reports on its own schedule. */
export function errorAfterStatus(error: AppError | null, status: SessionStatus): AppError | null {
  if (status.state !== 'listening') return error
  return error && (error.code === 'no-mic-permission' || error.code === 'mic') ? error : null
}
