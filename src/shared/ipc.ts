/** IPC channel names. Single source of truth for main, preload, renderer. */
export const IPC = {
  // renderer -> main, invoke (request/response)
  sessionStart: 'session:start',
  sessionStop: 'session:stop',
  sessionGetStatus: 'session:get-status',
  suggestionsRequest: 'suggestions:request',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  contextGet: 'context:get',
  contextPick: 'context:pick',
  contextLoadPath: 'context:load-path',
  contextClear: 'context:clear',
  systemOpenScreenSettings: 'system:open-screen-settings',

  // main -> renderer, events
  sessionStatus: 'session:status',
  utteranceUpdate: 'utterance:update',
  suggestionUpdate: 'suggestion:update',
  appError: 'app:error'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
