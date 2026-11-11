import { isLanguage } from './languages'
import { SONIOX_TEMP_KEY_URL } from './soniox-url'
import { OPENCODE_CHAT_URL } from './opencode-url'
import { buildMessages, MAX_CONTEXT_CHARS, type ChatMessage } from './suggest-prompt'
import { buildSummaryMessages, groundSummary, parseSummary } from './summary-prompt'
import { MAX_SUMMARY_BODY_BYTES, MAX_SUMMARY_CHARS, MAX_SUMMARY_LINES } from './summary-limits'
import { buildAskMessages, cleanAnswer, type AskTurn } from './ask-prompt'
import { MAX_ASK_BODY_BYTES, MAX_ASK_HISTORY_TURNS, MAX_ASK_QUESTION_CHARS, MAX_ASK_SOURCES_CHARS, MAX_ASK_TURN_CHARS } from './ask-limits'
import { buildChapterMessages, parseChapters } from './chapters-prompt'
import { MAX_CHAPTER_PARAGRAPHS, MAX_CHAPTER_PARAGRAPH_CHARS, MAX_CHAPTER_TITLE_CHARS, MAX_CHAPTER_WINDOW_CHARS } from './chapters-limits'

export interface Env {
  SONIOX_API_KEY: string
  ACCESS_CODE: string
  OPENCODE_API_KEY?: string
}


/** A shorter code can be brute-forced, so the Worker refuses every request until it is longer. */
const MIN_CODE_LENGTH = 24

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** Constant-time compare: both sides are hashed, so the lengths always match. */
async function codeMatches(given: string, expected: string | undefined): Promise<boolean> {
  if (!expected || expected.length < MIN_CODE_LENGTH) return false
  const [a, b] = await Promise.all([sha256(given), sha256(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function bearer(request: Request): string {
  const m = /^Bearer (.*)$/i.exec(request.headers.get('Authorization') ?? '')
  return m ? m[1].trim() : ''
}

async function handleToken(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, { Allow: 'POST' })
  if (!(await codeMatches(bearer(request), env.ACCESS_CODE))) return json({ error: 'bad-code' }, 401)
  try {
    const res = await fetch(SONIOX_TEMP_KEY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SONIOX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usage_type: 'transcribe_websocket', expires_in_seconds: 60,
        single_use: true,
        max_session_duration_seconds: 3600
      })
    })
    if (!res.ok) return json({ error: 'upstream' }, 502)
    const data = (await res.json()) as { api_key?: unknown; expires_at?: unknown }
    if (typeof data.api_key !== 'string' || !data.api_key) return json({ error: 'upstream' }, 502)
    return json({ api_key: data.api_key, expires_at: data.expires_at }, 200)
  } catch {
    return json({ error: 'upstream' }, 502)
  }
}

const MAX_BODY_BYTES = 200 * 1024
const MAX_LINES_IN = 200
const MAX_LINE_CHARS = 2000
const MAX_CONTEXT_IN = 120_000
const SUGGEST_MODEL = 'deepseek-v4.1-flash'

interface CallOptions {
  stream: boolean
  maxTokens: number
  temperature: number
}

const SUGGEST_CALL: CallOptions = { stream: true, maxTokens: 700, temperature: 0.7 }
const CHAPTERS_CALL: CallOptions = { stream: false, maxTokens: 400, temperature: 0.2 }
const SUMMARY_CALL: CallOptions = { stream: false, maxTokens: 8000, temperature: 0.2 }
const ASK_CALL: CallOptions = { stream: false, maxTokens: 600, temperature: 0.2 }

function callOpenCode(key: string, messages: ChatMessage[], opts: CallOptions, withReasoning: boolean): Promise<Response> {
  return fetch(OPENCODE_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: SUGGEST_MODEL,
      messages,
      stream: opts.stream,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      ...(withReasoning ? { reasoning_effort: 'none' } : {})
    })
  })
}

/** Ask with reasoning off; on a 400 ask once more without that field. */
async function askOpenCode(key: string, messages: ChatMessage[], opts: CallOptions): Promise<Response> {
  let res = await callOpenCode(key, messages, opts, true)
  if (res.status === 400) {
    void res.body?.cancel()
    res = await callOpenCode(key, messages, opts, false)
  }
  return res
}

/** The text of a whole answer, or null when there is none. */
async function askForText(key: string, messages: ChatMessage[], opts: CallOptions): Promise<string | null> {
  const res = await askOpenCode(key, messages, opts)
  if (!res.ok) {
    void res.body?.cancel()
    return null
  }
  const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
  const content = data?.choices?.[0]?.message?.content
  return typeof content === 'string' && content ? content : null
}

/** The checks every model route shares. Gives the OpenCode key and the raw body, or the refusal. */
async function readModelRequest(request: Request, env: Env, maxBytes = MAX_BODY_BYTES): Promise<{ key: string; raw: string } | Response> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, { Allow: 'POST' })
  if (!(await codeMatches(bearer(request), env.ACCESS_CODE))) return json({ error: 'bad-code' }, 401)
  const key = env.OPENCODE_API_KEY
  if (!key) return json({ error: 'no-suggest-key' }, 503)
  const declared = Number(request.headers.get('Content-Length'))
  if (declared > maxBytes) return json({ error: 'too-large' }, 413)
  const raw = await request.text()
  if (new TextEncoder().encode(raw).length > maxBytes) return json({ error: 'too-large' }, 413)
  return { key, raw }
}

/** A language code from the body: undefined when absent, null when present but not on the list. */
function readLanguage(v: unknown): string | undefined | null {
  if (v === undefined || v === null) return undefined
  return isLanguage(v) ? v : null
}

async function handleSuggest(request: Request, env: Env): Promise<Response> {
  const read = await readModelRequest(request, env)
  if (read instanceof Response) return read
  const { key, raw } = read
  let lines: string[]
  let context = ''
  let languages = { callLanguage: 'en', userLanguage: 'ru' as string | undefined }
  try {
    const body = JSON.parse(raw) as { lines?: unknown; context?: unknown; callLanguage?: unknown; userLanguage?: unknown }
    if (!body || !Array.isArray(body.lines) || !body.lines.every((l) => typeof l === 'string')) throw new Error('lines')
    lines = body.lines as string[]
    if (typeof body.context === 'string') context = body.context
    const call = readLanguage(body.callLanguage)
    const user = readLanguage(body.userLanguage)
    if (call === null || user === null) throw new Error('language')
    // A call language without a user language means translation is off.
    if (call) languages = { callLanguage: call, userLanguage: user }
    else if (user) languages = { callLanguage: 'en', userLanguage: user }
    if (!lines.length || lines.length > MAX_LINES_IN || lines.some((l) => l.length > MAX_LINE_CHARS) || context.length > MAX_CONTEXT_IN) {
      throw new Error('limits')
    }
  } catch {
    return json({ error: 'bad-request' }, 400)
  }
  const messages = buildMessages(context, lines, languages)
  try {
    const res = await askOpenCode(key, messages, SUGGEST_CALL)
    if (!res.ok || !res.body) {
      void res.body?.cancel()
      return json({ error: 'upstream' }, 502)
    }
    return new Response(res.body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  } catch {
    return json({ error: 'upstream' }, 502)
  }
}

async function handleChapters(request: Request, env: Env): Promise<Response> {
  const read = await readModelRequest(request, env)
  if (read instanceof Response) return read
  const { key, raw } = read
  let paragraphs: string[]
  let openTitle = ''
  let language = 'ru'
  try {
    const body = JSON.parse(raw) as { paragraphs?: unknown; openTitle?: unknown; language?: unknown }
    if (!body || !Array.isArray(body.paragraphs) || !body.paragraphs.every((p) => typeof p === 'string')) throw new Error('paragraphs')
    paragraphs = body.paragraphs as string[]
    if (body.openTitle !== undefined && body.openTitle !== null) {
      if (typeof body.openTitle !== 'string' || body.openTitle.length > MAX_CHAPTER_TITLE_CHARS) throw new Error('openTitle')
      openTitle = body.openTitle
    }
    const lang = readLanguage(body.language)
    if (lang === null) throw new Error('language')
    if (lang) language = lang
    if (!paragraphs.length || paragraphs.length > MAX_CHAPTER_PARAGRAPHS || paragraphs.some((p) => p.length > MAX_CHAPTER_PARAGRAPH_CHARS) || paragraphs.join('').length > MAX_CHAPTER_WINDOW_CHARS) {
      throw new Error('limits')
    }
  } catch {
    return json({ error: 'bad-request' }, 400)
  }
  const messages = buildChapterMessages(paragraphs, openTitle, language)
  try {
    const content = await askForText(key, messages, CHAPTERS_CALL)
    if (!content) return json({ error: 'upstream' }, 502)
    const chapters = parseChapters(content, paragraphs.length)
    if (!chapters.length) return json({ error: 'upstream' }, 502)
    return json({ chapters }, 200)
  } catch {
    return json({ error: 'upstream' }, 502)
  }
}

async function handleSummary(request: Request, env: Env): Promise<Response> {
  const read = await readModelRequest(request, env, MAX_SUMMARY_BODY_BYTES)
  if (read instanceof Response) return read
  const { key, raw } = read
  let lines: string[]
  let context = ''
  let languages = { callLanguage: 'en', language: 'ru' }
  try {
    const body = JSON.parse(raw) as { lines?: unknown; context?: unknown; callLanguage?: unknown; language?: unknown }
    if (!body || !Array.isArray(body.lines) || !body.lines.every((l) => typeof l === 'string')) throw new Error('lines')
    lines = body.lines as string[]
    const call = readLanguage(body.callLanguage)
    const lang = readLanguage(body.language)
    if (call === null || lang === null) throw new Error('language')
    languages = { callLanguage: call ?? 'en', language: lang ?? 'ru' }
    if (body.context !== undefined && body.context !== null) {
      if (typeof body.context !== 'string' || body.context.length > MAX_CONTEXT_CHARS) throw new Error('context')
      context = body.context
    }
    if (!lines.length || lines.length > MAX_SUMMARY_LINES || lines.join('').length > MAX_SUMMARY_CHARS) throw new Error('limits')
  } catch {
    return json({ error: 'bad-request' }, 400)
  }
  const messages = buildSummaryMessages(lines, context, languages)
  try {
    const content = await askForText(key, messages, SUMMARY_CALL)
    if (!content) return json({ error: 'upstream' }, 502)
    const parsed = parseSummary(content, languages.language)
    if (!parsed) return json({ error: 'upstream' }, 502)
    // People only as the call or the call notes named them; owners only as the call named them.
    return json({ summary: groundSummary(parsed, lines, context) }, 200)
  } catch {
    return json({ error: 'upstream' }, 502)
  }
}

async function handleAsk(request: Request, env: Env): Promise<Response> {
  const read = await readModelRequest(request, env, MAX_ASK_BODY_BYTES)
  if (read instanceof Response) return read
  const { key, raw } = read
  let sources: string
  let question: string
  const history: AskTurn[] = []
  let language = 'en'
  try {
    const body = JSON.parse(raw) as { sources?: unknown; question?: unknown; history?: unknown; language?: unknown }
    if (!body || typeof body.sources !== 'string' || typeof body.question !== 'string') throw new Error('shape')
    sources = body.sources
    question = body.question
    if (!sources.trim() || sources.length > MAX_ASK_SOURCES_CHARS) throw new Error('sources')
    if (!question.trim() || question.length > MAX_ASK_QUESTION_CHARS) throw new Error('question')
    if (body.history !== undefined && body.history !== null) {
      if (!Array.isArray(body.history) || body.history.length > MAX_ASK_HISTORY_TURNS) throw new Error('history')
      for (const t of body.history as unknown[]) {
        const turn = t as { question?: unknown; answer?: unknown } | null
        if (!turn || typeof turn.question !== 'string' || typeof turn.answer !== 'string') throw new Error('turn')
        if (turn.question.length > MAX_ASK_TURN_CHARS || turn.answer.length > MAX_ASK_TURN_CHARS) throw new Error('turn')
        history.push({ question: turn.question, answer: turn.answer })
      }
    }
    const lang = readLanguage(body.language)
    if (lang === null) throw new Error('language')
    if (lang) language = lang
  } catch {
    return json({ error: 'bad-request' }, 400)
  }
  const messages = buildAskMessages(sources, question, history, language)
  try {
    const content = await askForText(key, messages, ASK_CALL)
    const answer = content ? cleanAnswer(content) : ''
    if (!answer) return json({ error: 'upstream' }, 502)
    return json({ answer }, 200)
  } catch {
    return json({ error: 'upstream' }, 502)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/token') return handleToken(request, env)
    if (pathname === '/api/suggest') return handleSuggest(request, env)
    if (pathname === '/api/chapters') return handleChapters(request, env)
    if (pathname === '/api/summary') return handleSummary(request, env)
    if (pathname === '/api/ask') return handleAsk(request, env)
    return json({ error: 'not-found' }, 404)
  }
}
