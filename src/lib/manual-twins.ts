/**
 * Bills already in the books by hand (owner, 2026-11-09: "Don't re-add already added bills"). Before an import writes an
 * expense, it looks for one a person already recorded for the same thing: same vendor named in the description or category,
 * near the same date, about the same amount. Pure part here; the Firestore read is `recordedByHand` below.
 */
import { adminDb } from '@/lib/firebase-admin';

export interface HandExpense { id: string; date: string; amount: number; description?: string; category?: string; source?: string }

/** Ids the imports write themselves: never counted as "by hand". */
const AUTO = /^(shopify-bill-|safepay-fees-|tcs-charges-)/;

export const isHandMade = (e: HandExpense) => !AUTO.test(e.id) && !e.source;
export const names = (e: HandExpense, vendor: RegExp) => vendor.test(`${e.description ?? ''} ${e.category ?? ''}`);

/** The hand-made expense that is the same bill: the vendor named, within `days` of the date, the amount within `tolerance`. */
export function twinOf(list: HandExpense[], bill: { date: string; amount: number }, vendor: RegExp, used: Set<string>, days = 20, tolerance = 0.1): HandExpense | null {
  const at = Date.parse(bill.date);
  let best: HandExpense | null = null, gap = Infinity;
  for (const e of list) {
    if (used.has(e.id) || !isHandMade(e) || !names(e, vendor)) continue;
    const d = Math.abs(Date.parse(e.date) - at) / 86400_000;
    if (!(d <= days)) continue;
    if (Math.abs(e.amount - bill.amount) > Math.max(1, bill.amount * tolerance)) continue;
    if (d < gap) { best = e; gap = d; }
  }
  return best;
}

/** What people already recorded for the vendor in a month (yyyy-mm). */
export const handTotalForMonth = (list: HandExpense[], month: string, vendor: RegExp) =>
  list.filter(e => isHandMade(e) && names(e, vendor) && e.date.slice(0, 7) === month).reduce((n, e) => n + (Number(e.amount) || 0), 0);

/** Expenses dated between `from` and `to` (ISO days), for the checks above. */
export async function recordedByHand(from: string, to: string): Promise<HandExpense[]> {
  const snap = await adminDb.collection('expenses').where('date', '>=', from).where('date', '<', `${to}`).get();
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<HandExpense, 'id'>) }));
}
