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

/**
 * Copies text, called inside the tap: Safari allows the clipboard only during a user gesture, so the textarea
 * fallback runs only when the async API is missing, never after it fails.
 */
export function copyToClipboard(text: string): Promise<boolean> {
  const write = navigator.clipboard?.writeText(text)
  if (write) return write.then(() => true, () => false)
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.append(ta)
  ta.focus()
  ta.select()
  ta.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return Promise.resolve(ok)
}
