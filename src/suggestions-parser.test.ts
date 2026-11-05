import { describe, expect, it } from 'vitest'
import { SseSplitter, SuggestionParser, extractDelta } from './suggestions-parser'

describe('parser', () => {
  it('parses across split chunks and streams partial lines', () => {
    const p = new SuggestionParser()
    const text = 'EN: Sure, sounds good.\nEN: Let me check.\nRU: Согласие и пауза.\n'
    let last = p.push('')
    for (const ch of text.match(/.{1,3}/gs)!) last = p.push(ch)
    expect(last.options).toEqual(['Sure, sounds good.', 'Let me check.'])
    expect(last.meaningRu).toBe('Согласие и пауза.')
    expect(new SuggestionParser().push('EN: Sure, so').options).toEqual(['Sure, so'])
  })

  it('handles trailing line without newline, CRLF, quotes, ru continuation, max 3', () => {
    const p = new SuggestionParser()
    p.push('EN: "One"\r\nEN: Two\nEN: Three\nEN: Four\nRU: Раз\nдва')
    const r = p.end()
    expect(r.options).toEqual(['One', 'Two', 'Three'])
    expect(r.meaningRu).toBe('Раз два')
  })

  it('sse splitter and delta ignore reasoning', () => {
    const s = new SseSplitter()
    expect(s.push('data: {"a"')).toEqual([])
    expect(s.push(':1}\n\ndata: [DONE]\n')).toEqual(['{"a":1}', '[DONE]'])
    expect(extractDelta('{"choices":[{"delta":{"reasoning_content":"hmm","content":"hi"}}]}')).toBe('hi')
    expect(extractDelta('{"choices":[{"delta":{"reasoning_content":"hmm"}}]}')).toBe('')
    expect(extractDelta('garbage')).toBe('')
  })
})
