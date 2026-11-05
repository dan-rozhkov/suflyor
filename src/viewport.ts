/** The tallest status bar on an iPhone is about 62 pt. A larger shortfall means iOS took the bar off twice. */
const STATUS_BAR_MAX = 70

/**
 * An installed iOS app without a translucent status bar can get a layout area that ends well above the screen edge.
 * iOS leaves that strip empty, so it already gives the space that the page would otherwise add under its buttons.
 */
export function rootIsShort(screenHeight: number, rootHeight: number): boolean {
  return screenHeight - rootHeight > STATUS_BAR_MAX
}
