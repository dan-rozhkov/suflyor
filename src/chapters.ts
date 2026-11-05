import { isHeaderSafe } from './token'
import { MAX_CHAPTER_PARAGRAPHS, MAX_CHAPTER_PARAGRAPH_CHARS, MAX_CHAPTER_TITLE_CHARS, MAX_CHAPTER_WINDOW_CHARS } from './chapters-limits'

/** New characters since the last sent size: send right away (about 90 seconds of speech). */
export const SIZE_CHARS = 1500
/** No new text for this long counts as a pause, a natural topic boundary. */
export const PAUSE_MS = 10_000
/** A pause sends only when at least this many characters are new. */
export const PAUSE_CHARS = 400
/** The shortest time between two sends. */
export const MIN_GAP_MS = 45_000
/** Stop sends the rest when at least this many characters are new, ignoring the gap. */
export const FLUSH_CHARS = 100
/** The shortest chapter, about 20 seconds of speech: longer than one usual paragraph, shorter than a real topic. */
export const MIN_CHAPTER_CHARS = 300
export const REQUEST_MS = 20_000
export const BACKOFF_BASE_MS = 60_000
export const BACKOFF_MAX_MS = 5 * 60_000
/** Retries without new speech. After them the page waits for new text, so a dead provider is not called forever. */
export const MAX_RETRIES = 3

export interface ParaKey {
  id: string
  para: number
}
export interface ChapterPara {
  key: ParaKey
  text: string
  at: number
}
export interface Chapter {
  key: ParaKey
  title: string
  at: number
}

export interface ChapterDeps {
  getCode: () => string
  /** Paragraphs of the current run, in order. */
  getParagraphs: () => ChapterPara[]
  onChange: (chapters: Chapter[]) => void
  fetchImpl?: typeof fetch
  now?: () => number
}

export interface Chapterer {
  /** `size` is the total number of characters of the current run. */
  onText(size: number): void
  flush(): void
  startRun(): void
  reset(): void
}

const sameKey = (a: ParaKey, b: ParaKey): boolean => a.id === b.id && a.para === b.para

function sameList(a: Chapter[], b: Chapter[]): boolean {
  return a.length === b.length && a.every((c, i) => sameKey(c.key, b[i].key) && c.title === b[i].title && c.at === b[i].at)
}

/** The newest paragraphs that fit the limits; at least one. */
function cutWindow(paras: ChapterPara[]): ChapterPara[] {
  let chars = 0
  let from = paras.length
  while (from > 0 && paras.length - from < MAX_CHAPTER_PARAGRAPHS) {
    const len = Math.min(paras[from - 1].text.length, MAX_CHAPTER_PARAGRAPH_CHARS)
    if (from < paras.length && chars + len > MAX_CHAPTER_WINDOW_CHARS) break
    chars += len
    from--
  }
  return paras.slice(from)
}

/** Where the open chapter starts. Non-final text can shrink: then it is the next paragraph, never one of a closed chapter. */
function openIndex(paras: ChapterPara[], open: Chapter): number {
  const exact = paras.findIndex((p) => sameKey(p.key, open.key))
  return exact >= 0 ? exact : paras.findIndex((p) => p.at >= open.at)
}

interface Answer {
  start: number
  title: string
}

/** A 503 from anything else, such as the platform, is a passing failure. */
async function isMissingKey(res: Response): Promise<boolean> {
  if (res.status !== 503) return false
  try {
    return ((await res.clone().json()) as { error?: unknown }).error === 'no-suggest-key'
  } catch {
    return false
  }
}

function parseAnswer(data: unknown): Answer[] | null {
  const list = (data as { chapters?: unknown } | null)?.chapters
  if (!Array.isArray(list)) return null
  const out: Answer[] = []
  for (const c of list) {
    const start = (c as { start?: unknown } | null)?.start
    const title = (c as { title?: unknown } | null)?.title
    if (typeof start !== 'number' || typeof title !== 'string') return null
    out.push({ start, title })
  }
  return out
}

export function createChapterer(deps: ChapterDeps): Chapterer {
  const doFetch: typeof fetch = deps.fetchImpl ?? ((...a) => fetch(...a))
  const now = deps.now ?? ((): number => Date.now())

  let chapters: Chapter[] = []
  let sentSize = 0
  let lastSize = 0
  let failures = 0
  let nextAllowed = 0
  let disabled = false
  let flushPending = false
  let pausePending = false
  /** Retries since the last new text. */
  let retries = 0
  /** Stop was tapped: the short tail of the call counts too. */
  let ended = false
  /** The run the last chapter belongs to. */
  let openRun = -1
  let pauseTimer: ReturnType<typeof setTimeout> | undefined
  let inFlight: AbortController | null = null
  /** Changes on reset: an answer from an older epoch is dropped. */
  let epoch = 0
  /** Changes on startRun and reset: the sent size of an older run must not apply. */
  let run = 0

  const fresh = (): number => Math.max(0, lastSize - sentSize)
  const enough = (): boolean => fresh() >= (ended ? FLUSH_CHARS : PAUSE_CHARS)

  function clearPause(): void {
    clearTimeout(pauseTimer)
    pauseTimer = undefined
  }

  function firePause(): void {
    pauseTimer = undefined
    if (disabled || !enough()) return
    if (inFlight) {
      pausePending = true
      return
    }
    const wait = nextAllowed - now()
    if (wait > 0) {
      pauseTimer = setTimeout(firePause, wait)
      return
    }
    void send()
  }

  function armPause(ms: number): void {
    clearPause()
    pauseTimer = setTimeout(firePause, ms)
  }

  async function send(): Promise<void> {
    if (disabled || inFlight) return
    const paras = deps.getParagraphs()
    if (!paras.length) return
    const code = deps.getCode()
    // No usable code right now, for example the form is showing: the next text tries again.
    if (!isHeaderSafe(code)) return
    const last = chapters[chapters.length - 1]
    const openChapter = last && openRun === run ? last : undefined
    const from = openChapter ? openIndex(paras, openChapter) : 0
    // The open chapter has no text at this moment: resending the run would duplicate chapters.
    if (from < 0) return
    const base = chapters.length - (openChapter ? 1 : 0)
    const head = paras[from]
    const window = cutWindow(paras.slice(from))
    const sendSize = lastSize
    const myEpoch = epoch
    const myRun = run
    const ctrl = new AbortController()
    inFlight = ctrl
    clearPause()
    pausePending = false
    nextAllowed = now() + MIN_GAP_MS
    const timer = setTimeout(() => {
      ctrl.abort()
    }, REQUEST_MS)

    let answer: Answer[] | null = null
    let stop = false
    try {
      const aborted = new Promise<never>((_, reject) => {
        ctrl.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
      aborted.catch(() => {})
      const res = await Promise.race([
        doFetch('/api/chapters', {
          method: 'POST',
          headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paragraphs: window.map((p) => p.text.slice(0, MAX_CHAPTER_PARAGRAPH_CHARS)),
            ...(openChapter ? { openTitle: openChapter.title } : {})
          }),
          signal: ctrl.signal
        }),
        aborted
      ])
      if (res.status === 401 || (await isMissingKey(res))) stop = true
      else if (res.ok) answer = parseAnswer(await Promise.race([res.json(), aborted]))
    } catch {
      answer = null
    } finally {
      clearTimeout(timer)
    }
    if (myEpoch !== epoch) return
    inFlight = null

    if (stop) {
      // Not a login problem for a background call: stay quiet until the next run.
      if (myRun === run) disabled = true
      flushPending = false
      pausePending = false
      return
    }
    if (!answer) {
      failures++
      nextAllowed = now() + Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS)
      flushPending = false
      pausePending = false
      // Nothing else wakes the page after Stop or in silence.
      if (retries < MAX_RETRIES && enough()) {
        retries++
        armPause(nextAllowed - now())
      }
      return
    }
    failures = 0
    if (myRun === run) sentSize = sendSize
    merge(base, openChapter, head, window, answer, myRun)
    afterFinish()
  }

  function merge(base: number, open: Chapter | undefined, head: ChapterPara, window: ChapterPara[], answer: Answer[], fromRun: number): void {
    // Each mapped chapter keeps its window index while the short ones are dropped.
    const entries: { idx: number; chapter: Chapter }[] = []
    let prev = -1
    for (const a of answer) {
      const title = a.title.trim().slice(0, MAX_CHAPTER_TITLE_CHARS)
      if (!Number.isInteger(a.start) || a.start < 0 || a.start >= window.length || a.start <= prev || !title) continue
      prev = a.start
      const own = { idx: a.start, chapter: { key: window[a.start].key, title, at: window[a.start].at } }
      if (!entries.length) {
        // A cut window cannot move the first chapter. An answer that skips paragraph 0 leaves the open chapter as it is.
        const first = open ?? head
        if (open && a.start > 0) entries.push({ idx: 0, chapter: open }, own)
        else entries.push({ idx: 0, chapter: { key: first.key, title, at: first.at } })
      } else entries.push(own)
    }
    if (!entries.length) return
    const sizeOf = (from: number, to: number): number => window.slice(from, to).reduce((n, p) => n + p.text.length, 0)
    // A cut window hides the start of the first chapter, so its size here says nothing.
    const cut = window[0] !== head
    const kept = [entries[0]]
    entries.slice(1).forEach((e, i) => {
      const last = kept[kept.length - 1]
      if ((cut && kept.length === 1) || sizeOf(last.idx, e.idx) >= MIN_CHAPTER_CHARS) {
        kept.push(e)
        return
      }
      // Short neighbours grow together into one chapter.
      if (sizeOf(e.idx, entries[i + 2]?.idx ?? window.length) < MIN_CHAPTER_CHARS) return
      // A short chapter before a real one joins the chapter before it.
      if (kept.length > 1) {
        kept[kept.length - 1] = e
        return
      }
      // The first chapter has none before it: it stays where it is and names the real topic.
      kept[0] = { idx: last.idx, chapter: { ...last.chapter, title: e.chapter.title } }
    })
    // A short tail joins the chapter before it. While the call goes on, the next request can split it again.
    if (kept.length > 1 && sizeOf(kept[kept.length - 1].idx, window.length) < MIN_CHAPTER_CHARS) kept.pop()
    const mapped = kept.map((e) => e.chapter)
    openRun = fromRun
    const next = chapters.slice(0, base).concat(mapped)
    if (sameList(next, chapters)) return
    chapters = next
    deps.onChange(chapters.slice())
  }

  function afterFinish(): void {
    if (disabled) return
    if (flushPending) {
      flushPending = false
      if (fresh() >= FLUSH_CHARS) {
        void send()
        return
      }
    }
    if (pausePending) {
      pausePending = false
      if (fresh() >= PAUSE_CHARS) armPause(Math.max(nextAllowed - now(), 0))
    }
  }

  return {
    onText(size) {
      lastSize = size
      ended = false
      retries = 0
      if (disabled) return
      armPause(PAUSE_MS)
      pausePending = false
      if (!inFlight && fresh() >= SIZE_CHARS && now() >= nextAllowed) void send()
    },
    flush() {
      ended = true
      if (disabled || fresh() < FLUSH_CHARS) return
      clearPause()
      if (inFlight) flushPending = true
      else void send()
    },
    startRun() {
      run++
      sentSize = 0
      lastSize = 0
      disabled = false
      ended = false
      retries = 0
      flushPending = false
      pausePending = false
      clearPause()
    },
    reset() {
      epoch++
      run++
      inFlight?.abort()
      inFlight = null
      clearPause()
      chapters = []
      sentSize = 0
      lastSize = 0
      failures = 0
      nextAllowed = 0
      disabled = false
      ended = false
      retries = 0
      openRun = -1
      flushPending = false
      pausePending = false
    }
  }
}
