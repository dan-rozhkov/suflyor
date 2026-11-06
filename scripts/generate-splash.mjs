// Draws the iOS launch images and writes their <link> tags into src/index.html.
// iOS shows an image only when its media query matches the screen exactly, so
// a new iPhone size needs a new row here. Run: npm run splash
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const logo = readFileSync(join(root, 'design/logo/suflyor-logo-transparent-dark-text.svg'), 'utf8')
const outDir = join(root, 'src/public/splash')
const htmlPath = join(root, 'src/index.html')

// Portrait screens in points, read from the Xcode simulator device profiles.
const SCREENS = [
  { width: 320, height: 568, ratio: 2 }, // SE 1st generation
  { width: 360, height: 780, ratio: 3 }, // 12 mini and 13 mini in the simulator
  { width: 375, height: 667, ratio: 2 }, // 6s, 7, 8, SE 2nd and 3rd generation
  { width: 375, height: 812, ratio: 3 }, // X, Xs, 11 Pro, 12 mini and 13 mini on a device
  { width: 390, height: 844, ratio: 3 }, // 12, 13, 14, 16e, 17e
  { width: 393, height: 852, ratio: 3 }, // 14 Pro, 15, 15 Pro, 16
  { width: 402, height: 874, ratio: 3 }, // 16 Pro, 17, 17 Pro, 18 Pro
  { width: 414, height: 736, ratio: 3 }, // 6s Plus, 7 Plus, 8 Plus
  { width: 414, height: 896, ratio: 2 }, // Xr, 11
  { width: 414, height: 896, ratio: 3 }, // Xs Max, 11 Pro Max
  { width: 420, height: 912, ratio: 3 }, // Air
  { width: 428, height: 926, ratio: 3 }, // 12 Pro Max, 13 Pro Max, 14 Plus
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max, 17 Pro Max, 18 Pro Max
  { width: 466, height: 678, ratio: 3 } // Duo
]

const START = '<!-- splash:start (npm run splash) -->'
const END = '<!-- splash:end -->'

const page = `<!doctype html><style>
  html, body { margin: 0; height: 100%; background: #fff; }
  body { display: grid; place-items: center; }
  svg { width: 58vw; height: auto; display: block; }
</style>${logo}`

const work = mkdtempSync(join(tmpdir(), 'suflyor-splash-'))
const pagePath = join(work, 'splash.html')
writeFileSync(pagePath, page)
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const links = SCREENS.map(({ width, height, ratio }) => {
  const pixelWidth = width * ratio
  const pixelHeight = height * ratio
  const file = `${pixelWidth}x${pixelHeight}.png`
  execFileSync(chrome, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${join(work, 'profile')}`,
    `--window-size=${pixelWidth},${pixelHeight}`,
    `--screenshot=${join(outDir, file)}`,
    pathToFileURL(pagePath).href
  ], { stdio: 'ignore' })
  const media = `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`
  return `    <link rel="apple-touch-startup-image" media="${media}" href="/splash/${file}" />`
})
rmSync(work, { recursive: true, force: true })

const html = readFileSync(htmlPath, 'utf8')
const block = `${START}\n${links.join('\n')}\n    ${END}`
const updated = html.includes(START)
  ? html.replace(new RegExp(`${START.replace(/[()]/g, '\\$&')}[\\s\\S]*?${END}`), block)
  : html.replace('    <title>', `    ${block}\n    <title>`)
writeFileSync(htmlPath, updated)
console.log(`${links.length} launch images in src/public/splash`)
