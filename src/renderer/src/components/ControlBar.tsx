import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { SessionState } from '@shared/types'
import { SparkIcon, StopIcon } from './Icons'
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
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const enter = { initial: { opacity: 0, y: 12, filter: 'blur(4px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, exit: softExit, transition: spring }

/** Idle: one full-width action. Running: suggest, timer, stop. */
export function ControlBar({ state, action, canSuggest, suggesting, onStart, onStop, onSuggest }: {
  state: SessionState
  action?: { label: string; onClick(): void }
  canSuggest: boolean
  suggesting: boolean
  onStart(): void
  onStop(): void
  onSuggest(): void
}) {
  const running = state !== 'idle' && state !== 'error'
  const elapsed = useElapsed(running)
  const primary = action ?? { label: 'Start', onClick: onStart }
  return (
    <div className="bar">
      <AnimatePresence mode="popLayout" initial={false}>
        {running ? (
          <motion.div key="live" className="bar-live" {...enter}>
            <Tip label="Suggest a reply">
              <motion.button type="button" className="bar-round" onClick={onSuggest} disabled={!canSuggest} whileTap={canSuggest ? tap : undefined} aria-label="Suggest a reply">
                <span className={suggesting ? 'spark spark-live' : 'spark'}><SparkIcon /></span>
              </motion.button>
            </Tip>
            <div className="timer" role="status" aria-label={state === 'listening' ? 'Listening' : 'Connecting'}>
              <span className={state === 'listening' ? 'wave' : 'wave wave-idle'} aria-hidden="true"><i /><i /><i /></span>
              <span aria-hidden="true">{elapsed}</span>
            </div>
            <motion.button type="button" className="stop" onClick={onStop} disabled={state === 'stopping'} whileTap={tap} aria-label="Stop">
              <StopIcon />
            </motion.button>
          </motion.div>
        ) : (
          <motion.button key="start" type="button" className="start" onClick={primary.onClick} whileTap={tap} {...enter}>
            {primary.label}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
