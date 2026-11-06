import { describe, expect, it } from 'vitest'
import { TokenAssembler, type SonioxToken } from './soniox-assembler'

const o = (text: string, is_final = false): SonioxToken => ({ text, is_final, translation_status: 'original' })
const tr = (text: string, is_final = false): SonioxToken => ({ text, is_final, translation_status: 'translation' })
const utt = (id: string, original: string, translation: string, isFinal: boolean) => ({
  id,
  original,
  translation,
  originalLang: 'en',
  translationLang: 'ru',
  isFinal
})
const end: SonioxToken = { text: '<end>', is_final: true }

describe('TokenAssembler', () => {
  it('updates a partial in place, then finalizes', () => {
    const a = new TokenAssembler()
    expect(a.push([o('Hel')])).toEqual([utt('u1', 'Hel', '', false)])
    // non-final tokens are resent in full and replace the previous ones
    expect(a.push([o('Hello'), o(' wor')])).toEqual([utt('u1', 'Hello wor', '', false)])
    const r = a.push([o('Hello', true), o(' world', true), end])
    expect(r.at(-1)).toEqual(utt('u1', 'Hello world', '', true))
  })

  it('does not re-emit identical state', () => {
    const a = new TokenAssembler()
    a.push([o('Hi')])
    expect(a.push([o('Hi')])).toEqual([])
  })

  it('handles the translation arriving after the original', () => {
    const a = new TokenAssembler()
    a.push([o('Good', true), o(' morning')])
    const r = a.push([o(' morning', true), tr('Доброе'), tr(' утро')])
    expect(r.at(-1)).toEqual(utt('u1', 'Good morning', 'Доброе утро', false))
    const f = a.push([tr('Доброе', true), tr(' утро', true), end])
    expect(f.at(-1)).toEqual(utt('u1', 'Good morning', 'Доброе утро', true))
  })

  it('splits utterances at <end> inside one response', () => {
    const a = new TokenAssembler()
    const r = a.push([o('One.', true), tr('Раз.', true), end, o(' Two', false)])
    expect(r).toEqual([
      utt('u1', 'One.', 'Раз.', true),
      utt('u2', 'Two', '', false)
    ])
  })

  it('attaches a late final translation to the closed utterance', () => {
    const a = new TokenAssembler()
    a.push([o('Ready?', true), end])
    const r = a.push([tr('Готовы?', true)])
    expect(r).toEqual([utt('u1', 'Ready?', 'Готовы?', true)])
  })

  it('ignores <fin> and empty segments', () => {
    const a = new TokenAssembler()
    expect(a.push([{ text: '<fin>', is_final: true }, end])).toEqual([])
    expect(a.push([o('Hi')])[0].id).toBe('u1')
  })

  it('flush closes an open utterance as final', () => {
    const a = new TokenAssembler()
    a.push([o('Hel', true), o('lo')])
    expect(a.flush()).toEqual([utt('u1', 'Hello', '', true)])
    expect(a.flush()).toEqual([])
  })

  it('a late partial translation after <end> updates the closed utterance, never makes a row without the original', () => {
    const a = new TokenAssembler()
    a.push([o('Ready?', true), end])
    const r = a.push([tr('Гот'), tr('овы')])
    expect(r).toEqual([utt('u1', 'Ready?', 'Готовы', true)])
    expect(r.every((u) => u.original !== '')).toBe(true)
    // partial replaced, then finalized
    expect(a.push([tr('Готовы?', true)])).toEqual([utt('u1', 'Ready?', 'Готовы?', true)])
  })

  it('a late final translation token is not glued onto the next utterance whose original already arrived', () => {
    const a = new TokenAssembler()
    a.push([o('First.', true), end])
    // next segment English arrives before the first translation
    const r1 = a.push([o('Second', false)])
    expect(r1).toEqual([utt('u2', 'Second', '', false)])
    const r2 = a.push([tr('Первое', true), tr('.', true), o('Second', false)])
    expect(r2).toContainEqual(utt('u1', 'First.', 'Первое.', true))
    expect(r2.find((u) => u.id === 'u2')).toBeUndefined() // u2 unchanged, no translation glued
  })

  it('keeps an ordered queue of segments awaiting translation', () => {
    const a = new TokenAssembler()
    a.push([o('One.', true), end, o('Two.', true), end, o('Three', false)])
    const r1 = a.push([tr('Раз.', true)])
    expect(r1).toEqual([utt('u1', 'One.', 'Раз.', true)])
    const r2 = a.push([tr('Два.', true)])
    expect(r2).toEqual([utt('u2', 'Two.', 'Два.', true)])
    // both closed segments translated: the next Russian belongs to the open segment (it has an original)
    const r3 = a.push([o('Three', false), tr('Три', true)])
    expect(r3.at(-1)).toEqual(utt('u3', 'Three', 'Три', false))
  })

  it('open segment translation still works after earlier segments closed', () => {
    const a = new TokenAssembler()
    a.push([o('A.', true), tr('А.', true), end])
    const r = a.push([o('B', true), tr('Б', true)])
    expect(r.at(-1)).toEqual(utt('u2', 'B', 'Б', false))
  })

  it('bounds memory over many utterances', () => {
    const a = new TokenAssembler()
    for (let i = 0; i < 500; i++) a.push([o(`w${i}`, true), tr(`р${i}`, true), end])
    expect(a.push([o('x')])[0].id).toBe('u501')
  })

  it('stamps utterances with the given languages', () => {
    const a = new TokenAssembler('u', { source: 'de', target: 'ja' })
    expect(a.push([o('Hallo')])[0]).toMatchObject({ originalLang: 'de', translationLang: 'ja' })
  })

  it('works without translation tokens and leaves translationLang null', () => {
    const a = new TokenAssembler('u', { source: 'fr', target: null })
    expect(a.push([{ text: 'Bonjour', is_final: true }, end])).toEqual([
      { id: 'u1', original: 'Bonjour', translation: '', originalLang: 'fr', translationLang: null, isFinal: true }
    ])
  })
})
