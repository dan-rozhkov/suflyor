import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Utterance } from '@shared/types'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDownIcon } from './Icons'
import { spring, tap } from '../motion'
import { englishForHero, splitLast } from '../state/sentences'

const NEAR_BOTTOM = 32

export function Transcript({ utterances, empty }: { utterances: Utterance[]; empty: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const stuck = useRef(true)
  /** True while our own smooth scroll to the bottom is animating. */
  const jumping = useRef(false)
  const jumpTimer = useRef<number>(undefined)
  const [away, setAway] = useState(false)

  const toBottom = useCallback((smooth: boolean) => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animate = smooth && !reduce
    jumping.current = animate
    window.clearTimeout(jumpTimer.current)
    if (animate) jumpTimer.current = window.setTimeout(() => { jumping.current = false }, 900)
    el.scrollTo({ top: el.scrollHeight, behavior: animate ? 'smooth' : 'auto' })
    stuck.current = true
    setAway(false)
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
    // Mid-animation positions are not "away": keep following until the jump lands or the user takes over.
    if (jumping.current) {
      if (near) jumping.current = false
      return
    }
    stuck.current = near
    setAway(!near)
  }, [])

  const cancelJump = useCallback(() => {
    jumping.current = false
  }, [])
  useEffect(() => () => window.clearTimeout(jumpTimer.current), [])

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, [utterances])

  // The tray growing shrinks the feed without a scroll event, so stay pinned on resize too.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="feed-wrap">
      <div className="feed" ref={ref} onScroll={onScroll} onWheel={cancelJump} onTouchStart={cancelJump} role="log" aria-label="Translation" aria-live="off" tabIndex={0}>
        {utterances.length === 0 ? (
          <div className="feed-empty">{empty}</div>
        ) : (
          utterances.map((u, i) => {
            const latest = i === utterances.length - 1
            const cls = latest ? 'utt utt-latest' : 'utt'
            // Enter only: streaming text inside a reply must land instantly, so no layout animation here.
            return (
              <motion.article key={u.id} className={cls} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
                {latest ? <Latest ru={u.ru} en={u.en} /> : <p className="utt-ru" lang="ru">{u.ru || '…'}</p>}
              </motion.article>
            )
          })
        )}
      </div>
      <AnimatePresence>
        {away && (
          <motion.button
            type="button"
            className="jump"
            onClick={() => toBottom(true)}
            whileTap={tap}
            initial={{ opacity: 0, y: 8, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 8, x: '-50%', transition: { duration: 0.15, ease: 'easeOut' } }}
            transition={spring}
          >
            <ArrowDownIcon />
            Latest
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Latest utterance: earlier sentences stay muted, only the last one is hero size. Plain text, so streaming lands instantly. */
function Latest({ ru, en }: { ru: string; en: string }) {
  const { head, last } = splitLast(ru)
  const enLast = englishForHero(ru, en)
  return (
    <>
      {head && <p className="utt-ru" lang="ru">{head}</p>}
      <p className="utt-ru utt-hero" lang="ru">{last || '…'}</p>
      {enLast && <p className="utt-en" lang="en">{enLast}</p>}
    </>
  )
}
