import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  feedLanguage,
  loadSettings,
  resetSettingsMemory,
  saveSettings,
  withSource,
  withTarget
} from './settings'

function fakeStorage(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(SETTINGS_STORAGE_KEY, initial)
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v)
  }
}

const broken = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  }
}

beforeEach(resetSettingsMemory)

describe('loadSettings', () => {
  it('gives the defaults when nothing is saved', () => {
    expect(loadSettings(fakeStorage())).toEqual({ source: 'en', target: 'ru', translate: true })
  })

  it('reads a saved value', () => {
    const s = fakeStorage(JSON.stringify({ source: 'de', target: 'ja', translate: false }))
    expect(loadSettings(s)).toEqual({ source: 'de', target: 'ja', translate: false })
  })

  it('falls back field by field', () => {
    const s = fakeStorage(JSON.stringify({ source: 'xx', target: 'fr', translate: 'yes' }))
    expect(loadSettings(s)).toEqual({ source: 'en', target: 'fr', translate: true })
  })

  it('survives broken JSON, non-objects and a throwing storage', () => {
    expect(loadSettings(fakeStorage('{nope'))).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(fakeStorage('null'))).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(fakeStorage('5'))).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS)
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('never returns equal languages', () => {
    expect(loadSettings(fakeStorage(JSON.stringify({ source: 'de', target: 'de' }))).target).toBe('ru')
    expect(loadSettings(fakeStorage(JSON.stringify({ source: 'ru', target: 'ru' }))).target).toBe('en')
    expect(loadSettings(fakeStorage(JSON.stringify({ source: 'ru' }))).target).toBe('en')
  })
})

describe('saveSettings', () => {
  it('writes JSON under the key', () => {
    const s = fakeStorage()
    saveSettings({ source: 'fr', target: 'en', translate: false }, s)
    expect(JSON.parse(s.data.get(SETTINGS_STORAGE_KEY)!)).toEqual({ source: 'fr', target: 'en', translate: false })
  })

  it('keeps an in-memory copy when storage fails', () => {
    saveSettings({ source: 'fr', target: 'en', translate: false }, broken)
    expect(loadSettings(broken)).toEqual({ source: 'fr', target: 'en', translate: false })
  })

  it('does not share the saved object', () => {
    const s = { source: 'fr', target: 'en', translate: true }
    saveSettings(s, broken)
    s.source = 'de'
    expect(loadSettings(broken).source).toBe('fr')
  })
})

describe('withSource and withTarget', () => {
  const base = { source: 'en', target: 'ru', translate: true }

  it('changes one language', () => {
    expect(withSource(base, 'de')).toEqual({ source: 'de', target: 'ru', translate: true })
    expect(withTarget(base, 'fr')).toEqual({ source: 'en', target: 'fr', translate: true })
  })

  it('swaps when the new value equals the other language', () => {
    expect(withSource(base, 'ru')).toEqual({ source: 'ru', target: 'en', translate: true })
    expect(withTarget(base, 'en')).toEqual({ source: 'ru', target: 'en', translate: true })
  })

  it('does not change its input', () => {
    withSource(base, 'ru')
    expect(base).toEqual({ source: 'en', target: 'ru', translate: true })
  })
})

describe('feedLanguage', () => {
  it('is the target with translation on and the source without', () => {
    expect(feedLanguage({ source: 'en', target: 'ru', translate: true })).toBe('ru')
    expect(feedLanguage({ source: 'en', target: 'ru', translate: false })).toBe('en')
  })
})
