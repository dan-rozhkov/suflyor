/** Minimum length of the hero sentence; shorter tails are merged with the sentence before. */
export const MIN_HERO = 24

const BOUNDARY = /[.!?…]+[»"”’')\]]*\s+(?=[\p{Lu}\p{Nd}"«“‘(\[])/gu

const TITLES = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'vs', 'г', 'ул'])

/** True when the text before a lone dot ends in an abbreviation: dotted letters (т.е, т. е, U.S, e.g), an uppercase initial (J, А; not the word I) or a title. */
function isAbbreviation(before: string): boolean {
  if (/(?:^|[^\p{L}])(?:\p{L}\.\s?)+\p{L}$/u.test(before)) return true
  if (/(?:^|[^\p{L}])\p{Lu}$/u.test(before) && !/(?:^|[^\p{L}])I$/u.test(before)) return true
  const word = /\p{L}+$/u.exec(before)?.[0] ?? ''
  const pre = before.slice(0, before.length - word.length)
  return /(?:^|[^\p{L}\p{N}])$/u.test(pre) && TITLES.has(word.toLowerCase())
}

/** Start offsets of each sentence in trimmed text. */
function sentenceStarts(src: string): number[] {
  const starts: number[] = [0]
  for (const m of src.matchAll(BOUNDARY)) {
    const punct = /^[.!?…]+/u.exec(m[0])![0]
    // Only a lone dot can belong to an abbreviation; "!", "?", "…" and "..." end the sentence.
    if (punct === '.' && isAbbreviation(src.slice(0, m.index))) continue
    starts.push(m.index + m[0].length)
  }
  return starts
}

/** Splits the last sentence off `text`. head + ' ' + last equals the trimmed input apart from the join whitespace. */
export function splitLast(text: string): { head: string; last: string } {
  const src = text.trim()
  const starts = sentenceStarts(src)
  let i = starts.length - 1
  while (i > 0 && src.length - starts[i] < MIN_HERO) i--
  if (i === 0) return { head: '', last: src }
  return { head: src.slice(0, starts[i]).trim(), last: src.slice(starts[i]).trim() }
}

/** Number of sentences in `text` (0 when empty). */
export function countSentences(text: string): number {
  const src = text.trim()
  return src ? sentenceStarts(src).length : 0
}

/**
 * English under the hero: Russian lags behind English, so drop as many leading English sentences as the Russian head holds.
 * What remains is the hero's source plus whatever was said after it. Falls back to the last English sentence.
 */
export function englishForHero(ru: string, en: string): string {
  const src = en.trim()
  if (!src) return ''
  const skip = countSentences(splitLast(ru).head)
  if (skip === 0) return ru.trim() ? src : splitLast(src).last
  const starts = sentenceStarts(src)
  if (starts.length <= skip) return splitLast(src).last
  return src.slice(starts[skip]).trim()
}

/** A paragraph is closed once it reaches this many characters. */
export const PARAGRAPH_CHARS = 160

/**
 * Groups sentences into paragraphs, greedily from the start: a paragraph takes sentences until it reaches
 * PARAGRAPH_CHARS. Earlier paragraphs stay the same while the text grows; only the last one changes.
 */
export function paragraphs(text: string): string[] {
  const src = text.trim()
  if (!src) return []
  const starts = sentenceStarts(src)
  const out: string[] = []
  let current = ''
  for (let i = 0; i < starts.length; i++) {
    const sentence = src.slice(starts[i], starts[i + 1]).trim()
    current = current ? `${current} ${sentence}` : sentence
    if (current.length >= PARAGRAPH_CHARS) {
      out.push(current)
      current = ''
    }
  }
  if (current) out.push(current)
  return out
}
