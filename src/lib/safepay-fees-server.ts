/** The daily Safepay fees run (lib/safepay-fees.ts) against the house's database. Server only. */
import { adminDb } from '@/lib/firebase-admin';
import { feeExpense, feesByMonth, fetchCharge, listPaidTrackers, openSecret, sealSecret, type Charge } from '@/lib/safepay-fees';

/** Read when needed, never at import (the write route's tests load this module with a stand-in database). */
const PRIVATE = () => adminDb.collection('app_private').doc('safepay');

export async function saveSafepaySecret(secret: string): Promise<void> {
  await PRIVATE().set(secret ? { secret: sealSecret(secret.trim()), at: new Date().toISOString() } : { secret: null, at: new Date().toISOString() }, { merge: true });
}

export async function safepaySecret(): Promise<string | null> {
  const sealed = (await PRIVATE().get()).data()?.secret;
  return typeof sealed === 'string' ? openSecret(sealed) : null;
}

export const safepaySecretSet = async () => !!(await safepaySecret());

/** Once a day: new payments' charges kept, each month's fees written as its one expense. */
export async function syncSafepayFees(now = new Date(), force = false) {
  const secret = await safepaySecret();
  if (!secret) return null;
  const state = adminDb.collection('shopify_sync').doc('safepay-fees');
  const last = (await state.get()).data()?.at as string | undefined;
  if (!force && last && now.getTime() - Date.parse(last) < 24 * 3600_000) return null;

  const trackers = await listPaidTrackers(secret);
  const kept = adminDb.collection('safepay_charges');
  const have = new Map<string, Charge>();
  for (const snap of (await kept.get()).docs) have.set(snap.id, snap.data() as Charge);
  const fresh: string[] = [];
  for (const t of trackers) {
    if (have.has(t)) continue;
    const c = await fetchCharge(t, secret);
    if (!c) continue;
    await kept.doc(t).set(c);
    have.set(t, c);
    fresh.push(t);
  }
  const months = feesByMonth([...have.values()].filter(c => trackers.includes(c.tracker)));
  const written: string[] = [];
  for (const m of months) {
    const e = feeExpense(m, now);
    if (e.amount < 1) continue;
    const { id, ...row } = e;
    await adminDb.collection('expenses').doc(id).set(row, { merge: true });
    written.push(`${m.month}: ${e.amount}`);
  }
  await state.set({ at: now.toISOString(), payments: trackers.length, fresh: fresh.length, months: written });
  return { payments: trackers.length, fresh: fresh.length, months: written };
}
