/**
 * The meeting-notes contract, end to end without a model: the prompt asks for the layout, the parser reads what a
 * model writes in it, the Worker's grounding drops names the call never gave, and the markdown export prints the
 * layout: H1 title; Date, Duration, People; H4 action items; H2 overview; one H2 section per topic.
 * The model answers below are hand-written fixtures, not real model output.
 */
import { describe, expect, it } from 'vitest'
import { buildSummaryMessages, groundSummary, parseSummary } from './summary-prompt'
import { boldParts, requestSummary, summaryMarkdown } from './summary'
import type { Summary } from './types'

const at = new Date(2026, 10, 10, 11, 0).getTime()
const duration = 13 * 60_000 + 41_000

const PILOT_TRANSCRIPT = [
  'Lena: overall the trial went well, so the open question is the commercial side.',
  'Maksim, can you send Freya the trial usage numbers by email? Sure, I need some time to pull them.',
  'The team plan is 120 dollars a month and we expect two to three users.',
  'Sync lost offline edits twice. Lena will look into it.',
  'We have about 1,200 partner credits left but they do not apply here.'
]
const PILOT_CONTEXT = 'Attendees: Lena Hart, Maksim Orlov, Freya'

/** What a model might write for the pilot call, in the requested format. */
const PILOT_ANSWER = [
  'TITLE: Team plan for Fjord | Check-in',
  'PEOPLE: Lena Hart, Maksim Orlov, Freya, Steve Jobs',
  'ACTION: Maksim Orlov | Send Freya the trial usage numbers | Needs to be by email, so her team can estimate costs.',
  'ACTION: Lena Hart | Look into sync losing offline edits |',
  'ACTION: Bob | Share the security checklist | ',
  'ACTION: | Confirm the number of users',
  'OVERVIEW:',
  '- The trial feedback is positive, and moving forward depends on cost.',
  '- The team plan is **$120** per month, and the team expects **2-3** users.',
  'TOPIC: Trial usage numbers',
  '- The team wants its usage numbers by email before it talks to its CEO.',
  'TOPIC: Sync conflicts',
  '- Sync lost offline edits at times, and Lena will look into it.',
  'TOPIC: Partner credits',
  '- About **1,200** partner credits are left, but they cannot be used here.'
].join('\n')

const HIRING_TRANSCRIPT = ['Анна: кандидатов трое, бюджет до 300 000 рублей.', 'Решили позвать двоих на финал, третьего пока не уверены.']
/** A different call: other topics, another language, no action items and no people. */
const HIRING_ANSWER = [
  'TITLE: Найм бэкенд-разработчика | Планирование',
  'OVERVIEW:',
  '- На финал зовут **2** кандидатов из **3**.',
  'TOPIC: Бюджет на позицию',
  '- Бюджет до **300 000** рублей.',
  'TOPIC: Третий кандидат',
  '- По третьему кандидату решения нет, команда не уверена.'
].join('\n')

const notes = (answer: string, lines: string[], context = '', language = 'en'): Summary =>
  groundSummary(parseSummary(answer, language)!, lines, context)

const headings = (md: string): string[] => md.split('\n').filter((l) => /^#{1,6} /.test(l))

describe('the prompt asks for the layout', () => {
  const [sys] = buildSummaryMessages(['a'], '', { callLanguage: 'en', language: 'en' })

  it('lists the parts in order: title, people, action items, overview, topics', () => {
    const order = ['TITLE: <subject> | <kind of meeting>', 'PEOPLE: <name>, <name>', 'ACTION: <owner> | <task> | <context>', 'OVERVIEW:', 'TOPIC: <topic title>']
    const format = sys.content.slice(sys.content.indexOf('Output format'))
    const at = order.map((part) => format.indexOf(part))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('takes the topics from the call, with no fixed list or count', () => {
    expect(sys.content).toContain('Choose the topics from what was actually said; there is no fixed list.')
    expect(sys.content).toContain('as many bullets as its content needs')
    // Nothing from the sample notes is baked into the prompt.
    expect(sys.content).not.toMatch(/Freya|Lena|Maksim|Fjord|trial usage|sync conflict/i)
    // A local run can also pass private words, comma-separated, that must never reach the prompt.
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    for (const w of (env?.SUFLYOR_PRIVATE_TERMS ?? '').split(',').map((x: string) => x.trim()).filter(Boolean)) expect(sys.content.toLowerCase()).not.toContain(w.toLowerCase())
  })

  it('forbids invented owners, deadlines, participants and metadata', () => {
    expect(sys.content).toContain('never guess an owner')
    expect(sys.content).toContain('The context says who attended, not who said what')
    expect(sys.content).toContain('Only individual people by name, never a team, a company or a role.')
    expect(sys.content).toContain('Never invent a deadline.')
    expect(sys.content).toContain('only when the transcript or the context names them as taking part. Only individual people by name, never a team, a company or a role. Never guess a name.')
    expect(sys.content).toContain('Never invent dates, numbers, names, participants or decisions.')
    // Date and length come from the page, so the model is never asked for them.
    expect(sys.content).not.toMatch(/^(?:DATE|DURATION):/m)
  })

  it('keeps numbers, decisions, open questions and how sure people were', () => {
    expect(sys.content).toContain('Keep every concrete number, price, amount, limit and constraint that was said, every decision, every request, and every question left open.')
    expect(sys.content).toContain('Never turn a guess into a fact.')
    expect(sys.content).toContain('wrap the key numbers')
  })

  it('asks for a title that says what, for whom and what kind of meeting, without made-up names', () => {
    expect(sys.content).toContain('TITLE: what the meeting was about, then " | " and the kind of meeting in one or two words')
    expect(sys.content).toContain('written in English and starting with a capital letter')
    expect(sys.content).toContain('Do not repeat the kind of meeting before the bar. Never make up a company, product or project name.')
  })

  it('asks for dense bullets: one point in one or two sentences, with who, numbers, conditions and what is open', () => {
    expect(sys.content).toContain('One bullet holds one point, in one or two full sentences')
    expect(sys.content).toContain('who said or wants what, numbers, limits, conditions, reasons, and what is still open')
    expect(sys.content).not.toContain('Every bullet is ONE sentence')
    expect(sys.content).toContain('OVERVIEW: 3 to 5 bullets')
  })

  it('asks for action context in full sentences: why, for whom, on what condition', () => {
    expect(sys.content).toContain('context: one or two full sentences on why it is needed, who asked for it or who it is for, and any condition, form or deadline, only as said on the call.')
  })

  it('never numbers unknown speakers: a side when the words show it, otherwise no speaker', () => {
    expect(sys.content).toContain('The transcript has no speaker labels. Never number or label speakers')
    expect(sys.content).toContain('when even that is unclear, state the point without a speaker.')
  })

  it('writes in the notes language from the settings', () => {
    expect(buildSummaryMessages(['a'], '', { callLanguage: 'en', language: 'ru' })[0].content).toContain('Write ALL output in Russian.')
    expect(buildSummaryMessages(['a'], '', { callLanguage: 'de', language: 'fr' })[0].content).toContain('Write ALL output in French.')
  })
})

describe('markdown export of the notes', () => {
  it('prints the full layout for the pilot call', () => {
    const md = summaryMarkdown({ summary: notes(PILOT_ANSWER, PILOT_TRANSCRIPT, PILOT_CONTEXT), startedAt: at, durationMs: duration, language: 'en' })
    expect(md).toBe(
      [
        '# Team plan for Fjord | Check-in',
        '',
        '**Date**: Tuesday, November 10, 2026 at 11:00 AM  ',
        '**Duration**: 13:41  ',
        '**People**: Lena Hart, Maksim Orlov, Freya',
        '',
        '#### Action Items',
        '- [ ] Maksim Orlov - **Send Freya the trial usage numbers**',
        'Needs to be by email, so her team can estimate costs.',
        '- [ ] Lena Hart - **Look into sync losing offline edits**',
        '- [ ] **Share the security checklist**',
        '- [ ] **Confirm the number of users**',
        '',
        '## Overview',
        '* The trial feedback is positive, and moving forward depends on cost.',
        '* The team plan is **$120** per month, and the team expects **2-3** users.',
        '',
        '## Trial usage numbers',
        '* The team wants its usage numbers by email before it talks to its CEO.',
        '',
        '## Sync conflicts',
        '* Sync lost offline edits at times, and Lena will look into it.',
        '',
        '## Partner credits',
        '* About **1,200** partner credits are left, but they cannot be used here.',
        ''
      ].join('\n')
    )
  })

  it('keeps the order: H1, details, action items, overview, then the topics as the model gave them', () => {
    const md = summaryMarkdown({ summary: notes(PILOT_ANSWER, PILOT_TRANSCRIPT, PILOT_CONTEXT), startedAt: at, durationMs: duration, language: 'en' })
    expect(md.split('\n')[0]).toBe('# Team plan for Fjord | Check-in')
    expect(md.indexOf('**Date**')).toBeLessThan(md.indexOf('**Duration**'))
    expect(md.indexOf('**Duration**')).toBeLessThan(md.indexOf('**People**'))
    expect(md.indexOf('**People**')).toBeLessThan(md.indexOf('#### Action Items'))
    expect(headings(md)).toEqual(['# Team plan for Fjord | Check-in', '#### Action Items', '## Overview', '## Trial usage numbers', '## Sync conflicts', '## Partner credits'])
  })

  it('takes topics, their number and language from the call, not from a fixed list', () => {
    const md = summaryMarkdown({ summary: notes(HIRING_ANSWER, HIRING_TRANSCRIPT, '', 'ru'), startedAt: at, durationMs: 5 * 60_000, language: 'ru' })
    expect(headings(md)).toEqual(['# Найм бэкенд-разработчика | Планирование', '## Обзор', '## Бюджет на позицию', '## Третий кандидат'])
    expect(md).toContain('**Дата**: вторник, 10 ноября 2026 в 11:00  \n**Длительность**: 5:00\n')
    expect(md).toContain('* Бюджет до **300 000** рублей.')
    expect(md).toContain('команда не уверена')
  })

  it('omits what the call did not give: no people, no action items, no context line', () => {
    const md = summaryMarkdown({ summary: notes(HIRING_ANSWER, HIRING_TRANSCRIPT, '', 'ru'), startedAt: at, durationMs: 60_000, language: 'ru' })
    expect(md).not.toContain('Участники')
    expect(md).not.toContain('Задачи')
    expect(md).not.toContain('- [ ]')
  })

  it('says when the notes cover only the latest part of the call', () => {
    const md = summaryMarkdown({ summary: notes(HIRING_ANSWER, HIRING_TRANSCRIPT, '', 'ru'), startedAt: at, durationMs: 60_000, language: 'ru', cut: true })
    expect(md).toContain('_Итоги только по последней части разговора._')
  })
})

describe('no invented metadata', () => {
  const pilot = notes(PILOT_ANSWER, PILOT_TRANSCRIPT, PILOT_CONTEXT)

  it('drops people and owners the transcript and the call notes never named', () => {
    expect(pilot.people).toEqual(['Lena Hart', 'Maksim Orlov', 'Freya'])
    expect(pilot.actionItems.map((a) => a.owner)).toEqual(['Maksim Orlov', 'Lena Hart', '', ''])
  })

  it('clears an owner the call notes list as an attendee but the call itself never named', () => {
    const s = groundSummary(
      { title: 'T', people: ['Lena Hart', 'Maksim Orlov'], actionItems: [{ owner: 'Lena Hart', task: 'Send the proposal' }, { owner: 'Maksim Orlov', task: 'Check sync' }], overview: ['o'], topics: [] },
      ['I will send the proposal today.', 'Maksim, can you check sync? Yes.'],
      'Attendees: Lena Hart, Maksim Orlov'
    )
    expect(s.people).toEqual(['Lena Hart', 'Maksim Orlov'])
    expect(s.actionItems.map((a) => a.owner)).toEqual(['', 'Maksim Orlov'])
  })

  it('keeps an owner whose name speech recognition spelled with an x', () => {
    const s = groundSummary({ title: 'T', actionItems: [{ owner: 'Максим', task: 'Check sync' }], overview: ['o'], topics: [] }, ['Maxim, can you check sync? Yes.'])
    expect(s.actionItems[0].owner).toBe('Максим')
  })

  it('still finds a name written in another alphabet or with a case ending', () => {
    const s = groundSummary(
      { title: 'T', people: ['Лена', 'Максим Орлов', 'Анне'], actionItems: [{ owner: 'Игорь', task: 'x' }], overview: ['o'], topics: [] },
      ['Lena and Maksim met.', 'Анна', 'Igor will do it.']
    )
    expect(s.people).toEqual(['Лена', 'Максим Орлов', 'Анне'])
    expect(s.actionItems[0].owner).toBe('Игорь')
  })

  it('does not match a short name inside another word', () => {
    const s = groundSummary({ title: 'T', people: ['Li'], actionItems: [{ owner: 'Al', task: 'x' }], overview: ['o'], topics: [] }, ['All the lights are on.'])
    expect(s.people).toBeUndefined()
    expect(s.actionItems[0].owner).toBe('')
  })

  it('treats "none" and the like as no people', () => {
    expect(parseSummary('PEOPLE: none\nOVERVIEW:\n- a', 'en')!.people).toBeUndefined()
    expect(parseSummary('PEOPLE: (не названы)\nOVERVIEW:\n- a')!.people).toBeUndefined()
    expect(parseSummary('PEOPLE: Anna, anna, —\nOVERVIEW:\n- a')!.people).toEqual(['Anna'])
  })

  it('ignores dates or lengths the model writes: only the page measures them', () => {
    const s = parseSummary('TITLE: T\nDATE: Monday, January 1\nDURATION: 2 hours\nOVERVIEW:\n- a', 'en')!
    const md = summaryMarkdown({ summary: s, startedAt: at, durationMs: duration, language: 'en' })
    expect(md).not.toContain('January')
    expect(md).not.toContain('2 hours')
    expect(md).toContain('**Date**: Tuesday, November 10, 2026 at 11:00 AM')
  })
})

describe('title and bullets as the model writes them', () => {
  it('keeps the subject and the kind of meeting split by a bar', () => {
    expect(parseSummary('TITLE: Team plan for Fjord | Check-in\nOVERVIEW:\n- a', 'en')!.title).toBe('Team plan for Fjord | Check-in')
  })

  it('starts the kind of meeting with a capital letter', () => {
    expect(parseSummary('TITLE: Trial review for Fjord | check-in\nOVERVIEW:\n- a', 'en')!.title).toBe('Trial review for Fjord | Check-in')
    expect(parseSummary('TITLE: Итоги триала | созвон\nOVERVIEW:\n- a')!.title).toBe('Итоги триала | Созвон')
    expect(parseSummary('TITLE: plain title\nOVERVIEW:\n- a', 'en')!.title).toBe('plain title')
    expect(parseSummary('TITLE: Trial review|check-in\nOVERVIEW:\n- a', 'en')!.title).toBe('Trial review|Check-in')
    expect(parseSummary(`TITLE: ${'x'.repeat(130)} | check-in\nOVERVIEW:\n- a`, 'en')!.title).toBe('x'.repeat(120))
  })

  it('keeps a two-sentence bullet whole', () => {
    const s = parseSummary('OVERVIEW:\n- The plan is **$120** per month. Storage is still to be checked.', 'en')!
    expect(s.overview).toEqual(['The plan is **$120** per month. Storage is still to be checked.'])
  })
})

describe('action items', () => {
  it('reads owner, task and context, and context written on the next line', () => {
    const s = parseSummary(
      ['ACTION: Anna | Send the contract | By Friday, as agreed.', 'ACTION: Boris | Call the client', 'The client asked for a call this week.', 'ACTION: Plain task', 'OVERVIEW:', '- a'].join('\n'),
      'en'
    )!
    expect(s.actionItems).toEqual([
      { owner: 'Anna', task: 'Send the contract', details: 'By Friday, as agreed.' },
      { owner: 'Boris', task: 'Call the client', details: 'The client asked for a call this week.' },
      { owner: '', task: 'Plain task' }
    ])
  })

  it('keeps a stray line from becoming context when it is not right under an action', () => {
    const s = parseSummary('ACTION: Anna | Send it\nOVERVIEW:\nHere is some chatter.\n- a', 'en')!
    expect(s.actionItems[0].details).toBeUndefined()
  })

  it('never shows bold marks inside the task: the whole task is bold', () => {
    const s = parseSummary('ACTION: Anna | Pay **300** dollars |\nOVERVIEW:\n- a', 'en')!
    const md = summaryMarkdown({ summary: s, startedAt: at, durationMs: duration, language: 'en' })
    expect(md).toContain('- [ ] Anna - **Pay 300 dollars**\n')
  })
})

describe('notes made before this layout', () => {
  const old: Summary = {
    title: 'Планирование релиза',
    actionItems: [{ owner: 'Анна', task: 'подготовить отчёт' }, { owner: '', task: 'написать письмо' }],
    overview: ['Обсудили сроки'],
    topics: [{ title: 'Сроки', bullets: ['Релиз в пятницу'] }]
  }

  it('still come from the Worker without people or context', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ summary: old }))) as unknown as typeof fetch
    const r = await requestSummary({ code: 'fictional-code-0123456789abcdef', lines: ['a'], context: '', callLanguage: 'en', language: 'ru', fetchImpl })
    expect(r).toEqual({ ok: true, summary: old })
  })

  it('export without a People line or context lines', () => {
    const md = summaryMarkdown({ summary: old, startedAt: at, durationMs: duration, language: 'ru' })
    expect(md).not.toContain('Участники')
    expect(md).toContain('#### Задачи\n- [ ] Анна - **подготовить отчёт**\n- [ ] **написать письмо**\n\n## Обзор')
  })

  it('show their text as written, with no bold', () => {
    expect(boldParts('Релиз в пятницу')).toEqual([{ text: 'Релиз в пятницу', bold: false }])
  })

  it('fail only on a wrong shape for the new fields', async () => {
    const bad = { summary: { ...old, people: [1] } }
    const fetchImpl = (async () => new Response(JSON.stringify(bad))) as unknown as typeof fetch
    const r = await requestSummary({ code: 'fictional-code-0123456789abcdef', lines: ['a'], context: '', callLanguage: 'en', language: 'ru', fetchImpl })
    expect(r.ok).toBe(false)
  })

  it('keep the context and people a newer Worker sends', async () => {
    const fresh = { ...old, people: ['Анна'], actionItems: [{ owner: 'Анна', task: 'подготовить отчёт', details: 'До **пятницы**.' }] }
    const fetchImpl = (async () => new Response(JSON.stringify({ summary: fresh }))) as unknown as typeof fetch
    const r = await requestSummary({ code: 'fictional-code-0123456789abcdef', lines: ['a'], context: '', callLanguage: 'en', language: 'ru', fetchImpl })
    expect(r).toEqual({ ok: true, summary: fresh })
  })
})

describe('boldParts', () => {
  it('splits paired marks into bold pieces', () => {
    expect(boldParts('Plan **$120** for **2-3** users')).toEqual([
      { text: 'Plan ', bold: false },
      { text: '$120', bold: true },
      { text: ' for ', bold: false },
      { text: '2-3', bold: true },
      { text: ' users', bold: false }
    ])
  })
  it('shows an unpaired mark as plain text', () => {
    expect(boldParts('Broken **pair')).toEqual([{ text: 'Broken pair', bold: false }])
  })
})
