import { describe, expect, it } from 'vitest'
import { chapterLineIndex, initials, languagePair, lastTurns, lineText, rowSub } from './meetings-view'
import type { Meeting, MeetingLine } from './meetings'

const line = (at: number, over: Partial<MeetingLine> = {}): MeetingLine => ({
  at,
  original: 'Ciao',
  translation: '',
  originalLang: 'it',
  translationLang: null,
  ...over
})

describe('initials', () => {
  it('takes two letters', () => {
    expect(initials('Weekly planning sync')).toBe('WP')
    expect(initials('  one ')).toBe('O')
  })
  it('skips leading punctuation and handles other scripts', () => {
    expect(initials('"Quarterly" (review)')).toBe('QR')
    expect(initials('Созвон команды')).toBe('СК')
  })
  it('is empty for no letters', () => {
    expect(initials('')).toBe('')
    expect(initials('---')).toBe('')
  })
})

describe('languagePair', () => {
  it('shows the translation direction', () => {
    expect(languagePair({ callLanguage: 'it', language: 'en' })).toBe('Italian → English')
  })
  it('shows one language when nothing was translated', () => {
    expect(languagePair({ callLanguage: 'ru', language: 'ru' })).toBe('Russian')
  })
})

describe('rowSub', () => {
  const base = { callLanguage: 'it', language: 'en', durationMs: 32 * 60_000 } as Meeting
  it('joins language, length and open tasks', () => {
    const m = { ...base, actions: [{ id: 'a', task: 't', owner: '', done: false }, { id: 'b', task: 't', owner: '', done: true }] } as Meeting
    expect(rowSub(m)).toBe('Italian → English · 32m · 1 open')
  })
  it('leaves out the open count at zero', () => {
    expect(rowSub({ ...base, actions: [] } as Meeting)).toBe('Italian → English · 32m')
  })
})

describe('chapterLineIndex', () => {
  const lines = [line(0), line(5000), line(9000)]
  it('finds the first line at or after the chapter', () => {
    expect(chapterLineIndex(lines, { at: 5000, title: 'x' })).toBe(1)
    expect(chapterLineIndex(lines, { at: 5001, title: 'x' })).toBe(2)
  })
  it('falls back to the last line', () => {
    expect(chapterLineIndex(lines, { at: 99_000, title: 'x' })).toBe(2)
    expect(chapterLineIndex([], { at: 0, title: 'x' })).toBe(0)
  })
})

describe('lastTurns', () => {
  it('keeps the newest ten and cuts long text', () => {
    const turns = Array.from({ length: 12 }, (_, i) => ({ question: `q${i}`, answer: 'a'.repeat(5000) }))
    const out = lastTurns(turns)
    expect(out).toHaveLength(10)
    expect(out[0].question).toBe('q2')
    expect(out[0].answer).toHaveLength(4000)
  })
})

describe('lineText', () => {
  it('shows the translation with the original under it', () => {
    expect(lineText(line(0, { original: 'Ciao', translation: 'Hello', translationLang: 'en' }))).toEqual({ text: 'Hello', lang: 'en', original: 'Ciao' })
  })
  it('shows the original when there is no translation', () => {
    expect(lineText(line(0))).toEqual({ text: 'Ciao', lang: 'it', original: '' })
  })
})
