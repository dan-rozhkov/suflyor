import { describe, expect, it } from 'vitest'
import { TokenAssembler, type SonioxToken } from './soniox-assembler'

const o = (text: string, is_final = false): SonioxToken => ({ text, is_final, translation_status: 'original' })
const tr = (text: string, is_final = false): SonioxToken => ({ text, is_final, translation_status: 'translation' })
const end: SonioxToken = { text: '<end>', is_final: true }

describe('TokenAssembler', () => {
  it('updates a partial in place, then finalizes', () => {
    const a = new TokenAssembler()
    expect(a.push([o('Hel')])).toEqual([{ id: 'u1', en: 'Hel', ru: '', isFinal: false }])
    // non-final tokens are resent in full and replace the previous ones
    expect(a.push([o('Hello'), o(' wor')])).toEqual([{ id: 'u1', en: 'Hello wor', ru: '', isFinal: false }])
    const r = a.push([o('Hello', true), o(' world', true), end])
    expect(r.at(-1)).toEqual({ id: 'u1', en: 'Hello world', ru: '', isFinal: true })
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
    expect(r.at(-1)).toEqual({ id: 'u1', en: 'Good morning', ru: 'Доброе утро', isFinal: false })
    const f = a.push([tr('Доброе', true), tr(' утро', true), end])
    expect(f.at(-1)).toEqual({ id: 'u1', en: 'Good morning', ru: 'Доброе утро', isFinal: true })
  })

  it('splits utterances at <end> inside one response', () => {
    const a = new TokenAssembler()
    const r = a.push([o('One.', true), tr('Раз.', true), end, o(' Two', false)])
    expect(r).toEqual([
      { id: 'u1', en: 'One.', ru: 'Раз.', isFinal: true },
      { id: 'u2', en: 'Two', ru: '', isFinal: false }
    ])
  })

  it('attaches a late final translation to the closed utterance', () => {
    const a = new TokenAssembler()
    a.push([o('Ready?', true), end])
    const r = a.push([tr('Готовы?', true)])
    expect(r).toEqual([{ id: 'u1', en: 'Ready?', ru: 'Готовы?', isFinal: true }])
  })

  it('ignores <fin> and empty segments', () => {
    const a = new TokenAssembler()
    expect(a.push([{ text: '<fin>', is_final: true }, end])).toEqual([])
    expect(a.push([o('Hi')])[0].id).toBe('u1')
  })

  it('flush closes an open utterance as final', () => {
    const a = new TokenAssembler()
    a.push([o('Hel', true), o('lo')])
    expect(a.flush()).toEqual([{ id: 'u1', en: 'Hello', ru: '', isFinal: true }])
    expect(a.flush()).toEqual([])
  })

  it('a late partial translation after <end> updates the closed utterance, never makes an empty-English row', () => {
    const a = new TokenAssembler()
    a.push([o('Ready?', true), end])
    const r = a.push([tr('Гот'), tr('овы')])
    expect(r).toEqual([{ id: 'u1', en: 'Ready?', ru: 'Готовы', isFinal: true }])
    expect(r.every((u) => u.en !== '')).toBe(true)
    // partial replaced, then finalized
    expect(a.push([tr('Готовы?', true)])).toEqual([{ id: 'u1', en: 'Ready?', ru: 'Готовы?', isFinal: true }])
  })

  it('a late final Russian token is not glued onto the next utterance whose English already arrived', () => {
    const a = new TokenAssembler()
    a.push([o('First.', true), end])
    // next segment English arrives before the first translation
    const r1 = a.push([o('Second', false)])
    expect(r1).toEqual([{ id: 'u2', en: 'Second', ru: '', isFinal: false }])
    const r2 = a.push([tr('Первое', true), tr('.', true), o('Second', false)])
    expect(r2).toContainEqual({ id: 'u1', en: 'First.', ru: 'Первое.', isFinal: true })
    expect(r2.find((u) => u.id === 'u2')).toBeUndefined() // u2 unchanged, no Russian glued
  })

  it('keeps an ordered queue of segments awaiting translation', () => {
    const a = new TokenAssembler()
    a.push([o('One.', true), end, o('Two.', true), end, o('Three', false)])
    const r1 = a.push([tr('Раз.', true)])
    expect(r1).toEqual([{ id: 'u1', en: 'One.', ru: 'Раз.', isFinal: true }])
    const r2 = a.push([tr('Два.', true)])
    expect(r2).toEqual([{ id: 'u2', en: 'Two.', ru: 'Два.', isFinal: true }])
    // both closed segments translated: the next Russian belongs to the open segment (it has English)
    const r3 = a.push([o('Three', false), tr('Три', true)])
    expect(r3.at(-1)).toEqual({ id: 'u3', en: 'Three', ru: 'Три', isFinal: false })
  })

  it('open segment translation still works after earlier segments closed', () => {
    const a = new TokenAssembler()
    a.push([o('A.', true), tr('А.', true), end])
    const r = a.push([o('B', true), tr('Б', true)])
    expect(r.at(-1)).toEqual({ id: 'u2', en: 'B', ru: 'Б', isFinal: false })
  })

  it('bounds memory over many utterances', () => {
    const a = new TokenAssembler()
    for (let i = 0; i < 500; i++) a.push([o(`w${i}`, true), tr(`р${i}`, true), end])
    expect(a.push([o('x')])[0].id).toBe('u501')
  })
})
