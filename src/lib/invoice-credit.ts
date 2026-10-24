/**
 * An invoice in credit: the customer has paid more than it comes to, and the shop holds the
 * difference for them (owner, 2026-10-07: "allow invoices to go into credit").
 *
 * A balance below zero is that credit. It is held only for a named customer, on their hisaab,
 * where it nets against what they owe and shows as owed to them; a walk-in has no hisaab, so
 * money over the total from nobody in particular is change to hand back, not credit.
 */

import { isCredit, owesMoney } from './money';

/** The ledger row that carries an invoice's credit. */
export const creditDescription = (invoiceId: string) => `Credit held for Invoice ${invoiceId}`;

/** Written by the ledger sync before credit could be taken on purpose; still a credit row. */
const LEGACY_CREDIT = (invoiceId: string) => `Excess advance returned for Invoice ${invoiceId}`;

export const isCreditRow = (row: { description?: string; cashCredit?: number; cashDebit?: number }, invoiceId: string) =>
  (row.cashCredit ?? 0) > 0 && (row.description === creditDescription(invoiceId) || row.description === LEGACY_CREDIT(invoiceId));

/**
 * Under one rupee either way is settled: money is whole rupees (2026-10-17), and a fraction left on a
 * bill from before is not a debt or a credit (lib/money.ts SETTLED_UNDER).
 */
export const inCredit = (balanceDue: number | undefined) => isCredit(balanceDue);

export const canHoldCredit = (customerId: string | undefined | null) => !!customerId && customerId !== 'walk-in';

/** How an invoice's balance reads, everywhere it is shown, printed or sent. */
export function balanceLine(balanceDue: number | undefined): { label: string; amount: number; state: 'due' | 'paid' | 'credit' } {
  const b = Number(balanceDue) || 0;
  if (owesMoney(b)) return { label: 'Balance due', amount: b, state: 'due' };
  if (isCredit(b)) return { label: 'Credit to customer', amount: -b, state: 'credit' };
  return { label: 'Paid in full', amount: 0, state: 'paid' };
}

/** The payment-history line written when the shop hands a customer their credit back (negative; not a refund of the sale). */
export const isCreditPayback = (p: { amount?: number | null; kind?: string } | null | undefined) =>
  !!p && p.kind === 'credit-payback' && (Number(p.amount) || 0) < 0;

/** What is given back in a period's payments, as a positive figure (Today's cash and Analytics' Cash Out show it as money out). */
export const creditPaidBack = (history: readonly { amount?: number | null; kind?: string }[] | null | undefined) =>
  (history ?? []).reduce((s, p) => s + (isCreditPayback(p) ? -(Number(p.amount) || 0) : 0), 0);
