/** Shared by the page and the Worker: the size of one question about saved notes. */
export const MAX_ASK_SOURCES_CHARS = 60_000
export const MAX_ASK_QUESTION_CHARS = 1000
export const MAX_ASK_HISTORY_TURNS = 10
export const MAX_ASK_TURN_CHARS = 4000
/** Sources, question and history at three bytes a character (Hindi, Thai, Chinese), with room for the JSON around them. */
export const MAX_ASK_BODY_BYTES = 512 * 1024
