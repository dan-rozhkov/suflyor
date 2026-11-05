import { describe, expect, it } from 'vitest'
import { countSentences, englishForHero, paragraphParts, paragraphs, splitLast } from './sentences'

describe('splitLast', () => {
  it('returns the whole text when there is no boundary', () => {
    expect(splitLast('  Просто одна длинная фраза без точки  ')).toEqual({ head: '', last: 'Просто одна длинная фраза без точки' })
    expect(splitLast('')).toEqual({ head: '', last: '' })
  })

  it('splits Russian sentences', () => {
    expect(splitLast('Мы запустили новый тариф. Клиенты пока осторожничают. Что вы думаете об этом решении?')).toEqual({
      head: 'Мы запустили новый тариф. Клиенты пока осторожничают.',
      last: 'Что вы думаете об этом решении?'
    })
  })

  it('splits English sentences on ! ? and ellipsis', () => {
    expect(splitLast('That went well! Did the team agree with the new plan? Honestly it was a long road…')).toEqual({
      head: 'That went well! Did the team agree with the new plan?',
      last: 'Honestly it was a long road…'
    })
    expect(splitLast('We waited for the answer for a very long time... Then the answer finally arrived')).toEqual({
      head: 'We waited for the answer for a very long time...',
      last: 'Then the answer finally arrived'
    })
  })

  it('splits before digits, quotes and after closing quotes', () => {
    expect(splitLast('Он сказал «хорошо, договорились». «Тогда начнем сегодня вечером» — добавил он')).toEqual({
      head: 'Он сказал «хорошо, договорились».',
      last: '«Тогда начнем сегодня вечером» — добавил он'
    })
    expect(splitLast('The budget was approved last week. 12 people joined the pilot program')).toEqual({
      head: 'The budget was approved last week.',
      last: '12 people joined the pilot program'
    })
  })

  it('does not split before a lowercase letter', () => {
    expect(splitLast('Это было давно. потом все изменилось')).toEqual({ head: '', last: 'Это было давно. потом все изменилось' })
  })

  it('does not split inside abbreviations and numbers', () => {
    for (const t of [
      'Нужно всё проверить, т.е. Иван должен начать заново с самого начала',
      'Нужно всё проверить, т. е. Иван должен начать заново с самого начала',
      'Use a clear example, e.g. Alice should start from the very beginning',
      'It ships in the U.S. Alice owns the whole rollout from the start',
      'Please ask Dr. Smith about the schedule for the next release cycle',
      'The version is 3.5 and the build number is v1.2 for this release'
    ]) {
      expect(splitLast(t)).toEqual({ head: '', last: t })
    }
  })

  it('still splits after a real sentence next to an abbreviation', () => {
    expect(splitLast('Мы говорили с Dr. Smith о сроках. Он обещал ответить до пятницы вечером')).toEqual({
      head: 'Мы говорили с Dr. Smith о сроках.',
      last: 'Он обещал ответить до пятницы вечером'
    })
  })

  it('merges a short tail with the previous sentence', () => {
    expect(splitLast('Первое предложение достаточно длинное. Второе тоже совсем не короткое. Но')).toEqual({
      head: 'Первое предложение достаточно длинное.',
      last: 'Второе тоже совсем не короткое. Но'
    })
  })

  it('keeps merging while the hero is still short and more sentences exist', () => {
    expect(splitLast('Вступление было совсем коротким. Потом пошло длинное начало разговора. Да. Нет. Ну')).toEqual({
      head: 'Вступление было совсем коротким.',
      last: 'Потом пошло длинное начало разговора. Да. Нет. Ну'
  })
  })

  it('returns no head when everything is short', () => {
    expect(splitLast('Да. Нет. Ну')).toEqual({ head: '', last: 'Да. Нет. Ну' })
  })

  it('preserves the text apart from join whitespace', () => {
    const t = 'Первое предложение достаточно длинное.   Второе тоже совсем не короткое?  Третье заканчивается вот так…'
    const { head, last } = splitLast(t)
    const flat = (x: string) => x.replace(/\s+/g, ' ')
    expect(flat(`${head} ${last}`)).toBe(flat(t.trim()))
  })
})

describe('abbreviation rules', () => {
  it('splits after common words that end sentences', () => {
    expect(splitLast('The answer to that question is no. We cannot ship this before the end of the month')).toEqual({
      head: 'The answer to that question is no.',
      last: 'We cannot ship this before the end of the month'
    })
    expect(splitLast('Мы сразу позвонили им. Они согласились приехать завтра утром')).toEqual({
      head: 'Мы сразу позвонили им.',
      last: 'Они согласились приехать завтра утром'
    })
    expect(splitLast('Это сделал именно я. Потом мы всё проверили вместе')).toEqual({
      head: 'Это сделал именно я.',
      last: 'Потом мы всё проверили вместе'
    })
    expect(splitLast('Nobody else on the team knew but I. Everyone was surprised by it')).toEqual({
      head: 'Nobody else on the team knew but I.',
      last: 'Everyone was surprised by it'
    })
  })

  it('keeps initials and titles together', () => {
    for (const t of [
      'Please forward the report to J. Smith before the meeting starts today',
      'Отправьте отчёт А. Иванову до начала встречи сегодня вечером',
      'Ask Prof. Miller about the schedule for the next release cycle',
      'Мы поговорили с г. Петровым о сроках поставки нового оборудования'
    ]) {
      expect(splitLast(t)).toEqual({ head: '', last: t })
    }
  })
})

describe('countSentences', () => {
  it('counts raw sentences', () => {
    expect(countSentences('')).toBe(0)
    expect(countSentences('Раз. Два. Три')).toBe(3)
    expect(countSentences('Мы, т.е. команда, ушли. Потом пришли')).toBe(2)
  })
})

describe('englishForHero', () => {
  const en = 'One is here today. Two is next. Three follows now. Four comes last in this long list'
  it('drops as many English sentences as the Russian head holds', () => {
    expect(englishForHero('Первое предложение здесь. Второе предложение тут. Третье предложение уже идет', en)).toBe('Three follows now. Four comes last in this long list')
  })
  it('shows everything when the Russian has a single sentence', () => {
    expect(englishForHero('Только одно предложение пока', en)).toBe(en)
  })
  it('falls back to the last English sentence when English is shorter', () => {
    expect(englishForHero('Первое предложение здесь. Второе предложение тут. Третье предложение уже идет', 'Just one English sentence so far')).toBe('Just one English sentence so far')
    expect(englishForHero('Первое предложение здесь. Второе предложение тут. Третье предложение уже идет', 'One is here today. Two is the next one to come')).toBe('Two is the next one to come')
  })
  it('shows the last English sentence while Russian is empty', () => {
    expect(englishForHero('', en)).toBe('Four comes last in this long list')
    expect(englishForHero('', '')).toBe('')
  })
})

describe('paragraphs', () => {
  const long = 'Мы запустили новый тариф для небольших команд. Клиенты пока осторожничают и ждут отзывов. Что вы думаете об этом решении? Нам важно услышать ваше мнение до конца месяца. Потом мы решим, что делать дальше.'

  it('keeps short text as one paragraph and handles empty text', () => {
    expect(paragraphs('Коротко. Очень коротко.')).toEqual(['Коротко. Очень коротко.'])
    expect(paragraphs('   ')).toEqual([])
    expect(paragraphs('Без точки в конце')).toEqual(['Без точки в конце'])
  })

  it('closes a paragraph once it reaches 160 characters', () => {
    const p = paragraphs(long)
    expect(p.length).toBeGreaterThan(1)
    for (const x of p.slice(0, -1)) expect(x.length).toBeGreaterThanOrEqual(160)
    expect(p.join(' ')).toBe(long)
  })

  it('keeps earlier paragraphs stable while the text grows', () => {
    let text = ''
    let before: string[] = []
    for (const s of long.split('. ')) {
      text = text ? `${text} ${s}.` : `${s}.`
      const now = paragraphs(text)
      expect(now.slice(0, before.length - 1)).toEqual(before.slice(0, -1))
      before = now
    }
    const a = paragraphs(long)
    const b = paragraphs(long + ' More sentence.')
    expect(b.slice(0, a.length - 1)).toEqual(a.slice(0, -1))
  })

  it('does not split on abbreviations', () => {
    expect(paragraphs('Спросите д-ра Иванова, т. е. нашего врача, и г. Петрова. Dr. Smith and e.g. Mr. Jones agreed.')).toHaveLength(1)
  })
})

describe('paragraphParts', () => {
  const join = (parts: { done: string; live: string }[]): string[] => parts.map((p) => [p.done, p.live].filter(Boolean).join(' '))

  it('is empty for empty text', () => {
    expect(paragraphParts('')).toEqual([])
    expect(paragraphParts('   ')).toEqual([])
  })

  it('puts a single sentence into live', () => {
    expect(paragraphParts('Мы запустили новый тариф для всех клиентов')).toEqual([
      { done: '', live: 'Мы запустили новый тариф для всех клиентов' }
    ])
  })

  it('splits done and live inside one paragraph', () => {
    const text = 'Мы запустили новый тариф. Клиенты пока осторожничают. Что вы думаете об этом решении?'
    expect(paragraphParts(text)).toEqual([
      { done: 'Мы запустили новый тариф. Клиенты пока осторожничают.', live: 'Что вы думаете об этом решении?' }
    ])
  })

  it('merges a short tail into the sentence before it', () => {
    const text = 'Мы запустили новый тариф для всех клиентов. Хорошо. Да.'
    expect(paragraphParts(text)).toEqual([{ done: '', live: text }])
    const longer = 'Первое предложение уже закончилось. Мы запустили новый тариф для всех. Да.'
    expect(paragraphParts(longer)).toEqual([
      { done: 'Первое предложение уже закончилось.', live: 'Мы запустили новый тариф для всех. Да.' }
    ])
  })

  it('keeps the hero across a paragraph boundary', () => {
    const a = 'Первое длинное предложение про планы на квартал и про то, как мы собираемся их выполнять вместе.'
    const b = 'Второе длинное предложение про бюджет и сроки, которые нам придется согласовать со всеми участниками.'
    const c = 'Третье предложение идет дальше и оно еще не закончено'
    const parts = paragraphParts(`${a} ${b} ${c}`)
    expect(parts).toEqual([
      { done: `${a} ${b}`, live: '' },
      { done: '', live: c }
    ])
  })

  it('has live in the first paragraph when the hero starts before the boundary', () => {
    const a = 'Первое длинное предложение про планы на квартал и про то, как мы собираемся их выполнять вместе.'
    const b = 'Второе длинное предложение про бюджет и сроки, которые нам придется согласовать со всеми участниками.'
    const parts = paragraphParts(`${a} ${b}`)
    expect(parts).toEqual([{ done: a, live: b }])
  })

  it('joins to the same paragraphs as paragraphs()', () => {
    const sentence = 'Это достаточно длинное предложение для проверки группировки по абзацам в ленте.'
    for (let n = 1; n <= 9; n++) {
      const text = Array.from({ length: n }, (_, i) => `${sentence} ${i}`.replace(/ (\d)$/, ' номер $1.')).join(' ')
      expect(join(paragraphParts(text))).toEqual(paragraphs(text))
    }
    expect(join(paragraphParts('Да. Нет. Может быть, посмотрим позже. Хорошо.'))).toEqual(paragraphs('Да. Нет. Может быть, посмотрим позже. Хорошо.'))
  })
})
