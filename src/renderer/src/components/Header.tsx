import { motion } from 'motion/react'
import type { ContextFile } from '@shared/types'
import { CloseIcon, FileIcon, SettingsIcon } from './Icons'
import { Tip } from './Tip'
import { tap } from '../motion'

export function Header({ context, onPick, onClear, onSettings }: {
  context: ContextFile | null
  onPick(): void
  onClear(): void
  onSettings(): void
}) {
  return (
    <header className="header titlebar-drag">
      <div className="header-space" />
      {context ? (
        <span className="outline-pill">
          <button type="button" className="outline-main" onClick={onPick} title={context.name} aria-label={`Context: ${context.name}. Replace file`}>
            <span className="outline-name">{context.name}</span>
          </button>
          <Tip label="Remove context">
            <button type="button" className="outline-x" onClick={onClear} aria-label="Remove context"><CloseIcon /></button>
          </Tip>
        </span>
      ) : (
        <motion.button type="button" className="outline-pill outline-main" whileTap={tap} onClick={onPick}>
          <FileIcon />
          Context
        </motion.button>
      )}
      <Tip label="Settings">
        <motion.button type="button" className="round-btn" whileTap={tap} onClick={onSettings} aria-label="Settings">
          <SettingsIcon />
        </motion.button>
      </Tip>
    </header>
  )
}
