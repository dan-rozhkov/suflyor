import { describe, expect, it } from 'vitest'
import * as icons from './icons'

const svgs = Object.entries(import.meta.glob('./icons/*.svg', { query: '?raw', import: 'default', eager: true }))

describe('icon pack', () => {
  it('has icons', () => {
    expect(svgs.length).toBeGreaterThan(0)
  })
  for (const [file, svg] of svgs) {
    describe(file, () => {
      it('keeps the pack style', () => {
        expect(svg).toContain('width="18" height="18"')
        expect(svg).toContain('viewBox="0 0 14 14"')
        expect(svg).toContain('stroke="currentColor"')
        expect(svg).toContain('stroke-linecap="round"')
        expect(svg).toContain('stroke-linejoin="round"')
        expect(svg).toContain('aria-hidden="true"')
      })
      it('keeps the stroke weight', () => {
        const widths = [...svg.matchAll(/stroke-width="([^"]*)"/g)].map((m) => m[1])
        // The dots of `more` are the one detail drawn heavier.
        expect(widths).toEqual(file.endsWith('/more.svg') ? ['1.4', '2.5'] : ['1.4'])
      })
      it('has no hard-coded colours', () => {
        expect(svg).not.toContain('#')
        for (const m of svg.matchAll(/\b(fill|stroke)="([^"]*)"/g)) {
          expect(['none', 'currentColor']).toContain(m[2])
        }
      })
    })
  }
})

describe('icons module', () => {
  const entries = Object.entries(icons)
  it('exports the nineteen icons the app uses', () => {
    expect(entries).toHaveLength(19)
  })
  it.each(entries)('%s is an svg string', (_name, value) => {
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(0)
    expect(value.startsWith('<svg')).toBe(true)
  })
})
