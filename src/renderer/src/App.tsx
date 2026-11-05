import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '@base-ui/react/tooltip'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import './styles/app.css'
import { useSuflyor } from './state/useSuflyor'
import { Header } from './components/Header'
import { Transcript } from './components/Transcript'
import { Suggestions } from './components/Suggestions'
import { SettingsDialog } from './components/SettingsDialog'
import { Toasts } from './components/Toasts'
import { ControlBar } from './components/ControlBar'
import { sheetSpring, stagger, staggerItem } from './motion'

function Empty({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <motion.div key={id} className="state" initial="hidden" animate="visible" variants={stagger}>
      <motion.h1 className="state-title" variants={staggerItem}>{title}</motion.h1>
      <motion.p className="state-text" variants={staggerItem}>{text}</motion.p>
    </motion.div>
  )
}

export function App() {
  const a = useSuflyor()
  const [dragging, setDragging] = useState(false)
  const [panelHeight, setPanelHeight] = useState(0)
  const appRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); depth++; setDragging(true) } }
    const over = (e: DragEvent) => e.preventDefault()
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDragging(false) } }
    const drop = (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const f = e.dataTransfer?.files[0]
      if (f) void a.dropContext(f)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [a.dropContext])

  const { status, settings } = a
  // Soniox alone is enough to translate; replies just stay off without OpenCode.
  const noKeys = !status.demo && !settings.keys.soniox
  const noPermission = a.error?.code === 'no-screen-permission' || status.error?.code === 'no-screen-permission'
  const listening = status.state === 'listening'
  const running = listening || status.state === 'starting' || status.state === 'reconnecting'
  const toastError = a.error && a.error.code !== 'no-screen-permission' ? a.error : null

  let empty
  let action
  if (noPermission) {
    empty = <Empty id="permission" title="Allow audio access." text="Turn on Screen Recording for this app, then reopen it." />
    action = { label: 'Open System Settings', onClick: a.openPermissionSettings }
  } else if (noKeys) {
    empty = <Empty id="keys" title="Add your keys." text="Soniox translates. OpenCode suggests replies." />
    action = { label: 'Open Settings', onClick: () => a.setSettingsOpen(true) }
  } else if (running) {
    empty = <Empty id="listening" title="Listening." text="The translation appears here." />
  } else {
    empty = <Empty id="ready" title="Ready for your call." text="Drop a .md file to add context." />
  }

  return (
    <MotionConfig reducedMotion="user">
      <Tooltip.Provider delay={500}>
        <div className="app" ref={appRef}>
          <motion.main className="page" inert={a.settingsOpen} initial={false} animate={{ y: a.settingsOpen ? -panelHeight : 0 }} transition={sheetSpring}>
            <Header context={a.context} onPick={a.pickContext} onClear={a.clearContext} onSettings={() => a.setSettingsOpen(true)} />
            <Transcript utterances={a.utterances} empty={empty} />
            <Suggestions suggestion={a.suggestion} />
          </motion.main>
          {/* Outside the shifted, inert page: errors stay visible and the window stays draggable while Settings is open. */}
          <Toasts reconnecting={status.state === 'reconnecting'} error={toastError} onDismiss={a.dismissError} onOpenSettings={() => a.setSettingsOpen(true)} onOpenMicSettings={a.openMicSettings} />
          {a.settingsOpen && <div className="titlebar-drag settings-drag" aria-hidden="true" />}
          <ControlBar
            state={status.state}
            action={action}
            done={a.settingsOpen ? () => a.setSettingsOpen(false) : undefined}
            canSuggest={listening}
            suggesting={a.suggestion?.status === 'streaming'}
            onStart={a.start}
            onStop={a.stop}
            onSuggest={a.requestSuggestion}
            mic={status.demo || !settings.micEnabled ? undefined : { on: !a.mic.muted && (a.mic.active || a.mic.starting), pending: a.micPending, onToggle: a.toggleMic }}
          />
          <AnimatePresence>
            {dragging && (
              <motion.div className="drop" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                <span>Drop to add context</span>
              </motion.div>
            )}
          </AnimatePresence>
          <SettingsDialog open={a.settingsOpen} settings={settings} onOpenChange={a.setSettingsOpen} onSave={a.saveSettings} onHeight={setPanelHeight} container={appRef} />
        </div>
      </Tooltip.Provider>
    </MotionConfig>
  )
}
