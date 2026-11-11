/** Hash routes. '' is the call screen; everything else is a saved-meetings view. */
export type MeetingTab = 'notes' | 'transcript'

export type Route =
  | { kind: 'call' }
  | { kind: 'meetings' }
  | { kind: 'meeting'; id: string; tab: MeetingTab }
  | { kind: 'actions' }
  | { kind: 'ask' }

export const CALL_ROUTE: Route = { kind: 'call' }

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** '#/meeting/m-1/transcript' to a route. Anything unknown is the call screen. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#/, '').split('/').filter(Boolean).map(decode)
  const [kind, id, tab] = parts
  switch (kind) {
    case 'meetings':
      return { kind: 'meetings' }
    case 'meeting':
      return id ? { kind: 'meeting', id, tab: tab === 'transcript' ? 'transcript' : 'notes' } : { kind: 'meetings' }
    case 'actions':
      return { kind: 'actions' }
    case 'ask':
      return { kind: 'ask' }
    default:
      return CALL_ROUTE
  }
}

/** The hash for a route. The call screen has none. */
export function routeHash(route: Route): string {
  switch (route.kind) {
    case 'call':
      return ''
    case 'meetings':
    case 'actions':
    case 'ask':
      return `#/${route.kind}`
    case 'meeting':
      return `#/meeting/${encodeURIComponent(route.id)}${route.tab === 'transcript' ? '/transcript' : ''}`
  }
}

/** A `#code=` link is for the page, not a route. */
export const isCodeHash = (hash: string): boolean => hash.startsWith('#code=')

export const sameRoute = (a: Route, b: Route): boolean => routeHash(a) === routeHash(b)

/** Where the back arrow goes when the page was opened on this view directly. */
export function parentRoute(route: Route): Route {
  switch (route.kind) {
    case 'meeting':
      return route.tab === 'transcript' ? { kind: 'meeting', id: route.id, tab: 'notes' } : { kind: 'meetings' }
    case 'actions':
      return { kind: 'meetings' }
    default:
      return CALL_ROUTE
  }
}

interface HistoryState {
  sfDepth?: number
}

export interface Router {
  current(): Route
  /** Pushes (or replaces) the entry and shows the route. */
  navigate(route: Route, replace?: boolean): void
  /** One step back when this page pushed the entry, else straight to the fallback. */
  back(fallback: Route): void
}

/** Listens to the address bar. `onRoute` runs for the first route too. */
export function startRouter(onRoute: (route: Route) => void): Router {
  const depth = (): number => ((history.state as HistoryState | null)?.sfDepth ?? 0)
  const here = (): Route => parseRoute(location.hash)
  let shown = routeHash(here())
  const show = (): void => {
    if (isCodeHash(location.hash)) return
    const r = here()
    const h = routeHash(r)
    if (h === shown) return
    shown = h
    onRoute(r)
  }
  // A `#code=` link is taken by the page (app.ts) and ignored here, so the current view stays.
  window.addEventListener('popstate', show)
  window.addEventListener('hashchange', show)
  const router: Router = {
    current: here,
    navigate(route, replace = false) {
      const url = location.pathname + location.search + routeHash(route)
      const state: HistoryState = { sfDepth: replace ? depth() : depth() + 1 }
      if (replace) history.replaceState(state, '', url)
      else history.pushState(state, '', url)
      shown = routeHash(route)
      onRoute(route)
    },
    back(fallback) {
      if (depth() > 0) history.back()
      else router.navigate(fallback, true)
    }
  }
  onRoute(here())
  return router
}
