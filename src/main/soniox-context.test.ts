import { describe, expect, it } from 'vitest'
import { buildSonioxContext, CONTEXT_BUDGET, weigh } from './soniox-context'

const total = (c: ReturnType<typeof buildSonioxContext>): number =>
  (c?.general ?? []).reduce((a, g) => a + weigh(g.key) + weigh(g.value), 0) +
  (c?.terms ?? []).reduce((a, t) => a + weigh(t), 0) +
  (c?.translation_terms ?? []).reduce((a, t) => a + weigh(t.source) + weigh(t.target), 0) +
  weigh(c?.text ?? '')

describe('buildSonioxContext', () => {
  it('empty -> undefined', () => {
    expect(buildSonioxContext('')).toBeUndefined()
    expect(buildSonioxContext('  \n\n ')).toBeUndefined()
  })

  it('no sections: whole file is text', () => {
    expect(buildSonioxContext('# Notes\nWe sell Nimbus.')).toEqual({ text: '# Notes\nWe sell Nimbus.' })
  })

  it('parses Call and Terms sections, rest is text', () => {
    const md = `# Nimbus sync
Intro paragraph.

## call
- Company: Acme
- Topic: onboarding
- no colon here

### Glossary
- Nimbus
- manual tests = ручные тесты
- Nimbus Cloud → Nimbus Cloud
- runs -> прогоны
- Nimbus

## Background
More text.
`
    expect(buildSonioxContext(md)).toEqual({
      general: [
        { key: 'Company', value: 'Acme' },
        { key: 'Topic', value: 'onboarding' }
      ],
      text: '# Nimbus sync\nIntro paragraph.\n\n- no colon here\n## Background\nMore text.',
      terms: ['Nimbus', 'manual tests', 'Nimbus Cloud', 'runs'],
      translation_terms: [
        { source: 'manual tests', target: 'ручные тесты' },
        { source: 'Nimbus Cloud', target: 'Nimbus Cloud' },
        { source: 'runs', target: 'прогоны' }
      ]
    })
  })

  it('General alias, max 8 pairs, omits empty fields', () => {
    const md = '## General\n' + Array.from({ length: 12 }, (_, i) => `- k${i}: v${i}`).join('\n')
    const c = buildSonioxContext(md)
    expect(c?.general).toHaveLength(8)
    expect(c?.text).toContain('- k11: v11') // overflow pairs go to the free text
    expect(c?.terms).toBeUndefined()
  })

  it('100 KB Russian file stays within budget, lists have priority', () => {
    const para = 'Это длинный абзац про продукт Куре и тестирование. '.repeat(10) + '\n'
    let text = ''
    while (text.length < 100 * 1024) text += para
    const md = `## Call\n- Компания: Рога\n\n## Terms\n- Nimbus = Nimbus\n- ручные тесты = manual tests\n\n## Notes\n${text}`
    const c = buildSonioxContext(md)!
    expect(total(c)).toBeLessThanOrEqual(CONTEXT_BUDGET)
    expect(c.general).toHaveLength(1)
    expect(c.translation_terms).toHaveLength(2)
    expect(c.terms).toEqual(['Nimbus', 'ручные тесты'])
    expect(c.text!.length).toBeGreaterThan(1000)
    expect(c.text!.endsWith('\n')).toBe(false)
    // cut at a line boundary: every kept line is whole
    expect(c.text!.split('\n').every((l) => l === '' || l.trim() === '## Notes' || l.trim() === para.trim())).toBe(true)
  })

  it('cuts a single huge line at a word boundary', () => {
    const c = buildSonioxContext('слово '.repeat(20000))!
    expect(total(c)).toBeLessThanOrEqual(CONTEXT_BUDGET)
    expect(c.text!.endsWith('слово')).toBe(true)
  })

  it('oversized lists drop trailing items', () => {
    const md = '## Terms\n' + Array.from({ length: 5000 }, (_, i) => `- термин${i} = term${i}`).join('\n')
    const c = buildSonioxContext(md)!
    expect(total(c)).toBeLessThanOrEqual(CONTEXT_BUDGET)
    expect(c.translation_terms![0].source).toBe('термин0')
    expect(c.translation_terms!.length).toBeLessThan(5000)
    expect((c.terms ?? []).length).toBeLessThan(5)
    expect(c.text).toBeUndefined()
  })

  it('separators: longest first', () => {
    const c = buildSonioxContext('## Terms\n- foo => bar\n- a == b\n- c = d\n- e -> f')!
    expect(c.translation_terms).toEqual([
      { source: 'foo', target: 'bar' },
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
      { source: 'e', target: 'f' }
    ])
  })

  it('lines that do not fit a section go to text, nothing is lost', () => {
    const pairs = Array.from({ length: 10 }, (_, i) => `- k${i}: v${i}`).join('\n')
    const c = buildSonioxContext(`## Call\nSome prose here.\n- no colon\n${pairs}\n\n## Terms\nTerms prose.\n- = orphan`)!
    expect(c.general).toHaveLength(8)
    expect(c.text).toContain('Some prose here.')
    expect(c.text).toContain('- no colon')
    expect(c.text).toContain('- k8: v8')
    expect(c.text).toContain('- k9: v9')
    expect(c.text).toContain('Terms prose.')
    expect(c.text).toContain('- = orphan')
  })
})
