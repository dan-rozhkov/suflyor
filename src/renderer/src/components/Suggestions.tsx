import { useEffect, useRef, useState } from 'react'
import { Collapsible } from '@base-ui/react/collapsible'
import { AnimatePresence, motion } from 'motion/react'
import type { Suggestion } from '@shared/types'
import { CheckIcon, ChevronIcon } from './Icons'
import { spring, tap, useMeasure } from '../motion'

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

function Option({ text, streaming }: { text: string; streaming: boolean }) {
  const [done, setDone] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    await copyText(text)
    setDone(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setDone(false), 1500)
  }
  return (
    <motion.li initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <motion.button type="button" className="opt" onClick={copy} whileTap={tap}>
        <span className="sr-only">{done ? 'Copied: ' : 'Copy: '}</span>
        <span className={streaming ? 'opt-text opt-text-live' : 'opt-text'}>{text}</span>
        <AnimatePresence initial={false}>
          {done && (
            <motion.span
              className="opt-check"
              initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
              transition={spring}
            >
              <CheckIcon />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </motion.li>
  )
}

/** One reply at a time: the rest wait behind a toggle, closed again for each new suggestion. */
function MoreReplies({ rest, streaming }: { rest: string[]; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="more">
        {open ? 'Hide' : `${rest.length} more`}
        <ChevronIcon />
      </Collapsible.Trigger>
      <Collapsible.Panel>
        <ul className="opts">
          {rest.map((o, i) => (
            <Option key={i} text={o} streaming={streaming && i === rest.length - 1} />
          ))}
        </ul>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}

export function Suggestions({ suggestion }: { suggestion: Suggestion | null }) {
  const streaming = suggestion?.status === 'streaming'
  const options = suggestion?.options ?? []
  const [innerRef, size] = useMeasure<HTMLDivElement>()
  return (
    <section className="replies" aria-label="Suggested replies">
      <span className="sr-only" role="status">{streaming ? 'Finding replies' : options.length ? 'Replies ready' : ''}</span>
      {/* Springs to its content height, so new replies never make the feed jump. */}
      <motion.div className="replies-body" initial={false} animate={size ? { height: size.height } : undefined} transition={spring} aria-busy={streaming}>
        <div ref={innerRef}>
          {streaming && options.length === 0 && (
            <div className="skeletons" aria-hidden="true"><span className="skeleton" /><span className="skeleton skeleton-short" /></div>
          )}
          {options.length > 0 && (
            <ul className="opts">
              <Option text={options[0]} streaming={streaming && options.length === 1} />
            </ul>
          )}
          {options.length > 1 && <MoreReplies key={suggestion!.id} rest={options.slice(1)} streaming={streaming} />}
        </div>
      </motion.div>
    </section>
  )
}
