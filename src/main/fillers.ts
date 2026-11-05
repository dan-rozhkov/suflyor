/**
 * Pure filler-word stripper for live transcripts (EN and RU). Whole words only, punctuation tidied.
 * Text without any filler is returned unchanged.
 */

const EN = 'u+m+|u+h+|e+r+m+|h+m+|m{2,}'
// A lone э is a filler only before punctuation or at the end ("Буква Э важна" stays).
const RU = 'э{2,}(?:-э+)*|э(?:-э+)+|э(?=-(?:\\s|$)|\\s*(?:[,.;:!?…]|$))|э+м+|м{2,}(?:-м+)*|м(?:-м+)+|х+м+|г+м+'
// \b does not work with Cyrillic: use unicode lookarounds. A hyphen or apostrophe next to the word means it is
// part of something else (uh-huh, mm-hmm, I'm).
const FILLER = new RegExp(`(?<![\\p{L}\\p{N}'’-])(?:${EN}|${RU})-?(?![\\p{L}\\p{N}'’-])`, 'giu')

const MARK = '\u0001'
const MARK_UP = '\u0002' // filler that started with an uppercase letter
const M = '[\\u0001\\u0002]'
const PUNCT = '[,;:]|[.!?…]+|[—–-]'
const OPENERS = /[(\[{"'“‘«]$/
const ONLY_OPENERS = /^[\s(\[{"'“‘«]*$/
// [pre punct][spaces] MARK(s) [spaces][post punct]
const RUN = new RegExp(`\\s*(${PUNCT})?\\s*${M}(?:[\\s,;:]*${M})*\\s*(${PUNCT})?\\s*`, 'gu')
const DASH = /^[—–-]$/
const TERMINAL = /[.!?…]$/

function upperFirst(s: string): string {
  const m = /^(\s*)(\p{L})/u.exec(s)
  if (!m) return s
  if (/^\p{Lu}/u.test(s.slice(m[0].length))) return s // iPhone, eBay
  return m[1] + m[2].toUpperCase() + s.slice(m[0].length)
}

export function stripFillers(text: string): string {
  let removed = false
  const marked = text.replace(FILLER, (m, offset: number, str: string) => {
    // "5 мм" / "10 mm": millimetres, not a hesitation.
    if (/^[mм]/i.test(m) && /\d\s*$/.test(str.slice(0, offset))) return m
    removed = true
    return /^\p{Lu}/u.test(m) ? MARK_UP : MARK
  })
  if (!removed) return text

  let out = ''
  let last = 0
  let capNext = false
  const push = (seg: string): void => {
    if (!seg) return
    out += capNext ? upperFirst(seg) : seg
    capNext = false
  }
  for (const m of marked.matchAll(RUN)) {
    const idx = m.index as number
    push(marked.slice(last, idx))
    last = idx + m[0].length
    const rest = marked.slice(last)
    const upper = m[0].includes(MARK_UP)
    if (out.trim() === '') {
      out = ''
      capNext = true
      continue
    }
    if (ONLY_OPENERS.test(out)) {
      capNext = upper
      continue
    }
    const pre = m[1] ?? ''
    const post = m[2] ?? ''
    let x = pre
    if (TERMINAL.test(pre)) x = pre
    else if (TERMINAL.test(post)) x = post
    if (!x && DASH.test(post)) x = post
    out += DASH.test(x) ? ' ' + x : x
    if (rest && !/^[,.;:!?…)\]}]/.test(rest) && !OPENERS.test(out)) out += ' '
    capNext = TERMINAL.test(x)
  }
  push(marked.slice(last))
  return out.replace(/ {2,}/g, ' ').trim()
}
