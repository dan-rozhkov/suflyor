/** Shared by the page and the Worker: the size of one summary request. */
/** About two hours of speech. A longer call sends only its latest part. */
export const MAX_SUMMARY_CHARS = 120_000
export const MAX_SUMMARY_LINES = 5000
/** The transcript and the call notes at three bytes a character (Hindi, Thai, Chinese), with room for the JSON around them. */
export const MAX_SUMMARY_BODY_BYTES = 480 * 1024
