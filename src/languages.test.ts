import { describe, expect, it } from 'vitest'
import { isLanguage, languageName, LANGUAGES } from './languages'

describe('languages', () => {
  it('lists the 60 languages of the Soniox model once each', () => {
    expect(LANGUAGES).toHaveLength(60)
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(60)
  })

  it('is sorted by name, for the settings lists', () => {
    const names = LANGUAGES.map((l) => l.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('knows only listed codes', () => {
    expect(isLanguage('de')).toBe(true)
    expect(isLanguage('xx')).toBe(false)
    expect(isLanguage('toString')).toBe(false)
    expect(isLanguage(undefined)).toBe(false)
  })

  it('names a language in English', () => {
    expect(languageName('ru')).toBe('Russian')
    expect(languageName('xx')).toBe('xx')
  })
})
