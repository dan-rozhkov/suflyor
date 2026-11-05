/** True when the page runs as an installed web app (Home Screen on iOS, installed PWA elsewhere). */
export interface StandaloneWindow {
  matchMedia?: (query: string) => { matches: boolean }
  navigator?: object
}

export function isStandalone(win: StandaloneWindow): boolean {
  try {
    if (win.matchMedia?.('(display-mode: standalone)').matches) return true
  } catch {
    // Fall through to the iOS flag.
  }
  return (win.navigator as { standalone?: boolean } | undefined)?.standalone === true
}

export interface InstallWindow extends StandaloneWindow {
  navigator?: { userAgent?: string; platform?: string; maxTouchPoints?: number }
}

/** iPhone and iPad have no install prompt, so the page explains Add to Home Screen. Other browsers offer their own. */
export function canAddToHomeScreen(win: InstallWindow): boolean {
  if (isStandalone(win)) return false
  const nav = win.navigator
  if (/iPhone|iPad|iPod/.test(nav?.userAgent ?? '')) return true
  // iPadOS reports itself as a Mac.
  return nav?.platform === 'MacIntel' && (nav?.maxTouchPoints ?? 0) > 1
}
