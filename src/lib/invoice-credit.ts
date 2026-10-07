/**
 * An invoice in credit: the customer has paid more than it comes to, and the shop holds the
 * difference for them (owner, 2026-10-07: "allow invoices to go into credit").
 *
 * A balance below zero is that credit. It is held only for a named customer, on their hisaab,
 * where it nets against what they owe and shows as owed to them; a walk-in has no hisaab, so
 * money over the total from nobody in particular is change to hand back, not credit.
 */

/** The ledger row that carries an invoice's credit. */
export const creditDescription = (invoiceId: string) => `Credit held for Invoice ${invoiceId}`;

/** Written by the ledger sync before credit could be taken on purpose; still a credit row. */
const LEGACY_CREDIT = (invoiceId: string) => `Excess advance returned for Invoice ${invoiceId}`;

export const isCreditRow = (row: { description?: string; cashCredit?: number; cashDebit?: number }, invoiceId: string) =>
  (row.cashCredit ?? 0) > 0 && (row.description === creditDescription(invoiceId) || row.description === LEGACY_CREDIT(invoiceId));

/** Under half a rupee either way is settled: paise from rounding are not a debt or a credit. */
const SETTLED = 0.5;

export const inCredit = (balanceDue: number | undefined) => (Number(balanceDue) || 0) < -SETTLED;

export const canHoldCredit = (customerId: string | undefined | null) => !!customerId && customerId !== 'walk-in';

/** How an invoice's balance reads, everywhere it is shown, printed or sent. */
export function balanceLine(balanceDue: number | undefined): { label: string; amount: number; state: 'due' | 'paid' | 'credit' } {
  const b = Number(balanceDue) || 0;
  if (b > SETTLED) return { label: 'Balance due', amount: b, state: 'due' };
  if (b < -SETTLED) return { label: 'Credit to customer', amount: -b, state: 'credit' };
  return { label: 'Paid in full', amount: 0, state: 'paid' };
}
