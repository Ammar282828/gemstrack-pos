/**
 * An invoice in credit: the customer has paid more than it comes to, and the shop holds the
 * difference for them (owner, 2026-10-07: "allow invoices to go into credit").
 *
 * A balance below zero is that credit. It is held only for a named customer, on their hisaab,
 * where it nets against what they owe and shows as owed to them; a walk-in has no hisaab, so
 * money over the total from nobody in particular is change to hand back, not credit.
 */

import { isCredit } from './money';
import { settlementOf } from './machines/settlement';

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

/**
 * How an invoice's balance reads, everywhere it is shown, printed or sent. Pass the invoice's `status` too wherever it is
 * known: a refunded invoice owes nothing and holds nothing, whatever its balance still says (machines/settlement.ts).
 */
export function balanceLine(balanceDue: number | undefined, status?: string | null): { label: string; amount: number; state: 'due' | 'paid' | 'credit' | 'refunded' } {
  const s = settlementOf({ status, balanceDue });
  if (s.state === 'refunded') return { label: s.label, amount: 0, state: 'refunded' };
  if (s.state === 'credit') return { label: s.label, amount: s.credit, state: 'credit' };
  if (s.state === 'paid') return { label: s.label, amount: 0, state: 'paid' };
  return { label: s.label, amount: s.amountDue, state: 'due' };
}

/** The same, from the invoice. */
export const balanceLineOf = (inv: { balanceDue?: number; status?: string | null }) => balanceLine(inv.balanceDue, inv.status);

/** The payment-history line written when the shop hands a customer their credit back (negative; not a refund of the sale). */
export const isCreditPayback = (p: { amount?: number | null; kind?: string } | null | undefined) =>
  !!p && p.kind === 'credit-payback' && (Number(p.amount) || 0) < 0;

/** What is given back in a period's payments, as a positive figure (Today's cash and Analytics' Cash Out show it as money out). */
export const creditPaidBack = (history: readonly { amount?: number | null; kind?: string }[] | null | undefined) =>
  (history ?? []).reduce((s, p) => s + (isCreditPayback(p) ? -(Number(p.amount) || 0) : 0), 0);
