export interface Utterance {
  id: string
  /** English source text (may be partial while isFinal is false). */
  en: string
  /** Russian translation (may be partial). */
  ru: string
  isFinal: boolean
}

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
