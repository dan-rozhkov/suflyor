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
  /** Short and concrete; the page shows it in bold. */
  task: string
  /** Why, how, a condition or a deadline, only as said on the call. May hold `**` marks around numbers. Absent in notes made before it existed. */
  details?: string
}

export interface SummaryTopic {
  title: string
  /** May hold `**` marks around key numbers. */
  bullets: string[]
}

/** The notes of one call, in the order the page shows them. The date and length come from the page, never from the model. */
export interface Summary {
  title: string
  /** Only people the transcript or the context named. Absent when none were named, and in notes made before it existed. */
  people?: string[]
  actionItems: SummaryAction[]
  /** May hold `**` marks around key numbers. */
  overview: string[]
  topics: SummaryTopic[]
}
