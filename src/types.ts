export interface Utterance {
  id: string
  /** What was said (may be partial while isFinal is false). */
  original: string
  /** The translation (may be partial). Stays empty when translation is off. */
  translation: string
  /** The language set for the original when this was heard. */
  originalLang: string
  /** The language of the translation, or null when translation was off. Set per utterance: the settings can change between calls. */
  translationLang: string | null
  isFinal: boolean
}

/** The text the feed shows for an utterance. */
export const shownText = (u: Utterance): string => (u.translationLang ? u.translation : u.original)

/** The language of that text. */
export const shownLang = (u: Utterance): string => u.translationLang ?? u.originalLang

export interface SummaryAction {
  /** Empty when the call did not name anyone. */
  owner: string
  task: string
}

export interface SummaryTopic {
  title: string
  bullets: string[]
}

/** The notes of one call, in the order the page shows them. */
export interface Summary {
  title: string
  actionItems: SummaryAction[]
  overview: string[]
  topics: SummaryTopic[]
}
