import { describe, expect, it } from 'vitest'
import type { Utterance } from '../shared/types'
import { createConversation, ECHO_WINDOW_MS, isEcho, MAX_TURNS } from './conversation'

const u = (id: string, en: string, isFinal = true, ru = ''): Utterance => ({ id, en, ru, isFinal })

describe('isEcho', () => {
  const THEM = 'I think this is what you want, yes, and I can do it if you are happy with that'
  it('ignores case and punctuation', () => {
    expect(isEcho('Can you send the report, please?', ['can you send the REPORT please'])).toBe(true)
  })
  it('real replies that share words with them are not echoes', () => {
    for (const mine of ['Yes, I think so.', 'Yes.', 'I can do that.', 'Sure, what do you want?']) {
      expect(isEcho(mine, [THEM])).toBe(false)
    }
    expect(isEcho('Yes, we can ship Thursday', ['Can we ship Thursday?'])).toBe(false)
  })
  it('a near-identical long utterance with one word changed is an echo', () => {
    const them = 'we will ship the new build to the staging server on friday morning'
    expect(isEcho('we will ship the new build to the staging server on monday morning', [them])).toBe(true)
    expect(isEcho('we will ship the new build to the staging server on friday morning', [them])).toBe(true)
  })
  it('a different sentence with scattered shared words is not an echo', () => {
    expect(isEcho('the build on friday will ship to the new server', ['we will ship the new build to the staging server on friday morning'])).toBe(false)
  })
  it('under 4 words: echo only when it equals a whole recent utterance', () => {
    expect(isEcho('Thank you.', ['thank you'])).toBe(true)
    expect(isEcho('Thank you', ['Thank you very much for joining'])).toBe(false)
  })
  it('matches runs across the joined recent texts, in order', () => {
    expect(isEcho('and then we can start', ['first we say hello and then', 'we can start the review'])).toBe(true)
  })
  it('is false for empty input on either side', () => {
    expect(isEcho('', ['hello'])).toBe(false)
    expect(isEcho('...', ['hello'])).toBe(false)
    expect(isEcho('hello', [])).toBe(false)
  })
})

describe('conversation', () => {
  it('lists turns in order of first sight with speaker set, then their partial last', () => {
    const c = createConversation()
    c.addThem(u('t1', 'How is the project going?'))
    c.addMe(u('m1', 'It is going well, we shipped the form.'))
    c.addThem(u('t2', 'Great. And the', false))
    const l = c.list()
    expect(l.map((x) => [x.id, x.speaker, x.isFinal])).toEqual([
      ['t1', 'them', true],
      ['m1', 'me', true],
      ['t2', 'them', false]
    ])
  })

  it('a late translation update replaces in place and does not reorder', () => {
    const c = createConversation()
    c.addThem(u('t1', 'First line here'))
    c.addMe(u('m1', 'my answer to that'))
    c.addThem(u('t1', 'First line here', true, 'Первая строка'))
    expect(c.list().map((x) => x.id)).toEqual(['t1', 'm1'])
    expect(c.list()[0].ru).toBe('Первая строка')
  })

  it('a final replaces the partial with the same id', () => {
    const c = createConversation()
    c.addThem(u('t1', 'Hello the', false))
    c.addThem(u('t1', 'Hello there', true))
    expect(c.list().map((x) => [x.id, x.en, x.isFinal])).toEqual([['t1', 'Hello there', true]])
  })

  it('does not store mic partials', () => {
    const c = createConversation()
    expect(c.addMe(u('m1', 'half a sentence', false))).toBe(true)
    expect(c.list()).toEqual([])
  })

  it('keeps the last 40 turns and does not resurrect evicted ids', () => {
    const c = createConversation()
    for (let i = 0; i < MAX_TURNS + 5; i++) c.addThem(u(`t${i}`, `line number ${i} here`))
    const l = c.list()
    expect(l).toHaveLength(MAX_TURNS)
    expect(l[0].id).toBe('t5')
    c.addThem(u('t0', 'line number 0 here', true, 'late'))
    expect(c.list()).toHaveLength(MAX_TURNS)
    expect(c.list()[0].id).toBe('t5')
  })

  it('drops an echo entirely: not added, reported as dropped', () => {
    let t = 1000
    const c = createConversation({ now: () => t })
    c.addThem(u('t1', 'Could you send me the contract today?'))
    t += 2000
    expect(c.addMe(u('m1', 'could you send me the contract today', true))).toBe(false)
    expect(c.list().map((x) => x.id)).toEqual(['t1'])
  })

  it('checks the echo against their current partial too (mic can finalize first)', () => {
    const c = createConversation()
    c.addThem(u('t1', 'Could you send me the', false))
    expect(c.addMe(u('m1', 'could you send me the', true))).toBe(false)
    expect(c.list().map((x) => x.id)).toEqual(['t1'])
  })

  it('only counts what they said in the last 15 s', () => {
    let t = 0
    const c = createConversation({ now: () => t })
    c.addThem(u('t1', 'Could you send me the contract today?'))
    t += ECHO_WINDOW_MS + 1
    expect(c.recentThem()).toEqual([])
    expect(c.addMe(u('m1', 'Could you send me the contract today?'))).toBe(true)
  })

  it('a late translation does not refresh the echo window', () => {
    let t = 0
    const c = createConversation({ now: () => t })
    c.addThem(u('t1', 'Could you send me the contract today?'))
    t += ECHO_WINDOW_MS + 1
    c.addThem(u('t1', 'Could you send me the contract today?', true, 'перевод'))
    expect(c.recentThem()).toEqual([])
  })

  it('window counts from when the mic utterance started: a 30 s monologue over three segments is an echo', () => {
    let t = 0
    const c = createConversation({ now: () => t })
    c.addMe(u('m1', 'welcome everyone to the', false)) // mic starts at 0, echo of t1 partial
    c.addThem(u('t1', 'welcome everyone to the weekly planning call today', true))
    t = 10_000
    c.addThem(u('t2', 'first we will go through the open tickets from last week', true))
    t = 20_000
    c.addThem(u('t3', 'and then we will talk about the release plan for march', true))
    t = 30_000
    const whole =
      'welcome everyone to the weekly planning call today first we will go through the open tickets from last week and then we will talk about the release plan for march'
    expect(c.addMe(u('m1', whole, true))).toBe(false)
    expect(c.list().every((x) => x.speaker === 'them')).toBe(true)
  })

  it('them text older than 15 s before the mic started does not count', () => {
    let t = 0
    const c = createConversation({ now: () => t })
    c.addThem(u('t1', 'Could you send me the contract today please', true))
    t = 16_000
    expect(c.addMe(u('m1', 'Could you send me the contract today please', true))).toBe(true)
  })

  it('orders by first sight: a mic final after their answer keeps the question first', () => {
    const c = createConversation()
    c.addMe(u('m1', 'Can you do Friday', false))
    c.addThem(u('t1', 'Yes.', false))
    c.addThem(u('t1', 'Yes.', true))
    c.addMe(u('m1', 'Can you do Friday?', true))
    expect(c.list().map((x) => `${x.speaker}:${x.en}`)).toEqual(['me:Can you do Friday?', 'them:Yes.'])
    c.addMe(u('m1', 'Can you do Friday?', true)) // late update never reorders
    expect(c.list().map((x) => x.id)).toEqual(['m1', 't1'])
  })

  it('an echo-dropped mic partial leaves no trace', () => {
    const c = createConversation()
    c.addThem(u('t1', 'Could you send me the contract today', false))
    expect(c.addMe(u('m1', 'could you send me the contract', false))).toBe(false)
    c.addThem(u('t1', 'Could you send me the contract today', true))
    expect(c.list().map((x) => x.id)).toEqual(['t1'])
  })

  it('clear forgets everything', () => {
    const c = createConversation()
    c.addThem(u('t1', 'hello there my friend'))
    c.clear()
    expect(c.list()).toEqual([])
    expect(c.recentThem()).toEqual([])
  })
})
