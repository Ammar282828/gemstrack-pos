/**
 * When Google says a model is exhausted, the next one answers at once.
 *
 * The Vertex AI key's quotas are per model: on 2026-10-01 gemini-3.1-pro-preview answered every
 * call with 429 "Resource has been exhausted" for over an hour with no traffic at all, while
 * 3.6-flash, 3.8-flash, 2.5-flash and the image model all answered. Write with AI waited out
 * its three retries (50 s) on the exhausted model and failed; the bill and parchi scanners,
 * also on 3.1 Pro, would have too. So a model that answers 429 is passed over for the next in
 * its chain straight away, and kept at the back for five minutes on this server instance, so
 * the next call doesn't spend a round trip learning it again. Only the last model in a chain
 * waits out a rate limit.
 *
 * Used by both callers of the key: social/ai.ts and voice/gemini.ts.
 */

export const COOL_MS = 5 * 60_000;
const cooling = new Map<string, number>();

export const markExhausted = (model: string, now = Date.now()) => { cooling.set(model, now + COOL_MS); };
export const isCooling = (model: string, now = Date.now()) => (cooling.get(model) ?? 0) > now;

/** The models to try, in order: duplicates and blanks gone, any still cooling moved to the back (still tried, last). */
export function modelOrder(chain: (string | undefined | null)[], now = Date.now()): string[] {
  const uniq = [...new Set(chain.filter((m): m is string => !!m && !!m.trim()).map(m => m.trim()))];
  return [...uniq.filter(m => !isCooling(m, now)), ...uniq.filter(m => isCooling(m, now))];
}

/** For tests. */
export const forgetCooling = () => cooling.clear();
