import { paragraphs } from './sentences'
import type { Chapter } from './chapters'
import { shownText, type Utterance } from './types'

export interface TranscriptInput {
  utterances: Utterance[]
  stamps: Map<string, number[]>
  chapters: Chapter[]
  clock: (ms: number) => string
  savedAt: string
}

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** The call as markdown: paragraphs of the shown text with their times. When the call was translated, the original of each utterance is a quote under them; without translation there is no quote. */
export function buildTranscript({ utterances, stamps, chapters, clock, savedAt }: TranscriptInput): string {
  const titles = new Map<string, string>()
  for (const c of chapters) titles.set(`${c.key.id}:${c.key.para}`, collapse(c.title))
  const blocks = ['# Call transcript', `Saved ${savedAt}`]
  for (const u of utterances) {
    const paras = paragraphs(shownText(u)).map(collapse)
    const quote = u.translationLang ? collapse(u.original) : ''
    if (!paras.length && !quote) continue
    const times = stamps.get(u.id) ?? []
    const time = (i: number): string => (times[i] === undefined ? '' : `**${clock(times[i])}**`)
    const heading = (i: number): void => {
      const title = titles.get(`${u.id}:${i}`)
      if (title) blocks.push(`## ${title}`)
    }
    if (paras.length) {
      paras.forEach((text, i) => {
        heading(i)
        blocks.push([time(i), text].filter(Boolean).join(' '))
      })
      if (quote) blocks.push(`> ${quote}`)
    } else {
      heading(0)
      blocks.push([time(0), `> ${quote}`].filter(Boolean).join('\n'))
    }
  }
  return `${blocks.join('\n\n')}\n`
}

/** suflyor-transcript-2026-11-06-1911.md, in local time. */
export function transcriptFileName(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `suflyor-transcript-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.md`
}

/** `share-only` is for the installed app: a blob link does nothing there, so a failed share must be reported. */
export type SaveMethod = 'link' | 'share' | 'share-only'

/** Starts inside the tap, with no await before the share: iOS refuses the sheet outside a user gesture. */
export async function saveMarkdown(text: string, name: string, method: SaveMethod): Promise<void> {
  const file = new File([text], name, { type: 'text/markdown' })
  if (method !== 'link' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      // The person closed the sheet: nothing to save and nothing to report.
      if (e instanceof DOMException && e.name === 'AbortError') return
      if (method === 'share-only') throw e
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
