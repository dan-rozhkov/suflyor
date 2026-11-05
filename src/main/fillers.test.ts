import { describe, expect, it } from 'vitest'
import { stripFillers as f } from './fillers'

describe('stripFillers', () => {
  it.each([
    ['Yeah, um, I think', 'Yeah, I think'],
    ['So um I', 'So I'],
    ['Um, I think', 'I think'],
    ['Э-э, я думаю', 'Я думаю'],
    ['I think, um.', 'I think.'],
    ['done. Um. Next', 'done. Next'],
    ['Э-э... да', 'Да'],
    ['Um', ''],
    ['uhh, umm, hmm', ''],
    ['Well um, uh, I mean', 'Well I mean'],
    ['I think um', 'I think'],
    ['Мы э-э-э хотим эм показать', 'Мы хотим показать'],
    ['Мы э- хотим', 'Мы хотим'],
    ['Ну, ээ, да', 'Ну, да'],
    ['Хм, ну ладно', 'Ну ладно'],
    ['It is, mm, fine', 'It is, fine'],
    ['yes. um, really', 'yes. Really']
  ])('%s -> %s', (i, o) => expect(f(i)).toBe(o))

  it.each([
    'uh-huh',
    'mm-hmm',
    'umbrella',
    'эмоции',
    'Эмма пришла',
    'It is 5 мм',
    'about 10 mm',
    'I\'m here',
    'Hello  world ,  ok',
    'Plain sentence.',
    ''
  ])('leaves %j untouched', (i) => expect(f(i)).toBe(i))

  it.each([
    ['Is it ready? Um... I think so', 'Is it ready? I think so'],
    ['Did you see it? Um.', 'Did you see it?'],
    ['Готово? Э-э... да', 'Готово? Да'],
    ['We — um — want it', 'We — want it'],
    ['Мы — э-э — хотим', 'Мы — хотим'],
    ['(um, yes)', '(yes)'],
    ['"Um, yes" he said', '"Yes" he said'],
    ['Um - I think', 'I think'],
    ['Um, iPhone sales', 'iPhone sales'],
    ['This is erm fine', 'This is fine']
  ])('%s -> %s', (i, o) => expect(f(i)).toBe(o))

  it.each(['We may err on the side', 'Take him to the ER now', 'Буква Э важна', 'Это э'.slice(0, 3)])(
    'keeps real words in %j',
    (i) => expect(f(i)).toBe(i)
  )

  it('lone э before punctuation or at the end is a filler', () => {
    expect(f('Я, э, думаю')).toBe('Я, думаю')
    expect(f('Я думаю э')).toBe('Я думаю')
  })

  it('no double spaces or leading punctuation', () => {
    const out = f('Um, uh, well, erm, yes')
    expect(out).toBe('Well, yes')
  })
})
