import { useLayoutEffect, useRef, useState } from 'react'
import type { Transition } from 'motion/react'

/** Bounce stays 0: working controls settle, they never overshoot. */
export const spring: Transition = { type: 'spring', duration: 0.3, bounce: 0 }
export const sheetSpring: Transition = { type: 'spring', duration: 0.4, bounce: 0 }
export const tap = { scale: 0.96 }
/** Exits are shorter and softer than enters. */
export const softExit = { opacity: 0, y: -12, filter: 'blur(4px)', transition: { duration: 0.15, ease: 'easeOut' as const } }
/** Infrequent staged entrances only, such as empty states. */
export const stagger = { visible: { transition: { staggerChildren: 0.1 } } }
export const staggerItem = {
  hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: spring }
}

/** Tracks an element's rendered size, so a parent can spring to it. */
export function useMeasure<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setSize({ width: el.offsetWidth, height: el.offsetHeight })
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}
