/**
 * One change, once: the claim behind a request's name (`app_requests/<requestId>`).
 *
 * The phone names each change and may send it again (a double tap, a timeout whose answer was lost, a
 * relaunch). The claim records the change's life: `pending` while it is being written, `done` with the
 * answer once it has landed. The same name again then gets that answer back and writes nothing; a change
 * that failed gives its claim up, so the person's corrected retry goes through; a claim still `pending`
 * after two minutes belongs to a server that died mid-write (the OOM 503), and is taken over.
 *
 * Money operations REQUIRE a name on this route. Only the iPhone sends money here (the web ERP runs the
 * shared writes in lib/writes directly, in the browser, and sends no name), so nothing of the browser's
 * is refused; its two settings calls send a name and are claimed like any other.
 */

import { adminDb } from '@/lib/firebase-admin';

/** Every operation that moves money, or makes a record of it: a repeat of one must never write twice. */
export const MONEY_OP_NAMES: ReadonlySet<string> = new Set([
  'recordPayment', 'recordOrderAdvance', 'createInvoice', 'createOrder', 'finalizeOrder',
  'addRepair', 'recordRepairPayment', 'addExpense',
  'addHisaabEntry', 'addShareholderEntry', 'addExtraRevenue',
  'updateInvoiceDiscount', 'refundInvoicePartial', 'payBackCredit', 'settleInvoicePayment', 'settleOrderAdvance', 'raiseOrderDiscount',
  'startPayBatch', 'settlePayBatch',
]);

export const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
/** A claim still pending after this long was left by a write that died. */
export const STALE_PENDING_MS = 2 * 60_000;
/** Firestore's document limit is 1 MiB; an answer larger than this is not kept (the replay says so). */
const MAX_STORED = 700_000;

export type ClaimResult =
  | { kind: 'go' }
  | { kind: 'replay'; status: number; body: Record<string, unknown> }
  | { kind: 'busy' }
  | { kind: 'foreign' };

type ClaimDoc = { op?: string; by?: string; status?: string; at?: string; httpStatus?: number; result?: string };

const ref = (id: string) => adminDb.collection('app_requests').doc(id);

const isExists = (e: unknown) => (e as { code?: number }).code === 6;

export async function claimRequest(requestId: string, op: string, by: string): Promise<ClaimResult> {
  const fresh = () => ({
    op, by, status: 'pending', at: new Date().toISOString(), expireAt: new Date(Date.now() + 7 * 864e5),
  });
  try {
    await ref(requestId).create(fresh());
    return { kind: 'go' };
  } catch (e) {
    if (!isExists(e)) throw e;
  }
  const snap = await ref(requestId).get();
  const held = (snap.exists ? snap.data() : null) as ClaimDoc | null;
  if (!held) {
    // Gone between the two calls (a failed change gave it back): try once more.
    try { await ref(requestId).create(fresh()); return { kind: 'go' }; } catch (e) { if (isExists(e)) return { kind: 'busy' }; throw e; }
  }
  // A name is one person's, for one operation: another's use of it is never an answer to give out.
  if (held.by !== by || held.op !== op) return { kind: 'foreign' };
  if (held.status === 'done') {
    let body: Record<string, unknown> = { ok: true };
    try { if (held.result) body = JSON.parse(held.result); } catch { /* the marker answer */ }
    return { kind: 'replay', status: held.httpStatus ?? 200, body };
  }
  const age = Date.now() - Date.parse(held.at || '');
  if (held.status === 'failed' || !(age < STALE_PENDING_MS)) {
    // Taken over: delete, then create again. Of two retries racing for it only one create succeeds.
    await ref(requestId).delete().catch(() => undefined);
    try { await ref(requestId).create(fresh()); return { kind: 'go' }; } catch (e) { if (isExists(e)) return { kind: 'busy' }; throw e; }
  }
  return { kind: 'busy' };
}

/** The change landed: keep its answer, so the same name again is answered with it. */
export async function finishRequest(requestId: string, httpStatus: number, body: unknown): Promise<void> {
  let result = '';
  try { result = JSON.stringify(body); } catch { /* none kept */ }
  const doc = result && result.length <= MAX_STORED
    ? { status: 'done', httpStatus, result, doneAt: new Date().toISOString() }
    : { status: 'done', httpStatus, doneAt: new Date().toISOString() };
  for (let tries = 0; tries < 2; tries++) {
    try { await ref(requestId).set(doc, { merge: true }); return; } catch (e) { if (tries) console.error('[/api/app/write] claim not closed', e); }
  }
}

/** The change did not land: the name goes back, so the person's retry is a fresh try. */
export async function releaseRequest(requestId: string): Promise<void> {
  await ref(requestId).delete().catch(() => undefined);
}
