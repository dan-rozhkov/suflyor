export interface Utterance {
  id: string
  /** English source text (may be partial while isFinal is false). */
  en: string
  /** Russian translation (may be partial). */
  ru: string
  isFinal: boolean
}
