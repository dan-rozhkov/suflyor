export const WATCHDOG_INTERVAL_MS = 2000
export const RESUME_AFTER_MS = 4000
export const LOST_AFTER_MS = 8000

export type WatchdogAction = 'none' | 'resume' | 'lost'

/** What to do when no PCM frame has arrived for `sinceLastFrameMs`. */
export function watchdogAction(sinceLastFrameMs: number): WatchdogAction {
  if (sinceLastFrameMs >= LOST_AFTER_MS) return 'lost'
  if (sinceLastFrameMs >= RESUME_AFTER_MS) return 'resume'
  return 'none'
}
