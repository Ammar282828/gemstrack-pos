/**
 * What customers owe the shop: one figure, read the same way on the dashboard ("Owed to you"),
 * the customer list, Invoices' "Awaiting payment" and Hisaab (the audit of 2026-10-01 found four
 * sums — the customer list dropped every walk-in and every invoice with only a typed name).
 *
 * The rule: every invoice not refunded, its `balanceDue` above zero. An order carries no debt
 * until it is invoiced (its advance is the customer's money already paid, not owed).
 *
 * Walk-ins count. A walk-in sale left owing is still money the shop is owed, so it is in the
 * total; it has no customer to belong to (lib/walk-in.ts), so it is gathered under one key,
 * WALK_IN_ENTITY — the same one Analytics and Hisaab use — and an invoice with only a typed name
 * under `name:<name>` (saleCustomerKey). The customer list shows those two as their own lines
 * rather than silently leaving them out of its total.
 *
 * And what the hisaab holds by hand (2026-10-03, the owner: "yes add dads"): a customer's own
 * ledger rows — the old khata, an opening balance, udhaar written in Hisaab — that no invoice
 * keeps. Given the ledger, each customer's hand-written balance is added when it is owed to the
 * shop (a customer the shop owes does not lower anyone else's debt). Rows linked to an invoice are
 * that invoice's balance again and are left out; karigars' rows are not customers' debt.
 */

import { saleCustomerKey, WALK_IN_ENTITY } from '@/lib/walk-in';

type OwedInvoice = { id: string; status?: string; balanceDue?: number; customerId?: string | null; customerName?: string | null; createdAt?: string };
export type LedgerRow = { entityId?: string; entityType?: string; cashDebit?: number; cashCredit?: number; linkedInvoiceId?: string | null };

/** An invoice that is still owed money on. */
export const isOwing = (inv: OwedInvoice | null | undefined): boolean =>
  !!inv && inv.status !== 'Refunded' && (Number(inv.balanceDue) || 0) > 0.5;

/** Each customer's hand-written hisaab balance (debit less credit), from rows no invoice keeps. */
export function ledgerBalances(rows: readonly LedgerRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r?.entityId || r.entityType !== 'customer' || r.linkedInvoiceId) continue;
    out.set(r.entityId, (out.get(r.entityId) ?? 0) + (Number(r.cashDebit) || 0) - (Number(r.cashCredit) || 0));
  }
  return out;
}

export interface Owed<I extends OwedInvoice> {
  /** Everything owed, walk-ins and the hisaab's hand-written balances included. */
  total: number;
  /** The invoices owed on, oldest first — the one to chase. */
  invoices: I[];
  /** By customer: a customer id, WALK_IN_ENTITY, or `name:<typed name>`. `count` is invoices. */
  byKey: Map<string, { amount: number; count: number }>;
  /** What walk-in sales still owe (also in byKey under WALK_IN_ENTITY). */
  walkIn: number;
  /** What invoices with only a typed name owe (under `name:` keys). */
  nameOnly: number;
  /** What the hisaab holds by hand (also in total and byKey). 0 when no ledger was given. */
  ledger: number;
}

export function owedToYou<I extends OwedInvoice>(
  invoices: readonly I[],
  currentName?: (id: string) => string | undefined,
  ledgerRows?: readonly LedgerRow[],
): Owed<I> {
  const owing = invoices.filter(isOwing).sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  const byKey = new Map<string, { amount: number; count: number }>();
  let total = 0, walkIn = 0, nameOnly = 0, ledger = 0;
  for (const inv of owing) {
    const due = Number(inv.balanceDue) || 0;
    total += due;
    const key = saleCustomerKey(inv, currentName);
    if (key === WALK_IN_ENTITY) walkIn += due;
    else if (key.startsWith('name:')) nameOnly += due;
    const cur = byKey.get(key) ?? { amount: 0, count: 0 };
    cur.amount += due; cur.count += 1;
    byKey.set(key, cur);
  }
  if (ledgerRows) {
    for (const [key, balance] of ledgerBalances(ledgerRows)) {
      if (balance <= 0.5) continue;
      total += balance; ledger += balance;
      if (key === WALK_IN_ENTITY) walkIn += balance;
      const cur = byKey.get(key) ?? { amount: 0, count: 0 };
      cur.amount += balance;
      byKey.set(key, cur);
    }
  }
  return { total, invoices: owing, byKey, walkIn, nameOnly, ledger };
}
