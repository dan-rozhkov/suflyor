import { describe, expect, it } from 'vitest'
import { isCodeHash, parentRoute, parseRoute, routeHash, sameRoute, type Route } from './router'

describe('parseRoute', () => {
  it('takes an empty hash as the call screen', () => {
    expect(parseRoute('')).toEqual({ kind: 'call' })
    expect(parseRoute('#')).toEqual({ kind: 'call' })
    expect(parseRoute('#/')).toEqual({ kind: 'call' })
  })
  it('knows the lists', () => {
    expect(parseRoute('#/meetings')).toEqual({ kind: 'meetings' })
    expect(parseRoute('#/actions')).toEqual({ kind: 'actions' })
    expect(parseRoute('#/ask')).toEqual({ kind: 'ask' })
  })
  it('reads a meeting and its tab', () => {
    expect(parseRoute('#/meeting/m-1')).toEqual({ kind: 'meeting', id: 'm-1', tab: 'notes' })
    expect(parseRoute('#/meeting/m-1/transcript')).toEqual({ kind: 'meeting', id: 'm-1', tab: 'transcript' })
    expect(parseRoute('#/meeting/m-1/other')).toEqual({ kind: 'meeting', id: 'm-1', tab: 'notes' })
  })
  it('decodes the id and survives bad encoding', () => {
    expect(parseRoute('#/meeting/a%20b')).toEqual({ kind: 'meeting', id: 'a b', tab: 'notes' })
    expect(parseRoute('#/meeting/%E0%A4%A')).toEqual({ kind: 'meeting', id: '%E0%A4%A', tab: 'notes' })
  })
  it('sends a meeting without an id to the list', () => {
    expect(parseRoute('#/meeting')).toEqual({ kind: 'meetings' })
  })
  it('treats anything else as the call screen, including a code link', () => {
    expect(parseRoute('#/nope')).toEqual({ kind: 'call' })
    expect(parseRoute('#code=abc')).toEqual({ kind: 'call' })
  })
})

describe('routeHash', () => {
  const routes: Route[] = [
    { kind: 'call' },
    { kind: 'meetings' },
    { kind: 'actions' },
    { kind: 'ask' },
    { kind: 'meeting', id: 'm-1', tab: 'notes' },
    { kind: 'meeting', id: 'm-1', tab: 'transcript' },
    { kind: 'meeting', id: 'a/b c', tab: 'notes' }
  ]
  it.each(routes)('round-trips %j', (route) => {
    expect(parseRoute(routeHash(route))).toEqual(route)
  })
  it('has no hash for the call screen', () => {
    expect(routeHash({ kind: 'call' })).toBe('')
  })
  it('compares routes', () => {
    expect(sameRoute({ kind: 'meetings' }, { kind: 'meetings' })).toBe(true)
    expect(sameRoute({ kind: 'meeting', id: 'a', tab: 'notes' }, { kind: 'meeting', id: 'a', tab: 'transcript' })).toBe(false)
  })
})

describe('parentRoute', () => {
  it('walks up one level', () => {
    expect(parentRoute({ kind: 'meeting', id: 'a', tab: 'transcript' })).toEqual({ kind: 'meeting', id: 'a', tab: 'notes' })
    expect(parentRoute({ kind: 'meeting', id: 'a', tab: 'notes' })).toEqual({ kind: 'meetings' })
    expect(parentRoute({ kind: 'actions' })).toEqual({ kind: 'meetings' })
    expect(parentRoute({ kind: 'meetings' })).toEqual({ kind: 'call' })
    expect(parentRoute({ kind: 'ask' })).toEqual({ kind: 'call' })
  })
})

describe('isCodeHash', () => {
  it('tells a code link from a route', () => {
    expect(isCodeHash('#code=abc')).toBe(true)
    expect(isCodeHash('#/meetings')).toBe(false)
    expect(isCodeHash('')).toBe(false)
  })
})
