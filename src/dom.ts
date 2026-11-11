export type Child = Node | string | null | false | undefined
type Attrs = Record<string, string | boolean | null | undefined>

/**
 * Builds an element. Strings become text nodes, never markup, so untrusted text is safe.
 * An attribute set to false, null or undefined is left out; true sets an empty attribute.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue
    el.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids) if (kid !== null && kid !== false && kid !== undefined) el.append(kid)
  return el
}

/** A span that holds one of our own svg icons. */
export function iconEl(svg: string, cls = ''): HTMLElement {
  const s = document.createElement('span')
  if (cls) s.className = cls
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = svg
  return s
}
