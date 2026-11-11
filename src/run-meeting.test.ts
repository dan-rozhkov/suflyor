import { describe, expect, it } from 'vitest'
import { buildMeeting, heardText } from './run-meeting'
import type { Utterance } from './types'

const u = (id: string, original: string, translation = '', translationLang: string | null = translation ? 'en' : null): Utterance => ({
  id,
  original,
  translation,
  originalLang: 'it',
  translationLang,
  isFinal: true
})

const START = new Date(2026, 10, 9, 14, 5).getTime()

describe('heardText', () => {
  it('is false for no text or blanks', () => {
    expect(heardText([])).toBe(false)
    expect(heardText([u('a', '  ')])).toBe(false)
  })
  it('is true for any text', () => {
    expect(heardText([u('a', ' ciao ')])).toBe(true)
  })
})

describe('buildMeeting', () => {
  const run = {
    utterances: [u('a', 'Buongiorno', 'Good morning'), u('b', '   '), u('c', 'Parliamo del piano')],
    stamps: new Map([
      ['a', [START + 4000, START + 9000]],
      ['c', [START + 61_000]]
    ]),
    chapters: [
      { key: { id: 'a', para: 0 }, title: 'Greeting', at: START + 4000 },
      { key: { id: 'z', para: 0 }, title: 'Old call', at: START - 5000 }
    ],
    startedAt: START,
    durationMs: 125_000,
    callLanguage: 'it',
    language: 'en',
    notes: 'Names: Ana'
  }

  it('keeps the heard lines with offsets from the start', () => {
    const m = buildMeeting(run, START + 130_000, 'm-test')
    expect(m.lines.map((l) => [l.at, l.original, l.translation])).toEqual([
      [4000, 'Buongiorno', 'Good morning'],
      [61_000, 'Parliamo del piano', '']
    ])
    expect(m.lines[0].translationLang).toBe('en')
    expect(m.lines[1].translationLang).toBeNull()
  })
  it('starts pending with the fallback title and no notes', () => {
    const m = buildMeeting(run, START + 130_000, 'm-test')
    expect(m.id).toBe('m-test')
    expect(m.title).toBe('Call at 14:05')
    expect(m.summaryState).toEqual({ status: 'pending' })
    expect(m.actions).toEqual([])
    expect(m.notes).toBe('Names: Ana')
    expect([m.callLanguage, m.language, m.durationMs]).toEqual(['it', 'en', 125_000])
  })
  it('drops chapters from earlier calls and turns the rest into offsets', () => {
    expect(buildMeeting(run, START, 'm').chapters).toEqual([{ at: 4000, title: 'Greeting' }])
  })
  it('puts a line without a stamp at zero', () => {
    const m = buildMeeting({ ...run, stamps: new Map() }, START, 'm')
    expect(m.lines.map((l) => l.at)).toEqual([0, 0])
  })
  it('makes an id when none is given', () => {
    expect(buildMeeting(run, START).id).toMatch(/^m-/)
  })
})
