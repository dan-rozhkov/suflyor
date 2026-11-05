/**
 * The merged conversation the suggestions see: the other side ('them', system audio) and the user ('me', microphone),
 * in order of first sight (partials included), last 40 final turns. Pure, no I/O. Also the echo guard: without
 * headphones the microphone hears the speakers, so a mic utterance that repeats what 'them' just said is dropped
 * (60% of its words inside 4-word runs found verbatim in what they said in the last 15 s).
 */
import type { Utterance } from '../shared/types'

/** Final turns kept, oldest dropped first. */
export const MAX_TURNS = 40
/** How far back 'them' text counts as something the microphone may be echoing. */
export const ECHO_WINDOW_MS = 15_000
/** Share of the mic words that must be covered by 4-word runs found verbatim in the recent 'them' text. */
export const ECHO_RATIO = 0.6
/** Length of the word run that counts as copied speech. */
export const ECHO_RUN = 4

function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Echo test. The recent 'them' texts are joined in order; `mine` is an echo when at least 60% of its words sit inside
 * 4-word runs that appear verbatim in that text (Soniox transcribes the same audio almost identically, a real answer
 * rarely repeats four words in a row). Mine under 4 words is an echo only if it equals a whole recent 'them' utterance.
 */
export function isEcho(mine: string, recentThem: string[]): boolean {
  const mw = words(mine)
  if (mw.length === 0) return false
  const texts = recentThem.map(words).filter((w) => w.length > 0)
  if (texts.length === 0) return false
  if (mw.length < ECHO_RUN) {
    const m = mw.join(' ')
    return texts.some((t) => t.join(' ') === m)
  }
  const hay = ` ${texts.map((t) => t.join(' ')).join(' ')} `
  const covered = new Array<boolean>(mw.length).fill(false)
  for (let i = 0; i + ECHO_RUN <= mw.length; i++) {
    if (hay.includes(` ${mw.slice(i, i + ECHO_RUN).join(' ')} `)) for (let k = i; k < i + ECHO_RUN; k++) covered[k] = true
  }
  return covered.filter(Boolean).length / mw.length >= ECHO_RATIO
}

export interface ConversationOptions {
  /** Clock in ms, for tests. */
  now?(): number
}

export interface Conversation {
  /** Upsert by id. The turn keeps the place where its id was first seen (partial included), whatever finalizes first. */
  addThem(u: Utterance): void
  /**
   * Upsert the user's text. Returns false when it is an echo of the other side: it is then dropped entirely (not
   * stored). Returns true for accepted text, including partials (held only to keep order, never listed).
   */
  addMe(u: Utterance): boolean
  /** Final turns in order of first sight, then the current partial of 'them' last. `speaker` is always set. */
  list(): Utterance[]
  /** Text 'them' changed within 15 s before `since` (default: now) or any time after it. */
  recentThem(since?: number): string[]
  clear(): void
}

export function createConversation(opts: ConversationOptions = {}): Conversation {
  const now = opts.now ?? Date.now
  /** Every utterance in order of first sight, final or not. */
  const slots: Utterance[] = []
  /** Ids that left the list (evicted): a late update never resurrects them. */
  const gone = new Set<string>()
  /** When each 'them' text last changed, by id. */
  const themAt = new Map<string, { en: string; at: number }>()
  /** When each mic id was first seen, partial included. */
  const micStart = new Map<string, number>()

  const indexOf = (id: string): number => slots.findIndex((s) => s.id === id)
  const finalCount = (): number => slots.reduce((n, s) => n + (s.isFinal ? 1 : 0), 0)

  function bound(map: Map<string, unknown>): void {
    while (map.size > MAX_TURNS * 4) map.delete(map.keys().next().value as string)
  }

  /** Place or update. A final is never turned back into a partial. */
  function put(u: Utterance): void {
    const i = indexOf(u.id)
    if (i >= 0) {
      if (slots[i].isFinal && !u.isFinal) return
      slots[i] = u
    } else {
      if (gone.has(u.id)) return
      // Soniox has one open segment per stream: an older unfinished one of the same speaker is stale.
      for (let k = slots.length - 1; k >= 0; k--) if (!slots[k].isFinal && slots[k].speaker === u.speaker) slots.splice(k, 1)
      slots.push(u)
    }
    while (finalCount() > MAX_TURNS) {
      const first = slots.findIndex((s) => s.isFinal)
      gone.add(slots[first].id)
      slots.splice(first, 1)
    }
    if (gone.size > MAX_TURNS * 10) gone.delete(gone.values().next().value as string)
  }

  const conv: Conversation = {
    addThem(raw) {
      const u: Utterance = { ...raw, speaker: 'them' }
      if (u.en.trim() === '') return
      const prev = themAt.get(u.id)
      if (!prev || prev.en !== u.en) themAt.set(u.id, { en: u.en, at: now() })
      bound(themAt)
      put(u)
    },
    addMe(raw) {
      const u: Utterance = { ...raw, speaker: 'me' }
      if (u.en.trim() === '') return false
      let start = micStart.get(u.id)
      if (start === undefined) {
        start = now()
        micStart.set(u.id, start)
        bound(micStart)
      }
      const i = indexOf(u.id)
      if (i >= 0 && slots[i].isFinal) {
        put(u) // already accepted and final: just an update
        return true
      }
      if (isEcho(u.en, conv.recentThem(start))) {
        if (i >= 0) slots.splice(i, 1)
        return false
      }
      put(u)
      return true
    },
    list() {
      const finals = slots.filter((s) => s.isFinal)
      const partial = [...slots].reverse().find((s) => !s.isFinal && s.speaker === 'them')
      return partial ? [...finals, partial] : finals
    },
    recentThem(since = now()) {
      const out: string[] = []
      for (const u of slots) {
        if (u.speaker !== 'them') continue
        const at = themAt.get(u.id)?.at
        if (at !== undefined && at >= since - ECHO_WINDOW_MS) out.push(u.en)
      }
      return out
    },
    clear() {
      slots.length = 0
      gone.clear()
      themAt.clear()
      micStart.clear()
    }
  }
  return conv
}
