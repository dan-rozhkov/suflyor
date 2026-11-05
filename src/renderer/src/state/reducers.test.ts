import { describe, expect, it } from 'vitest'
import type { AppError, SessionStatus, Suggestion } from '@shared/types'
import { errorAfterStatus, isExpectedFile, MAX_UTTERANCES, staleAfter, upsertUtterance } from './reducers'

describe('upsertUtterance', () => {
  it('appends new ids and updates existing in place', () => {
    let l = upsertUtterance([], { id: 'a', en: 'He', ru: '', isFinal: false })
    l = upsertUtterance(l, { id: 'b', en: 'x', ru: 'y', isFinal: true })
    l = upsertUtterance(l, { id: 'a', en: 'Hello', ru: 'Привет', isFinal: true })
    expect(l.map((u) => u.id)).toEqual(['a', 'b'])
    expect(l[0].ru).toBe('Привет')
  })
})

describe('upsertUtterance cap', () => {
  it('keeps only the last 300 and still updates the tail in place', () => {
    let l: ReturnType<typeof upsertUtterance> = []
    for (let i = 0; i < 350; i++) l = upsertUtterance(l, { id: `u${i}`, en: 'x', ru: '', isFinal: true })
    expect(l).toHaveLength(MAX_UTTERANCES)
    expect(l[0].id).toBe('u50')
    l = upsertUtterance(l, { id: 'u349', en: 'y', ru: '', isFinal: true })
    expect(l).toHaveLength(MAX_UTTERANCES)
    expect(l.at(-1)?.en).toBe('y')
  })
})

describe('isExpectedFile', () => {
  it('accepts md only', () => {
    expect(isExpectedFile('a.MD')).toBe(true)
    expect(isExpectedFile('a.txt')).toBe(false)
  })
})

describe('staleAfter', () => {
  const s: Suggestion = { id: 's', utteranceId: 'a', trigger: 'auto', status: 'done', options: ['x'], meaningRu: '' }
  const u = (id: string, isFinal: boolean) => ({ id, en: 'e', ru: 'r', isFinal })
  it('drops replies once a newer line is final', () => expect(staleAfter(s, u('b', true))).toBeNull())
  it('keeps replies during partials and updates to the same line', () => {
    expect(staleAfter(s, u('b', false))).toBe(s)
    expect(staleAfter(s, u('a', true))).toBe(s)
  })
  it('keeps a streaming request', () => {
    const live: Suggestion = { ...s, status: 'streaming' }
    expect(staleAfter(live, u('b', true))).toBe(live)
  })
})

describe('errorAfterStatus', () => {
  const st = (state: SessionStatus['state']): SessionStatus => ({ state, demo: false })
  const err = (code: AppError['code']): AppError => ({ code, message: 'm' })
  it('listening clears session errors but keeps mic notices', () => {
    expect(errorAfterStatus(err('network'), st('listening'))).toBeNull()
    expect(errorAfterStatus(err('mic'), st('listening'))?.code).toBe('mic')
    expect(errorAfterStatus(err('no-mic-permission'), st('listening'))?.code).toBe('no-mic-permission')
    expect(errorAfterStatus(err('network'), st('starting'))?.code).toBe('network')
    expect(errorAfterStatus(null, st('listening'))).toBeNull()
  })
})
