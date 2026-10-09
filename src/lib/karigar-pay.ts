/**
 * A karigar's pay, as his page shows it (src/app/karigars/[id]/page.tsx): what he has been paid in all,
 * the pay batch open now and what is in it, the settled batches, the payments outside any batch, and the
 * silver he has brought in with its surcharge. One copy of the page's figures (it works them out inline):
 * the iPhone app's karigar page runs the same, ported line for line to ERPCore `KarigarPay` with these
 * cases, and settling a batch on the server writes `batchTotal` as its `totalPaid`, the figure the owner
 * was shown when he settled.
 *
 * A payment is an expense with the karigar's id; filed under a batch, it also carries the batch's id.
 * Payments are filed by id only, so one whose batch has since been deleted sits in neither the batch
 * nor the direct payments (as on the page), though it still counts in what he has been paid in all.
 * Read only.
 */

export type PayExpense = { id: string; date: string; amount: number; karigarId?: string; batchId?: string | null };
export type PayBatch = { id: string; karigarId: string; label: string; startDate: string; closedDate?: string | null };
export type SilverRow = { id: string; karigarId: string; date: string; silverGrams: number; surchargePerGram: number; totalSurcharge: number };

/** A date as a number to sort by; one that cannot be read sorts as the oldest. */
const time = (iso: string | undefined | null): number => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) ? t : 0;
};

/** Newest first; equal dates keep the order they came in (the sort is stable). */
const newestFirst = <T extends { date: string }>(rows: T[]): T[] => [...rows].sort((a, b) => time(b.date) - time(a.date));

const amount = (n: unknown) => Number(n) || 0;
const total = (rows: { amount: number }[]) => rows.reduce((s, e) => s + amount(e.amount), 0);

/** A batch with no closing date is the one open now. */
export const isOpenBatch = (b: { closedDate?: string | null }) => !b.closedDate;

/** The payments filed under a batch, newest first: his expenses that carry its id. */
export function batchPayments<E extends PayExpense>(batch: PayBatch, expenses: E[]): E[] {
  return newestFirst(expenses.filter(e => e.karigarId === batch.karigarId && e.batchId === batch.id));
}

/** What a batch comes to: what settling it writes as its total paid. */
export function batchTotal(batch: PayBatch, expenses: PayExpense[]): number {
  return total(batchPayments(batch, expenses));
}

export type BatchPay<E, B> = { batch: B; payments: E[]; total: number };

export function karigarPay<E extends PayExpense, B extends PayBatch>(o: { karigarId: string; expenses: E[]; batches: B[] }) {
  const payments = o.expenses.filter(e => e.karigarId === o.karigarId);
  const batches = [...o.batches.filter(b => b.karigarId === o.karigarId)].sort((a, b) => time(b.startDate) - time(a.startDate));
  const filed = (batch: B): BatchPay<E, B> => {
    const mine = batchPayments(batch, payments);
    return { batch, payments: mine, total: total(mine) };
  };
  const open = batches.find(isOpenBatch);
  // A payment whose batch is gone (deleted before 2026-10-09 left its id behind) is paid outside any batch:
  // counted in total paid, and listed with the direct payments rather than nowhere.
  const known = new Set(batches.map(b => b.id));
  const direct = newestFirst(payments.filter(e => !e.batchId || !known.has(e.batchId)));
  return {
    /** Every payment to him, in the batches and outside them. */
    totalPaid: total(payments),
    /** The newest open batch, which a payment from his page is filed under. */
    open: open ? filed(open) : null,
    /** The closed ones, newest start first; each totalled from its payments as they are now. */
    settled: batches.filter(b => !isOpenBatch(b)).map(filed),
    /** Paid outside any batch, or under one since deleted. */
    direct: { payments: direct, total: total(direct) },
  };
}

/** The silver form's surcharge: the grams received at the rate per gram, as the entry stores it. */
export const silverSurcharge = (silverGrams: number, surchargePerGram: number) => silverGrams * surchargePerGram;

/** The silver form's rules: grams above nothing, a surcharge of nothing or more. Null when it may be saved. */
export function silverProblem(silverGrams: number, surchargePerGram: number): string | null {
  if (!Number.isFinite(silverGrams) || silverGrams <= 0) return 'Silver grams must be greater than 0';
  if (!Number.isFinite(surchargePerGram) || surchargePerGram < 0) return 'Surcharge must be non-negative';
  return null;
}

/** His silver: the entries newest first, the grams received and the surcharge on them, in all. */
export function karigarSilver<S extends SilverRow>(karigarId: string, rows: S[]) {
  const mine = newestFirst(rows.filter(t => t.karigarId === karigarId));
  return {
    rows: mine,
    grams: mine.reduce((s, t) => s + (Number(t.silverGrams) || 0), 0),
    surcharge: mine.reduce((s, t) => s + (Number(t.totalSurcharge) || 0), 0),
  };
}
