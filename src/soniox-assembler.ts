/**
 * Pure assembler: Soniox real-time tokens -> utterances. No I/O.
 *
 * Protocol facts (docs.soniox.com):
 * - Each response carries `tokens`. Final tokens (is_final) arrive once and are permanent. Non-final tokens are
 *   resent in full with every response, so they replace the previous non-final set.
 * - With translation, `translation_status` is 'original' (spoken text), 'translation' (target language) or 'none'.
 * - With endpoint detection a `<end>` token (always final) closes the segment. `<fin>` answers a manual finalize.
 */
import type { Utterance } from './types'

export interface SonioxToken {
  text: string
  is_final?: boolean
  translation_status?: 'none' | 'original' | 'translation' | string
  language?: string
  start_ms?: number
  end_ms?: number
}

const END = '<end>'
const FIN = '<fin>'

interface Open {
  id: string
  finalOriginal: string
  finalTranslation: string
  partialOriginal: string
  partialTranslation: string
}

/** A segment closed by <end> whose translation may still be arriving. */
interface Closed {
  id: string
  original: string
  translation: string
  partialTranslation: string
}

const MAX_AWAITING = 3
const MAX_EMITTED = 200

/**
 * Translation lags the source: Soniox streams the translation tokens of segment N after its <end>, possibly after
 * the original of segment N+1 has started. Closed segments are kept in an ordered queue; translation tokens go to the
 * oldest one that is still waiting (no translation yet), or to the head while the open segment has no original.
 * Otherwise they belong to the open segment and the head is retired.
 */
export class TokenAssembler {
  private seq = 0
  private cur: Open
  private awaiting: Closed[] = []
  private lastEmitted = new Map<string, string>()
  /** Closed segments that got translation tokens in the response being processed. */
  private touched = new Set<Closed>()

  constructor(
    private readonly idPrefix = 'u',
    private readonly languages: { source: string; target: string | null } = { source: 'en', target: 'ru' }
  ) {
    this.cur = this.fresh()
  }

  private fresh(): Open {
    this.seq += 1
    return { id: `${this.idPrefix}${this.seq}`, finalOriginal: '', finalTranslation: '', partialOriginal: '', partialTranslation: '' }
  }

  private utterance(id: string, original: string, translation: string, isFinal: boolean): Utterance {
    return { id, original, translation, originalLang: this.languages.source, translationLang: this.languages.target, isFinal }
  }

  private view(o: Open, isFinal: boolean): Utterance {
    return this.utterance(o.id, (o.finalOriginal + o.partialOriginal).trim(), (o.finalTranslation + o.partialTranslation).trim(), isFinal)
  }

  private emit(out: Utterance[], u: Utterance): void {
    // Never create a row without the original (e.g. a translation whose source we have not seen).
    if (u.original === '') return
    const key = `${u.original}\u0000${u.translation}\u0000${u.isFinal}`
    if (this.lastEmitted.get(u.id) === key) return
    this.lastEmitted.delete(u.id)
    this.lastEmitted.set(u.id, key)
    while (this.lastEmitted.size > MAX_EMITTED) {
      const oldest = this.lastEmitted.keys().next().value as string
      this.lastEmitted.delete(oldest)
    }
    out.push(u)
  }

  private curHasOriginal(): boolean {
    return this.cur.finalOriginal !== '' || this.cur.partialOriginal !== ''
  }

  /** The closed segment a translation token should go to, or null for the open segment. */
  private lateTarget(): Closed | null {
    // Continue the segment already receiving tokens in this response (no boundary marker exists inside one).
    for (const c of this.awaiting) if (this.touched.has(c)) return c
    // Otherwise the oldest segment that has no translation yet.
    const waiting = this.awaiting.find((c) => c.translation === '' && c.partialTranslation === '')
    if (waiting) return waiting
    // All closed segments have translation: keep extending the newest one only while the open segment has no original.
    const last = this.awaiting[this.awaiting.length - 1]
    return last && !this.curHasOriginal() ? last : null
  }

  /** Feed the tokens of one response. Returns the utterances that changed, in order. */
  push(tokens: SonioxToken[]): Utterance[] {
    const out: Utterance[] = []
    this.cur.partialOriginal = ''
    this.cur.partialTranslation = ''
    for (const c of this.awaiting) c.partialTranslation = ''
    const touched = (this.touched = new Set<Closed>())

    for (const t of tokens) {
      if (t.text === FIN) continue
      if (t.text === END) {
        this.close(out)
        continue
      }
      const isTranslation = t.translation_status === 'translation'
      if (isTranslation) {
        const late = this.lateTarget()
        if (late) {
          if (t.is_final) late.translation += t.text
          else late.partialTranslation += t.text
          touched.add(late)
          continue
        }
        // Open segment's own translation: the closed segments are done.
        this.awaiting = []
        if (t.is_final) this.cur.finalTranslation += t.text
        else this.cur.partialTranslation += t.text
      } else if (t.is_final) {
        this.cur.finalOriginal += t.text
      } else {
        this.cur.partialOriginal += t.text
      }
    }

    for (const c of this.awaiting) {
      if (touched.has(c)) this.emit(out, this.utterance(c.id, c.original, (c.translation + c.partialTranslation).trim(), true))
    }
    this.emit(out, this.view(this.cur, false))
    return out
  }

  private close(out: Utterance[]): void {
    const u = this.view(this.cur, true)
    if (u.original === '') {
      // Nothing was said (or only an orphan translation): reuse the id.
      this.cur.finalTranslation = ''
      this.cur.partialOriginal = ''
      this.cur.partialTranslation = ''
      return
    }
    this.emit(out, u)
    this.awaiting.push({ id: u.id, original: u.original, translation: this.cur.finalTranslation, partialTranslation: this.cur.partialTranslation })
    while (this.awaiting.length > MAX_AWAITING) this.awaiting.shift()
    this.cur = this.fresh()
  }

  /** Close whatever is open as final (stop, reconnect, end of stream). */
  flush(): Utterance[] {
    const out: Utterance[] = []
    this.close(out)
    return out
  }
}
