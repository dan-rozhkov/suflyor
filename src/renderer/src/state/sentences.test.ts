import { describe, expect, it } from 'vitest'
import { countSentences, englishForHero, splitLast } from './sentences'

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
