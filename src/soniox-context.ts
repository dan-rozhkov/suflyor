/**
 * Builds the Soniox real-time `context` object from the user's markdown context file. Pure.
 *
 * Convention (headings case-insensitive, any level):
 * - `Call` / `General`: bullets `- key: value` -> general (max 8 pairs).
 * - `Terms` / `Glossary`: `- Nimbus` -> terms; `- manual tests = ручные тесты` (also `→`, `->`) -> terms + translation_terms.
 * - everything else -> text.
 *
 * Soniox caps context at 8,000 tokens in total and rejects the stream above that (400). We weigh ASCII chars as 1
 * and non-ASCII as 2 against a budget of 7,000 (below the cap, for margin). Priority: general, translation_terms, terms, text (text is cut).
 */

export interface SonioxContext {
  general?: { key: string; value: string }[]
  text?: string
  terms?: string[]
  translation_terms?: { source: string; target: string }[]
}

export const CONTEXT_BUDGET = 7000
const MAX_GENERAL = 8

export function weigh(s: string): number {
  let w = 0
  for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 127 ? 2 : 1
  return w
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/
const BULLET = /^\s*[-*+]\s+(.*\S)\s*$/
const SEP = /=>|->|→|==|=/

type Section = 'general' | 'terms' | 'other'

function sectionOf(title: string): Section {
  const t = title.trim().replace(/:$/, '').toLowerCase()
  if (t === 'call' || t === 'general') return 'general'
  if (t === 'terms' || t === 'glossary') return 'terms'
  return 'other'
}

function takeWithin<T>(items: T[], cost: (t: T) => number, budget: number): { kept: T[]; left: number } {
  const kept: T[] = []
  let left = budget
  for (const it of items) {
    const c = cost(it)
    if (c > left) break
    kept.push(it)
    left -= c
  }
  return { kept, left }
}

function cutText(text: string, budget: number): string {
  if (budget <= 0) return ''
  if (weigh(text) <= budget) return text
  let w = 0
  let end = 0
  while (end < text.length) {
    const c = text.charCodeAt(end) > 127 ? 2 : 1
    if (w + c > budget) break
    w += c
    end++
  }
  const head = text.slice(0, end)
  const nl = head.lastIndexOf('\n')
  if (nl > head.length / 2) return head.slice(0, nl).trim()
  const sp = head.search(/\s\S*$/)
  if (sp > 0) return head.slice(0, sp).trim()
  return head.trim()
}

export function buildSonioxContext(md: string): SonioxContext | undefined {
  if (!md || !md.trim()) return undefined
  let section: Section = 'other'
  const general: { key: string; value: string }[] = []
  const terms: string[] = []
  const translation: { source: string; target: string }[] = []
  const rest: string[] = []

  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    const h = HEADING.exec(line)
    if (h) {
      section = sectionOf(h[1])
      if (section === 'other') rest.push(line)
      continue
    }
    if (section === 'other') {
      rest.push(line)
      continue
    }
    const b = BULLET.exec(line)
    if (!b) {
      if (line.trim()) rest.push(line) // prose inside Call/Terms stays in the free text
      continue
    }
    const body = b[1].trim()
    if (section === 'general') {
      const i = body.indexOf(':')
      const key = i > 0 ? body.slice(0, i).trim() : ''
      const value = i > 0 ? body.slice(i + 1).trim() : ''
      if (key && value && general.length < MAX_GENERAL) general.push({ key, value })
      else rest.push(line)
    } else {
      const m = SEP.exec(body)
      if (!m) {
        terms.push(body)
        continue
      }
      const source = body.slice(0, m.index).trim()
      const target = body.slice(m.index + m[0].length).trim()
      if (!source) {
        rest.push(line)
        continue
      }
      terms.push(source)
      if (target) translation.push({ source, target })
    }
  }

  const uniqTerms = [...new Set(terms)]
  let left = CONTEXT_BUDGET
  const g = takeWithin(general, (x) => weigh(x.key) + weigh(x.value), left)
  left = g.left
  const tr = takeWithin(translation, (x) => weigh(x.source) + weigh(x.target), left)
  left = tr.left
  const tm = takeWithin(uniqTerms, (x) => weigh(x), left)
  left = tm.left
  const text = cutText(rest.join('\n').trim(), left)

  const out: SonioxContext = {}
  if (g.kept.length) out.general = g.kept
  if (text) out.text = text
  if (tm.kept.length) out.terms = tm.kept
  if (tr.kept.length) out.translation_terms = tr.kept
  return Object.keys(out).length ? out : undefined
}
