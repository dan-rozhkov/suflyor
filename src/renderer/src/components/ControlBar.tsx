import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { SessionState } from '@shared/types'
import { MicIcon, MicOffIcon, SparkIcon, StopIcon } from './Icons'
import { Tip } from './Tip'
import { softExit, spring, tap } from '../motion'

function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    const started = Date.now()
    setSeconds(0)
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => {
      window.clearInterval(t)
      setSeconds(0)
    }
  }, [active])
  const sec = String(seconds % 60).padStart(2, '0')
  const min = Math.floor(seconds / 60)
  return min < 60 ? `${min}:${sec}` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}:${sec}`
}

const enter = { initial: { opacity: 0, y: 12, filter: 'blur(4px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, exit: softExit, transition: spring }

/** Idle: one full-width action. Running: suggest, timer, stop. */
export function ControlBar({ state, action, done, canSuggest, suggesting, mic, onStart, onStop, onSuggest }: {
  state: SessionState
  action?: { label: string; onClick(): void }
  /** Settings are open: the bar closes them instead of controlling the session. */
  done?(): void
  canSuggest: boolean
  suggesting: boolean
  /** Per-call mute. `on` is the real state (capturing or connecting, not muted). Omitted in demo mode and when the Settings switch is off. */
  mic?: { on: boolean; pending: boolean; onToggle(): void }
  onStart(): void
  onStop(): void
  onSuggest(): void
}) {
  const running = state !== 'idle' && state !== 'error'
  const elapsed = useElapsed(running)
  // aria-disabled, not disabled: focus stays on the button while it settles or the session stops.
  const micBlocked = !!mic && (mic.pending || state === 'stopping')
  const primary = done ? { label: 'Done', onClick: done } : action ?? { label: 'Start', onClick: onStart }
  return (
    <div className="bar">
      <AnimatePresence mode="popLayout" initial={false}>
        {running && !done ? (
          <motion.div key="live" className="bar-live" {...enter}>
            <div className="bar-group">
            <Tip label="Suggest a reply">
              <motion.button type="button" className="bar-round" onClick={onSuggest} disabled={!canSuggest} whileTap={canSuggest ? tap : undefined} aria-label="Suggest a reply">
                <span className={suggesting ? 'spark spark-live' : 'spark'}><SparkIcon /></span>
              </motion.button>
            </Tip>
            {mic && (
              <Tip label={mic.on ? 'Mute microphone' : 'Unmute microphone'}>
                <motion.button
                  type="button"
                  className={mic.on ? 'bar-round' : 'bar-round bar-round-off'}
                  onClick={() => { if (!micBlocked) mic.onToggle() }}
                  aria-disabled={micBlocked || undefined}
                  whileTap={micBlocked ? undefined : tap}
                  aria-pressed={mic.on}
                  aria-label="Microphone"
                >
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span key={mic.on ? 'on' : 'off'} className="mic-glyph" initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }} exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }} transition={spring}>
                      {mic.on ? <MicIcon /> : <MicOffIcon />}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              </Tip>
            )}
            </div>
            <div className="timer" role="status" aria-label={state === 'listening' ? 'Listening' : 'Connecting'}>
              <span className={state === 'listening' ? 'wave' : 'wave wave-idle'} aria-hidden="true"><i /><i /><i /></span>
              <span aria-hidden="true">{elapsed}</span>
            </div>
            <motion.button type="button" className="stop" onClick={onStop} disabled={state === 'stopping'} whileTap={tap} aria-label="Stop">
              <StopIcon />
            </motion.button>
          </motion.div>
        ) : (
          <motion.button key={primary.label} type="button" className="start" onClick={primary.onClick} whileTap={tap} {...enter}>
            {primary.label}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
