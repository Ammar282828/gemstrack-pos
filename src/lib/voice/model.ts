/**
 * Which Gemini model the shop talks to.
 *
 * One constant, because Google retires these on a schedule and the app had already
 * gone stale without anyone noticing: it pinned gemini-2.0-flash, which now answers
 * 404 "no longer available" to every request. Voice and the scanner would have failed
 * the moment somebody pressed the microphone, with a message about models rather than
 * anything a jeweller could act on.
 *
 * Pinned rather than floating. `gemini-flash-latest` would survive the next retirement
 * on its own, but almost all of this feature's accuracy lives in a long prompt tuned
 * against one model's behaviour, and having that change silently under the counter is
 * worse than a build that has to be edited once a year.
 *
 * Overridable by env so a retirement can be answered without a deploy.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash';
