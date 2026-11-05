import type { AppError, ContextFile, SessionStatus, SettingsView, Suggestion, Utterance } from '@shared/types'

export interface ScreenState {
  status: SessionStatus
  settings: SettingsView
  context: ContextFile | null
  utterances: Utterance[]
  suggestion: Suggestion | null
  error: AppError | null
  settingsOpen: boolean
}

const keysOk = { soniox: true, opencode: true }
const baseSettings: SettingsView = { model: 'deepseek-v4.1-flash', autoSuggest: true, alwaysOnTop: true, keys: keysOk }

const utterances: Utterance[] = [
  { id: 'u1', en: 'Thanks for joining. Before we start, can you walk me through your last project?', ru: 'Спасибо, что присоединились. Перед началом расскажите о вашем последнем проекте.', isFinal: true },
  { id: 'u2', en: 'Specifically, what was your role in the migration to the new platform?', ru: 'В частности, какова была ваша роль в переходе на новую платформу?', isFinal: true },
  { id: 'u3', en: 'And how did you handle the disagreements within the team', ru: 'И как вы решали разногласия внутри команды', isFinal: false }
]

const suggestion: Suggestion = {
  id: 's1',
  utteranceId: 'u2',
  trigger: 'auto',
  status: 'done',
  options: [
    'I led the migration of the design system and coordinated with three teams.',
    'I owned the frontend part and helped unblock the backend team.',
    'Let me give you a concrete example.'
  ],
  meaningRu: 'Расскажите о своей роли: вы вели миграцию дизайн-системы и координировали три команды.'
}

const monologue: Utterance[] = [
  { id: 'm1', en: 'Thanks for making time.', ru: 'Спасибо, что нашли время.', isFinal: true },
  {
    id: 'm2',
    en: 'We are building Lumora, a lamp that adjusts its light to your daily rhythm. The first batch shipped in March and the feedback was mixed. Many people love the warm evening mode. Others say the app setup takes too long and the sensor misreads bright rooms. Before we decide on the next release, I would like to hear how you would approach this',
    ru: 'Мы делаем Lumora — лампу, которая подстраивает свет под ваш распорядок дня. Первая партия ушла в марте, и отзывы получились неоднозначными. Многим нравится тёплый вечерний режим. Другие говорят, что настройка через приложение занимает слишком много времени, а датчик ошибается в ярких комнатах. Прежде чем мы решим, что будет в следующем релизе, я хотел бы услышать, как бы вы подошли к этой задаче',
    isFinal: false
  }
]

const idle: SessionStatus = { state: 'idle', demo: false }
const listening: SessionStatus = { state: 'listening', demo: false }
const ctx: ContextFile = { name: 'interview-notes.md', path: '/tmp/interview-notes.md', size: 4200 }

const empty: ScreenState = { status: idle, settings: baseSettings, context: null, utterances: [], suggestion: null, error: null, settingsOpen: false }

export const FIXTURES: Record<string, ScreenState> = {
  empty,
  listening: { ...empty, status: listening },
  thinking: { ...empty, status: listening, context: ctx, utterances: utterances.slice(0, 2), suggestion: { ...suggestion, status: 'streaming', options: [], meaningRu: '' } },
  'no-keys': { ...empty, settings: { ...baseSettings, keys: { soniox: false, opencode: false } } },
  'no-permission': {
    ...empty,
    status: { state: 'error', demo: false, error: { code: 'no-screen-permission', message: 'Screen and system audio recording is not allowed.' } }
  },
  reconnecting: {
    ...empty,
    status: { state: 'reconnecting', demo: false, error: { code: 'network', message: 'Lost connection. Reconnecting…' } },
    context: ctx,
    utterances: utterances.slice(0, 2),
    suggestion
  },
  error: {
    ...empty,
    status: listening,
    context: ctx,
    utterances: utterances.slice(0, 2),
    error: { code: 'api', message: 'Too many OpenCode requests. Try again soon.' }
  },
  settings: { ...empty, settingsOpen: true, settings: { ...baseSettings, keys: { soniox: true, opencode: false } } },
  monologue: { ...empty, status: listening, context: ctx, utterances: monologue, suggestion: { ...suggestion, utteranceId: 'm2' } },
  live: { ...empty, status: listening, context: ctx, utterances, suggestion }
}

/** Dev-only: `#state=<name>` renders fixture data without calling main. */
export function readFixture(): ScreenState | null {
  if (!import.meta.env.DEV) return null
  const m = /state=([\w-]+)/.exec(window.location.hash)
  return m ? (FIXTURES[m[1]] ?? null) : null
}
