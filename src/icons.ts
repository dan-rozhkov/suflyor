import alert from './icons/alert.svg?raw'
import arrowLeft from './icons/arrow-left.svg?raw'
import arrowRight from './icons/arrow-right.svg?raw'
import arrowUp from './icons/arrow-up.svg?raw'
import calendar from './icons/calendar.svg?raw'
import check from './icons/check.svg?raw'
import checkSquare from './icons/check-square.svg?raw'
import chevronDown from './icons/chevron-down.svg?raw'
import clock from './icons/clock.svg?raw'
import close from './icons/close.svg?raw'
import more from './icons/more.svg?raw'
import paperclip from './icons/paperclip.svg?raw'
import plus from './icons/plus.svg?raw'
import record from './icons/record.svg?raw'
import refresh from './icons/refresh.svg?raw'
import spark from './icons/spark.svg?raw'
import stop from './icons/stop.svg?raw'
import translate from './icons/translate.svg?raw'
import trash from './icons/trash.svg?raw'

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
export const ICON_ARROW_LEFT = arrowLeft.trim()
export const ICON_ARROW_RIGHT = arrowRight.trim()
export const ICON_ARROW_UP = arrowUp.trim()
export const ICON_CALENDAR = calendar.trim()
export const ICON_CHECK_SQUARE = checkSquare.trim()
export const ICON_CLOCK = clock.trim()
export const ICON_PLUS = plus.trim()
export const ICON_TRANSLATE = translate.trim()
export const ICON_TRASH = trash.trim()
