/**
 * AI keys work only while this house's Firestore is locked (docs/features/ai-keys.md, decisions: Taheri sign-in).
 * A key is checked against a record in `app_private`; while the database rules are open, anyone on the internet
 * can write that collection, forge a key record or a token hash, and so hold a working key — posts:publish
 * included. So before any key is honoured the server asks Firestore, as a stranger would, whether it may list
 * `app_private`: 200 means the rules are open, 401/403 that they are locked. Anything else (no answer, a network
 * error, a missing project id or web key) is "unknown", and keys are refused then too — closed, never open.
 *
 * Open is remembered ten minutes, locked an hour (publishing the rules takes effect within ten minutes here);
 * unknown is not remembered. The Studio's old tstudio_ keys are not covered (board.ts). Server-only.
 */

export type RulesState = 'locked' | 'open' | 'unknown';

const OPEN_MS = 10 * 60_000;
const LOCKED_MS = 60 * 60_000;
const TIMEOUT_MS = 4_000;

export const PAUSED_MESSAGE = 'AI keys are paused: this shop’s database rules aren’t published yet — publish firestore.rules in the Firebase console, then keys work at once.';
export const UNKNOWN_MESSAGE = 'AI keys can’t be checked just now: the database’s rules could not be read. Try again in a minute.';

let remembered: { state: Exclude<RulesState, 'unknown'>; until: number } | null = null;

/** Forget the remembered answer (tests; and after the owner says the rules are published). */
export function forgetRulesState(): void { remembered = null; }

type Fetch = (url: string, init: { signal: AbortSignal; cache: 'no-store' }) => Promise<{ status: number }>;

/** Is this house's database locked to strangers? Asked anonymously, as anyone on the internet could. */
export async function databaseRules(o: { now?: number; fetcher?: Fetch; env?: NodeJS.ProcessEnv } = {}): Promise<RulesState> {
  const now = o.now ?? Date.now();
  if (remembered && remembered.until > now) return remembered.state;
  const env = o.env ?? process.env;
  const project = (env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '').trim();
  const webKey = (env.NEXT_PUBLIC_FIREBASE_API_KEY || '').trim();
  if (!project || !webKey) return 'unknown';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/app_private`
    + `?pageSize=1&mask.fieldPaths=__name__&key=${encodeURIComponent(webKey)}`;
  let status: number;
  try {
    status = (await (o.fetcher ?? (fetch as unknown as Fetch))(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })).status;
  } catch {
    return 'unknown';
  }
  const state: RulesState = status === 200 ? 'open' : status === 401 || status === 403 ? 'locked' : 'unknown';
  if (state !== 'unknown') remembered = { state, until: now + (state === 'open' ? OPEN_MS : LOCKED_MS) };
  if (state === 'open') console.warn('[agent] AI keys refused: the Firestore rules are open (app_private is listable anonymously).');
  return state;
}

/** May any AI key be honoured now? */
export async function keysAllowed(o?: Parameters<typeof databaseRules>[0]): Promise<{ ok: true } | { ok: false; state: 'open' | 'unknown'; message: string }> {
  const state = await databaseRules(o);
  if (state === 'locked') return { ok: true };
  return { ok: false, state, message: state === 'open' ? PAUSED_MESSAGE : UNKNOWN_MESSAGE };
}
