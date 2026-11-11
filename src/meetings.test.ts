import { describe, expect, it } from 'vitest'
import {
  allActions, allMeetingsSources, applySummary, fallbackTitle, formatDuration, formatOffset,
  formatWhen, groupByDate, meetingSources, newMeetingId, openActionCount, transcriptText,
  type Meeting,
} from './meetings'

const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 11, 11, 15, 30) // Wednesday

function mk(id: string, startedAt: number, extra: Partial<Meeting> = {}): Meeting {
  return {
    id, startedAt, durationMs: 32 * 60_000, callLanguage: 'en', language: 'en', title: id, notes: '',
    lines: [], chapters: [], summaryState: { status: 'none' }, actions: [], overview: [], topics: [],
    ...extra,
  }
}

describe('ids and titles', () => {
  it('builds a deterministic id', () => {
    expect(newMeetingId(1000, () => 0)).toBe('m-rs-000000')
    expect(newMeetingId(1000, () => 0.5)).not.toBe(newMeetingId(1000, () => 0.1))
  })
  it('fallback title uses 24h local time', () => {
    expect(fallbackTitle(at(2026, 11, 11, 14, 5))).toBe('Call at 14:05')
    expect(fallbackTitle(at(2026, 11, 11, 9, 7))).toBe('Call at 09:07')
  })
})

describe('applySummary', () => {
  it('fills the notes and gives actions stable ids', () => {
    const m = applySummary(mk('m1', NOW), {
      title: 'Budget review',
      actionItems: [{ owner: 'Anna', task: 'Send plan' }, { owner: '', task: 'Book room' }],
      overview: ['Short'], topics: [{ title: 'Costs', bullets: ['a'] }],
    }, true)
    expect(m.title).toBe('Budget review')
    expect(m.actions).toEqual([
      { id: 'm1-a0', task: 'Send plan', owner: 'Anna', done: false },
      { id: 'm1-a1', task: 'Book room', owner: '', done: false },
    ])
    expect(m.summaryState).toEqual({ status: 'ready', cut: true })
    expect(m.topics[0].bullets).toEqual(['a'])
  })
  it('keeps the old title when the summary title is blank', () => {
    const m = applySummary(mk('m1', NOW, { title: 'Call at 10:00' }), { title: ' ', actionItems: [], overview: [], topics: [] }, false)
    expect(m.title).toBe('Call at 10:00')
  })
})

describe('groupByDate', () => {
  it('groups newest first with labels', () => {
    const list = [
      mk('old', at(2025, 10, 3)),
      mk('today', at(2026, 11, 11, 9)),
      mk('yest', at(2026, 11, 10)),
      mk('week', at(2026, 11, 9)),
      mk('last', at(2026, 11, 3)),
      mk('oct', at(2026, 10, 20)),
    ]
    const g = groupByDate(list, NOW)
    expect(g.map((x) => x.label)).toEqual(['Today', 'Yesterday', 'This week', 'Last week', 'October', 'October 2025'])
    expect(g[0].meetings[0].id).toBe('today')
  })
  it('merges same-label meetings, newest first', () => {
    const g = groupByDate([mk('a', at(2026, 11, 11, 8)), mk('b', at(2026, 11, 11, 10))], NOW)
    expect(g).toHaveLength(1)
    expect(g[0].meetings.map((m) => m.id)).toEqual(['b', 'a'])
  })
  it('handles empty input', () => {
    expect(groupByDate([], NOW)).toEqual([])
  })
})

describe('formatting', () => {
  it('formatWhen', () => {
    expect(formatWhen(at(2026, 11, 11, 9, 5), NOW)).toBe('09:05')
    expect(formatWhen(at(2026, 11, 6), NOW)).toBe('Nov 6')
    expect(formatWhen(at(2025, 11, 6), NOW)).toBe('Nov 6, 2025')
  })
  it('formatDuration', () => {
    expect(formatDuration(10_000)).toBe('<1m')
    expect(formatDuration(32 * 60_000)).toBe('32m')
    expect(formatDuration(65 * 60_000)).toBe('1h 05m')
  })
  it('formatOffset', () => {
    expect(formatOffset(0)).toBe('0:00')
    expect(formatOffset(4000)).toBe('0:04')
    expect(formatOffset(760_000)).toBe('12:40')
    expect(formatOffset(3_723_000)).toBe('1:02:03')
  })
})

describe('actions', () => {
  const a = mk('a', at(2026, 11, 10), { actions: [
    { id: 'a-a0', task: 'T1', owner: '', done: true },
    { id: 'a-a1', task: 'T2', owner: 'Ben', done: false },
  ] })
  const b = mk('b', at(2026, 11, 11), { actions: [{ id: 'b-a0', task: 'T3', owner: '', done: false }] })
  it('lists open first, newest meeting first, then done', () => {
    expect(allActions([a, b]).map((x) => x.action.id)).toEqual(['b-a0', 'a-a1', 'a-a0'])
  })
  it('counts open actions', () => {
    expect(openActionCount([a, b])).toBe(2)
    expect(openActionCount([])).toBe(0)
  })
})

describe('sources', () => {
  const m = mk('m', at(2026, 11, 11, 14, 5), {
    title: 'Budget', notes: 'Prep for Q4',
    actions: [{ id: 'm-a0', task: 'Send plan', owner: 'Anna', done: false }],
    overview: ['We met'], topics: [{ title: 'Costs', bullets: ['Cut 5%'] }],
    lines: [
      { at: 4000, original: 'Hello', translation: 'Привет', originalLang: 'en', translationLang: 'ru' },
      { at: 65_000, original: 'Fine', translation: '', originalLang: 'en', translationLang: null },
    ],
  })
  it('builds a plain text with transcript', () => {
    const s = meetingSources(m)
    expect(s).toContain('Title: Budget')
    expect(s).toContain('Date: 2026-11-11 14:05')
    expect(s).toContain('Prep for Q4')
    expect(s).toContain('- Anna: Send plan')
    expect(s).toContain('Costs:\n- Cut 5%')
    expect(s).toContain('[0:04] Привет (Hello)')
    expect(s).toContain('[1:05] Fine')
    expect(transcriptText(m)).toBe('[0:04] Привет (Hello)\n[1:05] Fine')
  })
  it('keeps notes and the last transcript lines when too long', () => {
    const lines = Array.from({ length: 5000 }, (_, i) => ({
      at: i * 1000, original: `line number ${i} ${'x'.repeat(30)}`, translation: '', originalLang: 'en', translationLang: null,
    }))
    const s = meetingSources({ ...m, lines })
    expect(s.length).toBeLessThanOrEqual(60_000)
    expect(s).toContain('Title: Budget')
    expect(s).toContain('line number 4999')
    expect(s).not.toContain('line number 0 ')
  })
  it('global sources skip transcripts, newest first, capped', () => {
    const older = mk('o', at(2026, 11, 1), { title: 'Older' })
    const s = allMeetingsSources([older, m])
    expect(s.indexOf('Budget')).toBeLessThan(s.indexOf('Older'))
    expect(s).not.toContain('Hello')
    const many = Array.from({ length: 2000 }, (_, i) => mk(`x${i}`, at(2026, 1, 1) + i, { title: 'T'.repeat(100) }))
    expect(allMeetingsSources(many).length).toBeLessThanOrEqual(60_000)
  })
})
