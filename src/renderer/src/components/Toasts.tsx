import { AnimatePresence, motion } from 'motion/react'
import type { AppError } from '@shared/types'
import { AlertIcon, RefreshIcon } from './Icons'
import { softExit, spring, tap } from '../motion'

const enter = { initial: { opacity: 0, y: -12, filter: 'blur(4px)' }, animate: { opacity: 1, y: 0, filter: 'blur(0px)' }, exit: softExit, transition: spring }

export function Toasts({ reconnecting, error, onDismiss, onOpenSettings, onOpenMicSettings }: {
  reconnecting: boolean
  error: AppError | null
  onDismiss(): void
  onOpenSettings(): void
  onOpenMicSettings(): void
}) {
  return (
    <div className="toasts">
      <AnimatePresence initial={false}>
        {reconnecting && (
          <motion.div key="reconnect" className="toast" role="status" {...enter}>
            <span className="toast-icon tone-orange"><RefreshIcon /></span>
            <span className="toast-text">Reconnecting. Some speech may be lost.</span>
          </motion.div>
        )}
        {error && (
          <motion.div key={`${error.code}:${error.message}`} className="toast" role="alert" {...enter}>
            <span className="toast-icon tone-red"><AlertIcon /></span>
            <span className="toast-text">{error.message}</span>
            {error.code === 'no-keys' ? (
              <motion.button type="button" className="toast-action" whileTap={tap} onClick={onOpenSettings}>Settings</motion.button>
            ) : error.code === 'no-mic-permission' ? (
              <>
                <motion.button type="button" className="toast-action" whileTap={tap} onClick={onOpenMicSettings}>System Settings</motion.button>
                <motion.button type="button" className="toast-action" whileTap={tap} onClick={onDismiss}>OK</motion.button>
              </>
            ) : (
              <motion.button type="button" className="toast-action" whileTap={tap} onClick={onDismiss}>OK</motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
