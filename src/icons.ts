import alert from './icons/alert.svg?raw'
import check from './icons/check.svg?raw'
import chevronDown from './icons/chevron-down.svg?raw'
import close from './icons/close.svg?raw'
import more from './icons/more.svg?raw'
import paperclip from './icons/paperclip.svg?raw'
import record from './icons/record.svg?raw'
import refresh from './icons/refresh.svg?raw'
import spark from './icons/spark.svg?raw'
import stop from './icons/stop.svg?raw'

// Only the icons the app uses are imported, so the rest of the pack stays out of the bundle.
// The files end with a newline: trimmed here so no icon adds a stray text node.
export const ICON_RECORD = record.trim()
export const ICON_STOP = stop.trim()
export const ICON_SPARK = spark.trim()
export const ICON_CHECK = check.trim()
export const ICON_CHEVRON_DOWN = chevronDown.trim()
export const ICON_CLOSE = close.trim()
export const ICON_MORE = more.trim()
export const ICON_PAPERCLIP = paperclip.trim()
export const ICON_ALERT = alert.trim()
export const ICON_REFRESH = refresh.trim()
