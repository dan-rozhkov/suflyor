/**
 * Incremental parser for the line-based suggestion format:
 *   EN: <english reply>      (2-3 lines)
 *   RU: <russian meaning>    (may continue on following lines)
 * Chunks may split anywhere. The partial last line is reflected in the state while it streams.
 */
export interface ParsedSuggestion {
  options: string[]
  meaningRu: string
}

type Section = 'none' | 'en' | 'ru'

const MAX_OPTIONS = 3
const LINE_RE = /^\s*(?:[-*]\s*)?(EN|RU)\s*[:：]\s?(.*)$/i

export class SuggestionParser {
  private buffer = ''
  private options: string[] = []
  private ru: string[] = []
  private section: Section = 'none'

  /** Feed a chunk, get the full parsed state so far. */
  push(chunk: string): ParsedSuggestion {
    this.buffer += chunk
    let nl: number
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      this.commit(this.buffer.slice(0, nl))
      this.buffer = this.buffer.slice(nl + 1)
    }
    return this.snapshot(this.buffer)
  }

  /** Flush the trailing line without newline. */
  end(): ParsedSuggestion {
    if (this.buffer) {
      this.commit(this.buffer)
      this.buffer = ''
    }
    return this.snapshot('')
  }

  private commit(raw: string): void {
    const line = raw.replace(/\r$/, '')
    const m = LINE_RE.exec(line)
    if (m) {
      const text = m[2].trim()
      if (m[1].toUpperCase() === 'EN') {
        this.section = 'en'
        if (this.options.length < MAX_OPTIONS && text) this.options.push(clean(text))
      } else {
        this.section = 'ru'
        if (text) this.ru.push(text)
      }
    } else if (this.section === 'ru' && line.trim()) {
      this.ru.push(line.trim())
    }
  }

  private snapshot(pending: string): ParsedSuggestion {
    const options = [...this.options]
    const ru = [...this.ru]
    const m = LINE_RE.exec(pending)
    if (m) {
      const text = m[2].trim()
      if (m[1].toUpperCase() === 'EN') {
        if (options.length < MAX_OPTIONS && text) options.push(clean(text))
      } else if (text) ru.push(text)
    } else if (this.section === 'ru' && pending.trim()) {
      ru.push(pending.trim())
    }
    return { options, meaningRu: ru.join(' ') }
  }
}

/** Strip wrapping quotes models like to add. */
function clean(s: string): string {
  return s.replace(/^["“«]+|["”»]+$/g, '').trim()
}

/** Extract content deltas from a single SSE `data:` payload; reasoning fields are ignored. */
export function extractDelta(payload: string): string {
  try {
    const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: unknown } }> }
    const c = j.choices?.[0]?.delta?.content
    return typeof c === 'string' ? c : ''
  } catch {
    return ''
  }
}

/** Incremental SSE splitter: returns complete `data:` payloads. */
export class SseSplitter {
  private buf = ''
  push(chunk: string): string[] {
    this.buf += chunk
    const out: string[] = []
    let nl: number
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '')
      this.buf = this.buf.slice(nl + 1)
      if (line.startsWith('data:')) out.push(line.slice(5).trim())
    }
    return out
  }
}
