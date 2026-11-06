import { describe, expect, it } from 'vitest'
import { buildTranscript, transcriptFileName } from './transcript'
import type { Utterance } from './types'

const u = (id: string, en: string, ru: string): Utterance => ({ id, en, ru, isFinal: true })
const clock = (ms: number): string => `t${ms}`
const base = { chapters: [], clock, savedAt: '6 Nov, 19:30' }

describe('buildTranscript', () => {
  it('starts with the title and the save label', () => {
    const text = buildTranscript({ ...base, utterances: [], stamps: new Map() })
    expect(text).toBe('# Call transcript\n\nSaved 6 Nov, 19:30\n')
  })

  it('puts times on paragraphs and the English quote after them', () => {
    const ru = `${'Первое предложение идёт тут и оно довольно длинное для абзаца, '.repeat(3)}конец. Третье начинает новый абзац.`
    const text = buildTranscript({
      ...base,
      utterances: [u('a', 'First.\nSecond.', ru)],
      stamps: new Map([['a', [1, 2]]])
    })
    expect(text).toContain('**t1** Первое предложение')
    expect(text).toContain('**t2** Третье начинает новый абзац.')
    expect(text).toContain('\n\n> First. Second.\n')
    expect(text.indexOf('**t2**')).toBeLessThan(text.indexOf('> First.'))
  })

  it('places a chapter heading before the paragraph it starts', () => {
    const text = buildTranscript({
      ...base,
      chapters: [{ key: { id: 'b', para: 0 }, title: 'Бюджет', at: 5 }],
      utterances: [u('a', 'One.', 'Один.'), u('b', 'Two.', 'Два.')],
      stamps: new Map([['a', [1]], ['b', [2]]])
    })
    expect(text.indexOf('**t1** Один.')).toBeLessThan(text.indexOf('## Бюджет'))
    expect(text.indexOf('## Бюджет')).toBeLessThan(text.indexOf('**t2** Два.'))
  })

  it('shows only the quote, with the first time, when ru is empty', () => {
    const text = buildTranscript({ ...base, utterances: [u('a', 'Hello there', '')], stamps: new Map([['a', [7]]]) })
    expect(text).toContain('**t7**\n> Hello there')
  })

  it('shows no quote when en is empty and skips an empty utterance', () => {
    const text = buildTranscript({
      ...base,
      utterances: [u('a', '', 'Только русский.'), u('b', '  ', ' ')],
      stamps: new Map([['a', [3]]])
    })
    expect(text).toContain('**t3** Только русский.')
    expect(text).not.toContain('>')
    expect(text.match(/\*\*/g)).toHaveLength(2)
  })

  it('leaves out the time when there is no stamp', () => {
    const text = buildTranscript({ ...base, utterances: [u('a', 'Hi', 'Привет.')], stamps: new Map() })
    expect(text).toContain('\n\nПривет.\n\n> Hi\n')
    expect(text).not.toContain('**')
  })
})

describe('transcriptFileName', () => {
  it('uses local date and time', () => {
    expect(transcriptFileName(new Date(2026, 10, 6, 19, 11, 5))).toBe('suflyor-transcript-2026-11-06-1911.md')
    expect(transcriptFileName(new Date(2026, 0, 2, 3, 4))).toBe('suflyor-transcript-2026-01-02-0304.md')
  })
})
