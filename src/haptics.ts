import { isInstalledApp } from './viewport'

export type HapticKind = 'switch' | 'vibrate' | null

export interface HapticEnv {
  userAgent: string
  platform: string
  maxTouchPoints: number
  installed: boolean
  canVibrate: boolean
}

/** Haptics are only for the installed app: in a browser tab they would be a surprise. */
export function hapticKind(env: HapticEnv): HapticKind {
  if (!env.installed) return null
  // An iPad asks for the desktop site and reports itself as a Mac, so touch points tell them apart.
  if (/iPad|iPhone|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1)) return 'switch'
  return env.canVibrate ? 'vibrate' : null
}

let cached: HapticKind | undefined

/** Read on first use, never at import: tests import this module in node, where there is no navigator. */
function kind(): HapticKind {
  if (cached === undefined) {
    cached = hapticKind({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
      installed: isInstalledApp(),
      canVibrate: typeof navigator.vibrate === 'function'
    })
  }
  return cached
}

/**
 * iOS has no vibrate, but toggling a switch input plays a system haptic. Since iOS 26.5 only a real tap does it,
 * so a transparent label over the button forwards the tap to a hidden switch.
 */
export function addHaptic(button: HTMLButtonElement): void {
  if (kind() !== 'switch' || button.querySelector(':scope > .haptic-tap')) return
  const label = document.createElement('label')
  label.className = 'haptic-tap'
  label.setAttribute('aria-hidden', 'true')
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.setAttribute('switch', '')
  input.tabIndex = -1
  input.className = 'haptic-switch'
  label.append(input)
  button.classList.add('haptic-host')
  button.append(label)
  let forwarded = false
  // No preventDefault: the label default action has to toggle the switch. The button's own listeners must not see this click.
  label.addEventListener('click', (e) => {
    e.stopPropagation()
    forwarded = false
    // This forwarding is undocumented: if iOS drops it, the tick goes but the button must still work.
    window.setTimeout(() => {
      if (!forwarded) button.click()
    })
  })
  // The action runs from here because the label default handler would swallow a form submit.
  input.addEventListener('click', (e) => {
    e.stopPropagation()
    forwarded = true
    button.click()
  })
}

/** A real switch needs no tap layer: with the attribute set, iOS plays the haptic on its own tap. */
export function addSwitchHaptic(input: HTMLInputElement): void {
  if (kind() === 'switch') input.setAttribute('switch', '')
}

/** Android and other browsers with vibrate: a short pulse on every enabled button and on the settings switch. */
export function addVibration(): void {
  if (kind() !== 'vibrate') return
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target
      if (target instanceof Element && target.closest('button:not(:disabled), input[role="switch"]')) navigator.vibrate(10)
    },
    true
  )
}
