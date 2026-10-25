/** A follow-up to a plan already on the phone's screen ("change the amount to 50,000", "also add tea 300").
 *
 * The phone sends back what it was shown: the words and the model's own reading of them (`reading`, returned by
 * /api/voice/native). The model is then given that reading and the new words and asked for the whole corrected
 * reading, so one plan is refined rather than a second one started. Pure text in, text out: the route still runs the
 * result through listen and resolveIntent, so nothing here can reach a record or skip a check.
 */
export interface PreviousReading { words: string; reading: unknown }

const MAX_READING_CHARS = 6000;
const MAX_WORDS = 1000;

/** The previous plan from a request body, or null when it is absent or not usable (the sentence then stands alone). */
export function previousFrom(value: unknown): PreviousReading | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const words = typeof v.words === 'string' ? v.words.trim().slice(0, MAX_WORDS) : '';
  if (!words || !v.reading || typeof v.reading !== 'object') return null;
  let json: string;
  try { json = JSON.stringify(v.reading); } catch { return null; }
  if (!json || json.length > MAX_READING_CHARS) return null;
  return { words, reading: v.reading };
}

/** The sentence listen is given: the earlier words, the reading so far and the change asked for. */
export function refinedText(previous: PreviousReading, text: string): string {
  return [
    'The person is changing a request they made a moment ago.',
    `Their earlier words: "${previous.words}"`,
    `The reading so far (JSON): ${JSON.stringify(previous.reading)}`,
    `What they say now: "${text.trim()}"`,
    'Apply it to the reading above and give the whole corrected reading, keeping everything they did not change. '
      + 'If they only add something, keep the earlier steps and add the new ones.',
  ].join('\n');
}
