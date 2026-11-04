/**
 * Pure assembler: Soniox real-time tokens -> utterances. No I/O.
 *
 * Protocol facts (docs.soniox.com):
 * - Each response carries `tokens`. Final tokens (is_final) arrive once and are permanent. Non-final tokens are
 *   resent in full with every response, so they replace the previous non-final set.
 * - With translation, `translation_status` is 'original' (spoken text), 'translation' (target language) or 'none'.
 * - With endpoint detection a `<end>` token (always final) closes the segment. `<fin>` answers a manual finalize.
 */
import type { Utterance } from '../shared/types'

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
  finalEn: string
  finalRu: string
  partialEn: string
  partialRu: string
}

/** A segment closed by <end> whose translation may still be arriving. */
interface Closed {
  id: string
  en: string
  ru: string
  partialRu: string
}

const MAX_AWAITING = 3
const MAX_EMITTED = 200

/**
 * Translation lags the source: Soniox streams the Russian tokens of segment N after its <end>, possibly after
 * the English of segment N+1 has started. Closed segments are kept in an ordered queue; Russian tokens go to the
 * oldest one that is still waiting (no Russian yet), or to the head while the open segment has no English.
 * Otherwise they belong to the open segment and the head is retired.
 */
export class TokenAssembler {
  private seq = 0
  private cur: Open
  private awaiting: Closed[] = []
  private lastEmitted = new Map<string, string>()
  /** Closed segments that got Russian tokens in the response being processed. */
  private touched = new Set<Closed>()

  constructor(private readonly idPrefix = 'u') {
    this.cur = this.fresh()
  }

  private fresh(): Open {
    this.seq += 1
    return { id: `${this.idPrefix}${this.seq}`, finalEn: '', finalRu: '', partialEn: '', partialRu: '' }
  }

  private view(o: Open, isFinal: boolean): Utterance {
    return { id: o.id, en: (o.finalEn + o.partialEn).trim(), ru: (o.finalRu + o.partialRu).trim(), isFinal }
  }

  private emit(out: Utterance[], u: Utterance): void {
    // Never create a row without English (e.g. a translation whose source we have not seen).
    if (u.en === '') return
    const key = `${u.en}\u0000${u.ru}\u0000${u.isFinal}`
    if (this.lastEmitted.get(u.id) === key) return
    this.lastEmitted.delete(u.id)
    this.lastEmitted.set(u.id, key)
    while (this.lastEmitted.size > MAX_EMITTED) {
      const oldest = this.lastEmitted.keys().next().value as string
      this.lastEmitted.delete(oldest)
    }
    out.push(u)
  }

  private curHasEn(): boolean {
    return this.cur.finalEn !== '' || this.cur.partialEn !== ''
  }

  /** The closed segment a Russian token should go to, or null for the open segment. */
  private lateTarget(): Closed | null {
    // Continue the segment already receiving tokens in this response (no boundary marker exists inside one).
    for (const c of this.awaiting) if (this.touched.has(c)) return c
    // Otherwise the oldest segment that has no translation yet.
    const waiting = this.awaiting.find((c) => c.ru === '' && c.partialRu === '')
    if (waiting) return waiting
    // All closed segments have Russian: keep extending the newest one only while the open segment has no English.
    const last = this.awaiting[this.awaiting.length - 1]
    return last && !this.curHasEn() ? last : null
  }

  /** Feed the tokens of one response. Returns the utterances that changed, in order. */
  push(tokens: SonioxToken[]): Utterance[] {
    const out: Utterance[] = []
    this.cur.partialEn = ''
    this.cur.partialRu = ''
    for (const c of this.awaiting) c.partialRu = ''
    const touched = (this.touched = new Set<Closed>())

    for (const t of tokens) {
      if (t.text === FIN) continue
      if (t.text === END) {
        this.close(out)
        continue
      }
      const isRu = t.translation_status === 'translation'
      if (isRu) {
        const late = this.lateTarget()
        if (late) {
          if (t.is_final) late.ru += t.text
          else late.partialRu += t.text
          touched.add(late)
          continue
        }
        // Open segment's own translation: the closed segments are done.
        this.awaiting = []
        if (t.is_final) this.cur.finalRu += t.text
        else this.cur.partialRu += t.text
      } else if (t.is_final) {
        this.cur.finalEn += t.text
      } else {
        this.cur.partialEn += t.text
      }
    }

    for (const c of this.awaiting) {
      if (touched.has(c)) this.emit(out, { id: c.id, en: c.en, ru: (c.ru + c.partialRu).trim(), isFinal: true })
    }
    this.emit(out, this.view(this.cur, false))
    return out
  }

  private close(out: Utterance[]): void {
    const u = this.view(this.cur, true)
    if (u.en === '') {
      // Nothing was said (or only an orphan translation): reuse the id.
      this.cur.finalRu = ''
      this.cur.partialEn = ''
      this.cur.partialRu = ''
      return
    }
    this.emit(out, u)
    this.awaiting.push({ id: u.id, en: u.en, ru: this.cur.finalRu, partialRu: this.cur.partialRu })
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
