/** Minimum length of the hero sentence; shorter tails are merged with the sentence before. */
export const MIN_HERO = 24

/** A sentence end. CJK enders need no space after them; the others need one and a start of a sentence (a capital, a digit, a quote, or a letter of a script without capitals). */
const BOUNDARY =
  /(?:[.!?…؟۔।]+[»"”’')\]]*\s+(?=[\p{Lu}\p{Lo}\p{Nd}"«“‘(\[¿¡])|[。！？]+[」』»"”’')\]）]*\s*(?=\S))/gu

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
    const punct = /^[.!?…؟۔।。！？]*/u.exec(m[0])![0]
    // Only a lone ASCII dot can belong to an abbreviation; "!", "?", "…" and "..." end the sentence.
    if (punct === '.' && isAbbreviation(src.slice(0, m.index))) continue
    starts.push(m.index + m[0].length)
  }
  return starts
}

/** Index in `starts` of the hero sentence: the last one, merged with earlier ones while it is shorter than MIN_HERO. */
function heroIndex(src: string, starts: number[]): number {
  let i = starts.length - 1
  while (i > 0 && src.length - starts[i] < MIN_HERO) i--
  return i
}

/** Splits the last sentence off `text`. head + ' ' + last equals the trimmed input apart from the join whitespace. */
export function splitLast(text: string): { head: string; last: string } {
  const src = text.trim()
  const starts = sentenceStarts(src)
  const i = heroIndex(src, starts)
  if (i === 0) return { head: '', last: src }
  return { head: src.slice(0, starts[i]).trim(), last: src.slice(starts[i]).trim() }
}

/** Number of sentences in `text` (0 when empty). */
export function countSentences(text: string): number {
  const src = text.trim()
  return src ? sentenceStarts(src).length : 0
}

/**
 * The original under the hero: the translation lags behind it, so drop as many leading original sentences as the translation head holds.
 * What remains is the hero's source plus whatever was said after it. Falls back to the last original sentence.
 */
export function originalForHero(translation: string, original: string): string {
  const src = original.trim()
  if (!src) return ''
  const skip = countSentences(splitLast(translation).head)
  if (skip === 0) return translation.trim() ? src : splitLast(src).last
  const starts = sentenceStarts(src)
  if (starts.length <= skip) return splitLast(src).last
  return src.slice(starts[skip]).trim()
}

/** What goes between two sentences: Chinese and Japanese put no space after a sentence. */
export const sentenceGap = (before: string): string => (/[。！？][」』»"”’')\]）]*$/u.test(before) ? '' : ' ')

const join = (a: string, b: string): string => (a && b ? `${a}${sentenceGap(a)}${b}` : a || b)

/** The whole text of one part of `paragraphParts`. */
export const paragraphText = ({ done, live }: { done: string; live: string }): string => join(done, live)

/** A paragraph is closed once it reaches this many characters. */
export const PARAGRAPH_CHARS = 160

/**
 * Groups sentences into paragraphs, greedily from the start: a paragraph takes sentences until it reaches
 * PARAGRAPH_CHARS. Earlier paragraphs stay the same while the text grows; only the last one changes.
 */
export function paragraphs(text: string): string[] {
  return paragraphParts(text).map(paragraphText)
}

/**
 * The same paragraphs as `paragraphs`, each split into `done` (sentences before the hero start) and `live`
 * (the sentences from the hero start on). A sentence moves from live to done inside one paragraph.
 */
export function paragraphParts(text: string): { done: string; live: string }[] {
  const src = text.trim()
  if (!src) return []
  const starts = sentenceStarts(src)
  const hero = heroIndex(src, starts)
  const out: { done: string; live: string }[] = []
  let done = ''
  let live = ''
  for (let i = 0; i < starts.length; i++) {
    const sentence = src.slice(starts[i], starts[i + 1]).trim()
    if (i >= hero) live = join(live, sentence)
    else done = join(done, sentence)
    if (join(done, live).length >= PARAGRAPH_CHARS) {
      out.push({ done, live })
      done = ''
      live = ''
    }
  }
  if (done || live) out.push({ done, live })
  return out
}
