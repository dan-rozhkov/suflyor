import { useCallback, useEffect, useRef, useState } from 'react'
import type { ContextResult, SettingsPatch, SettingsResult } from '@shared/types'
import { FIXTURES, readFixture, type ScreenState } from './fixtures'
import { isExpectedFile, staleAfter, upsertSuggestion, upsertUtterance } from './reducers'

export function useSuflyor() {
  const [fixture] = useState(readFixture)
  const [s, setS] = useState<ScreenState>(fixture ?? FIXTURES.empty)
  const patch = useCallback((p: Partial<ScreenState>) => setS((prev) => ({ ...prev, ...p })), [])
  const busy = useRef(false)

  useEffect(() => {
    if (fixture) return
    const api = window.suflyor
    let alive = true
    api.session.getStatus().then((status) => alive && patch({ status })).catch(() => {})
    api.settings.get().then((settings) => alive && patch({ settings })).catch(() => {})
    api.context.get().then((r) => alive && r.ok && patch({ context: r.context })).catch(() => {})
    const offs = [
      api.session.onStatus((status) => setS((p) => ({ ...p, status, error: status.state === 'listening' ? null : p.error }))),
      api.transcript.onUtterance((u) => setS((p) => ({ ...p, utterances: upsertUtterance(p.utterances, u), suggestion: staleAfter(p.suggestion, u) }))),
      api.suggestions.onUpdate((sg) => setS((p) => ({ ...p, suggestion: upsertSuggestion(p.suggestion, sg) }))),
      api.onError((error) => setS((p) => ({ ...p, error })))
    ]
    return () => {
      alive = false
      offs.forEach((off) => off())
    }
  }, [fixture, patch])

  const start = useCallback(async () => {
    if (fixture || busy.current) return
    busy.current = true
    const api = window.suflyor
    patch({ error: null, suggestion: null })
    try {
      patch({ status: await api.session.start() })
    } catch {
      patch({ error: { code: 'unknown', message: "Couldn't start. Try again." } })
    } finally {
      busy.current = false
    }
  }, [fixture, patch])

  const stop = useCallback(async () => {
    if (fixture) return
    try {
      patch({ status: await window.suflyor.session.stop() })
    } catch {
      patch({ error: { code: 'unknown', message: "Couldn't stop. Try again." } })
    }
  }, [fixture, patch])

  const requestSuggestion = useCallback(() => {
    if (!fixture) void window.suflyor.suggestions.request()
  }, [fixture])

  const applyContext = useCallback(
    (r: ContextResult) => {
      if (r.ok) patch({ context: r.context, error: null })
      else patch({ error: r.error })
    },
    [patch]
  )
  const pickContext = useCallback(async () => {
    if (!fixture) applyContext(await window.suflyor.context.pick())
  }, [fixture, applyContext])
  const clearContext = useCallback(async () => {
    if (!fixture) applyContext(await window.suflyor.context.clear())
    else patch({ context: null })
  }, [fixture, applyContext, patch])
  const dropContext = useCallback(
    async (file: File) => {
      if (!isExpectedFile(file.name)) {
        patch({ error: { code: 'context', message: 'Use a Markdown file (.md).' } })
        return
      }
      if (!fixture) applyContext(await window.suflyor.context.loadDropped(file))
    },
    [fixture, applyContext, patch]
  )

  const saveSettings = useCallback(
    async (p: SettingsPatch): Promise<SettingsResult> => {
      if (fixture) {
        const settings = { ...s.settings, ...p, keys: { ...s.settings.keys } }
        if (p.sonioxKey !== undefined) settings.keys.soniox = p.sonioxKey !== null
        if (p.opencodeKey !== undefined) settings.keys.opencode = p.opencodeKey !== null
        patch({ settings })
        return { ok: true, settings }
      }
      const r = await window.suflyor.settings.set(p)
      if (r.ok) patch({ settings: r.settings })
      return r
    },
    [fixture, s.settings, patch]
  )

  const openPermissionSettings = useCallback(() => {
    if (!fixture) void window.suflyor.system.openScreenRecordingSettings()
  }, [fixture])

  return {
    ...s,
    setSettingsOpen: (settingsOpen: boolean) => patch({ settingsOpen }),
    dismissError: () => patch({ error: null }),
    start, stop, requestSuggestion, pickContext, clearContext, dropContext, saveSettings, openPermissionSettings
  }
}
