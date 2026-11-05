/** The tallest status bar on an iPhone is about 62 pt. A larger shortfall means iOS took the bar off twice. */
const STATUS_BAR_MAX = 70

/**
 * An installed iOS app without a translucent status bar can get a layout area that ends above the screen edge:
 * the status bar height is taken off once for the top of the app and once more at the bottom.
 * Returns how far the root has to reach past that area, or 0 when it already ends at the edge.
 */
export function rootShortfall(screenHeight: number, rootHeight: number): number {
  const missing = screenHeight - rootHeight
  return missing > STATUS_BAR_MAX ? missing / 2 : 0
}
