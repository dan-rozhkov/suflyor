import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSettingsStore, devEnv, parseEnv, SettingsError } from './settings'
import type { SecretCipher } from './settings'

const fakeCipher = (available = true): SecretCipher => ({
  isAvailable: () => available,
  encrypt: (s) => Buffer.from('enc:' + s.split('').reverse().join('')),
  decrypt: (b) => b.toString().slice(4).split('').reverse().join('')
})

const tmpFile = (): string => join(mkdtempSync(join(tmpdir(), 'suflyor-')), 'settings.json')

describe('devEnv', () => {
  it('prefers the process environment over the file', () => {
    expect(devEnv({ SONIOX_API_KEY: 'file', OPENCODE_API_KEY: 'file' }, { SONIOX_API_KEY: 'proc' })).toEqual({
      SONIOX_API_KEY: 'proc',
      OPENCODE_API_KEY: 'file'
    })
  })

  it('ignores empty values and unrelated variables', () => {
    expect(devEnv({ SONIOX_API_KEY: 'file' }, { SONIOX_API_KEY: '', PATH: '/bin' })).toEqual({ SONIOX_API_KEY: 'file' })
  })
})

describe('parseEnv', () => {
  it('parses keys, quotes and comments', () => {
    expect(parseEnv('# c\nA=1\nB="two"\n\nC=\'x\'\nbad')).toEqual({ A: '1', B: 'two', C: 'x' })
  })
})

describe('settings store', () => {
  it('stores keys encrypted and never exposes them in the view', () => {
    const filePath = tmpFile()
    const s = createSettingsStore({ filePath, cipher: fakeCipher() })
    const view = s.update({ sonioxKey: 'sk-secret', model: 'm1' })
    expect(view).toEqual({ model: 'm1', autoSuggest: true, alwaysOnTop: true, micEnabled: true, keys: { soniox: true, opencode: false } })
    expect(JSON.stringify(view)).not.toContain('sk-secret')
    expect(readFileSync(filePath, 'utf8')).not.toContain('sk-secret')
    expect(s.getKey('soniox')).toBe('sk-secret')
    expect(createSettingsStore({ filePath, cipher: fakeCipher() }).getKey('soniox')).toBe('sk-secret')
  })

  it('clears a key with null and falls back to env', () => {
    const s = createSettingsStore({ filePath: tmpFile(), cipher: fakeCipher(), envFallback: { OPENCODE_API_KEY: 'envkey' } })
    expect(s.getView().keys.opencode).toBe(true)
    s.update({ opencodeKey: 'own' })
    expect(s.getKey('opencode')).toBe('own')
    s.update({ opencodeKey: null })
    expect(s.getKey('opencode')).toBe('envkey')
  })

  it('refuses to store keys when encryption is unavailable', () => {
    const s = createSettingsStore({ filePath: tmpFile(), cipher: fakeCipher(false) })
    expect(() => s.update({ sonioxKey: 'x' })).toThrow(SettingsError)
  })

  it('remembers the context path', () => {
    const filePath = tmpFile()
    createSettingsStore({ filePath, cipher: fakeCipher() }).setContextPath('/a/b.md')
    expect(createSettingsStore({ filePath, cipher: fakeCipher() }).getContextPath()).toBe('/a/b.md')
  })

  it('accepts an existing file without micEnabled (defaults to true) and keeps a saved false', () => {
    const filePath = tmpFile()
    writeFileSync(filePath, JSON.stringify({ settings: { model: 'm9', autoSuggest: false, alwaysOnTop: false }, keys: {}, contextPath: null }))
    const s = createSettingsStore({ filePath, cipher: fakeCipher() })
    expect(s.get()).toEqual({ model: 'm9', autoSuggest: false, alwaysOnTop: false, micEnabled: true })
    s.update({ micEnabled: false })
    expect(createSettingsStore({ filePath, cipher: fakeCipher() }).get().micEnabled).toBe(false)
  })
})
