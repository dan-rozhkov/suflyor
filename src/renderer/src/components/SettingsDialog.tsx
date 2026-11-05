import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Field } from '@base-ui/react/field'
import { Switch } from '@base-ui/react/switch'
import { AnimatePresence, motion } from 'motion/react'
import type { SettingsPatch, SettingsResult, SettingsView } from '@shared/types'

interface Props {
  open: boolean
  settings: SettingsView
  onOpenChange(open: boolean): void
  onSave(patch: SettingsPatch): Promise<SettingsResult>
  /** The panel lives under the page, which moves up by this many pixels. */
  onHeight(height: number): void
  container: RefObject<HTMLDivElement | null>
}

function KeyRow({ label, isSet, value, setValue, onSet, onClear }: {
  label: string
  isSet: boolean
  value: string
  setValue(v: string): void
  onSet(v: string): Promise<boolean>
  onClear(): Promise<boolean>
}) {
  // Clear takes two clicks: it appears where Save was, so a double click on Save must not wipe the key.
  const [armed, setArmed] = useState(false)
  const disarm = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(disarm.current), [])
  const submit = async () => {
    const v = value.trim()
    if (v && (await onSet(v))) setValue('')
  }
  const clear = () => {
    window.clearTimeout(disarm.current)
    if (armed) {
      setArmed(false)
      void onClear()
      return
    }
    setArmed(true)
    disarm.current = window.setTimeout(() => setArmed(false), 2500)
  }
  const dirty = !!value.trim()
  return (
    <Field.Root className="row">
      <Field.Label className="row-label">{label}</Field.Label>
      <Field.Control
        type="password"
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        placeholder={isSet ? 'Saved' : 'Paste key'}
        autoComplete="off"
        spellCheck={false}
      />
      {dirty ? (
        <button type="button" className="row-action" onClick={() => void submit()}>Save</button>
      ) : isSet ? (
        <button type="button" className={armed ? 'row-action row-action-danger' : 'row-action row-action-muted'} onClick={clear}>{armed ? 'Confirm' : 'Clear'}</button>
      ) : null}
    </Field.Root>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <Field.Root className="row">
      <Field.Label className="row-label">{label}</Field.Label>
      <Switch.Root className="switch" checked={checked} onCheckedChange={onChange}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
    </Field.Root>
  )
}

export function SettingsDialog({ open, settings, onOpenChange, onSave, onHeight, container }: Props) {
  const [model, setModel] = useState(settings.model)
  const [err, setErr] = useState<string | null>(null)
  // Key drafts live here so any close can save them, not only the row's own Save.
  const [drafts, setDrafts] = useState({ soniox: '', opencode: '' })
  // Focus the title, not the close button, so opening shows no focus ring.
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => setModel(settings.model), [settings.model, open])

  const observer = useRef<ResizeObserver>(null)
  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    if (!el) return
    onHeight(el.offsetHeight)
    observer.current = new ResizeObserver(() => onHeight(el.offsetHeight))
    observer.current.observe(el)
  }, [onHeight])

  const save = async (p: SettingsPatch) => {
    const r = await onSave(p)
    setErr(r.ok ? null : r.error.message)
    return r.ok
  }
  const committed = useRef(settings.model)
  committed.current = settings.model
  const commitModel = () => {
    const m = model.trim()
    if (!m) setModel(settings.model)
    else if (m !== committed.current) {
      committed.current = m // Enter then blur must not save twice.
      void save({ model: m })
    }
  }

  // Whatever closes the panel (Done, outside press, Escape), save pending input first.
  const latest = useRef({ drafts, commitModel, save })
  latest.current = { drafts, commitModel, save }
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open) {
      const { drafts: d, commitModel: commit, save: persist } = latest.current
      commit()
      const keys = [['soniox', 'sonioxKey'], ['opencode', 'opencodeKey']] as const
      for (const [name, field] of keys) {
        const v = d[name].trim()
        if (v) void persist({ [field]: v }).then((ok) => ok && setDrafts((x) => ({ ...x, [name]: '' })))
      }
    }
    wasOpen.current = open
  }, [open])

  return (
    <Dialog.Root
      modal={false}
      open={open}
      onOpenChange={(o, details) => {
        // modal={false} leaves focus-out closing on: Tab past the last control must not dismiss the panel.
        if (!o && details.reason === 'focus-out') {
          details.cancel()
          return
        }
        if (!o) setErr(null)
        onOpenChange(o)
      }}
    >
      <AnimatePresence>
        {open && (
          <Dialog.Portal keepMounted container={container}>
            {/* Base UI hides closed parts at once because it cannot see JS animation; AnimatePresence owns the exit. */}
            <Dialog.Popup
              ref={measure}
              initialFocus={titleRef}
              hidden={false}
              render={<motion.div className="sheet" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2, ease: 'easeOut' } }} transition={{ duration: 0.2, ease: 'easeOut' }} />}
            >
              <Dialog.Title ref={titleRef} tabIndex={-1} className="sheet-title">Settings</Dialog.Title>
              <div className="rows">
                <KeyRow label="Soniox" value={drafts.soniox} setValue={(v) => setDrafts((x) => ({ ...x, soniox: v }))} isSet={settings.keys.soniox} onSet={(v) => save({ sonioxKey: v })} onClear={() => save({ sonioxKey: null })} />
                <KeyRow label="OpenCode" value={drafts.opencode} setValue={(v) => setDrafts((x) => ({ ...x, opencode: v }))} isSet={settings.keys.opencode} onSet={(v) => save({ opencodeKey: v })} onClear={() => save({ opencodeKey: null })} />
                <Field.Root className="row">
                  <Field.Label className="row-label">Model</Field.Label>
                  <Field.Control
                    className="input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    onBlur={commitModel}
                    onKeyDown={(e) => e.key === 'Enter' && commitModel()}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </Field.Root>
                <ToggleRow label="Auto suggestions" checked={settings.autoSuggest} onChange={(v) => void save({ autoSuggest: v })} />
                <ToggleRow label="Microphone" checked={settings.micEnabled} onChange={(v) => void save({ micEnabled: v })} />
                <ToggleRow label="Always on top" checked={settings.alwaysOnTop} onChange={(v) => void save({ alwaysOnTop: v })} />
              </div>
              {err && <p className="sheet-error" role="alert">{err}</p>}
            </Dialog.Popup>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
