/**
 * The delete code, browser side: `await askDeleteCode('Delete invoice INV-000077')` before any
 * delete (owner, 2026-10-01: "add ability to delete … anything — just make it a verification
 * thing to do that"). The dialog (components/shared/delete-code-dialog.tsx) asks for the code and
 * the server checks it (/api/auth/delete-code); the code itself never reaches the browser.
 *
 * Asked in the store's delete actions, not in each button, so every way in — a page, the
 * activity log's undo, a delete inside another — is covered. A right code holds for two minutes:
 * clearing several things in a row, or a delete that runs another inside it, asks once.
 */

export const DELETE_CODE_GRACE_MS = 2 * 60_000;

type Asker = (what: string) => Promise<boolean>;
let asker: Asker | null = null;
let okUntil = 0;
let pending: Promise<boolean> | null = null;

/** The dialog registers itself here once mounted; returns the unregister. */
export function registerDeleteCodeAsker(fn: Asker): () => void {
  asker = fn;
  return () => { if (asker === fn) asker = null; };
}

/** True once the code has been given (or was given in the last two minutes); false if refused. */
export async function askDeleteCode(what: string, now = Date.now()): Promise<boolean> {
  if (now < okUntil) return true;
  // Two deletes asking at once share one dialog.
  if (pending) return pending;
  if (!asker) return false; // no dialog on this page: refuse rather than delete unasked
  pending = asker(what).then(ok => {
    if (ok) okUntil = Date.now() + DELETE_CODE_GRACE_MS;
    return ok;
  }).finally(() => { pending = null; });
  return pending;
}

/** Forget a given code (tests; signing out). */
export function resetDeleteCode(): void { okUntil = 0; pending = null; }

/** What the store throws when the code was not given (store.ts requireDeleteCode). */
export const NOT_DELETED = 'Not deleted: the delete code was not entered.';

/** A failed delete, for a toast: a refused code says so; any other error keeps the page's own words. */
export function deleteErrorText(e: unknown, fallback?: string): string | undefined {
  return e instanceof Error && e.message === NOT_DELETED ? NOT_DELETED : fallback;
}
