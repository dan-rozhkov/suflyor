import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = import.meta.dirname
const html = readFileSync(resolve(here, 'index.html'), 'utf8')
const links = [...html.matchAll(/<link rel="apple-touch-startup-image" media="([^"]+)" href="([^"]+)"/g)]
  .map(([, media, href]) => ({ media, href }))

const number = (media: string, feature: string): number =>
  Number(new RegExp(`${feature}: (\\d+)`).exec(media)?.[1])

// Width and height sit at bytes 16 and 20 of every PNG.
const pngSize = (href: string): { width: number; height: number } => {
  const file = readFileSync(resolve(here, 'public', href.slice(1)))
  return { width: file.readUInt32BE(16), height: file.readUInt32BE(20) }
}

describe('iOS launch images', () => {
  it('covers the current iPhone screens', () => {
    const screens = links.map(({ media }) => `${number(media, 'device-width')}x${number(media, 'device-height')}`)
    expect(screens).toEqual(expect.arrayContaining(['393x852', '402x874', '440x956']))
  })
  it('has no repeated media query', () => {
    expect(new Set(links.map(({ media }) => media)).size).toBe(links.length)
  })
  it('has a file of the exact pixel size for each query', () => {
    for (const { media, href } of links) {
      const ratio = number(media, '-webkit-device-pixel-ratio')
      expect(pngSize(href), href).toEqual({
        width: number(media, 'device-width') * ratio,
        height: number(media, 'device-height') * ratio
      })
    }
  })
})
