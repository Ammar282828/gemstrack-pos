/**
 * Giving a customer their credit back (owner, 2026-10-24: "in situations with credit let me finish that
 * credit by giving customer money"). An invoice paid past its total leaves the named customer a credit
 * (lib/invoice-credit.ts); this hands the money over and brings the credit down.
 *
 * Why not `refundInvoicePartial`: that is a refund of the SALE. It asks the delete code, tells Shopify to
 * refund, and does not move the credit's hisaab row. A payback is none of those: the sale stands, nothing
 * goes to Shopify, and the credit row follows in the same commit (`followBalance`, as recording or
 * deleting a payment does).
 *
 * What it writes: one negative line in the payment history, `kind: 'credit-payback'`, with its method.
 * Paid and owed are recomputed from the whole history like every payment, so Today's cash and Cash In see
 * it as money going out the way they see a refund; revenue (`invoiceSaleValue`, grandTotal) is untouched.
 * More than the credit held is refused, so it can never push the invoice into debt. Deleting the line on
 * the invoice page puts the credit back (removeInvoicePayment follows the same rule).
 *
 * The one copy: the browser's store and the iPhone app's route (/api/app/write `payBackCredit`) drive it.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { canHoldCredit, inCredit } from '@/lib/invoice-credit';
import { rupees } from '@/lib/money';
import { followBalance, paymentIdFor, type PaidInvoice } from './invoice-payment';
import { checkIsoDate, checkMoney } from './validate';

const INVOICES = 'invoices';
const HISAAB = 'hisaab';

/** A refusal in the owner's words: the route answers it with a 409 (or 400 for a bad figure). */
export class PaybackRefusal extends Error {
  readonly name = 'PaybackRefusal';
}

export interface PaybackInput {
  invoiceId: string;
  /** Left out: the whole credit ("finish that credit"). */
  amount?: number;
  method?: string;
  notes?: string;
  date?: string;
  requestId?: string;
}

type LinkedRow = { id: string; cashDebit?: number; cashCredit?: number; description?: string };
type Held = Omit<PaidInvoice, 'id'> & { status?: string };

export async function payBackCredit(
  db: DbPort,
  input: PaybackInput,
  fx: SideEffects = {},
): Promise<PaidInvoice & { paidBack: number }> {
  const { invoiceId, method } = input;
  const date = input.date ? checkIsoDate(input.date, 'The date') : new Date().toISOString();
  const given = input.amount === undefined || input.amount === null ? undefined : rupees(checkMoney(input.amount, 'The amount', { positive: true }));
  const note = input.notes?.trim().slice(0, 300);

  const linkedRows = db.queryEquals<LinkedRow>(HISAAB, 'linkedInvoiceId', invoiceId);
  linkedRows.catch(() => { /* surfaced by the await inside the transaction */ });

  const paymentId = paymentIdFor(input.requestId);
  let again = false;
  let paidBack = 0;
  const updated = await db.runTransaction<PaidInvoice>(async tx => {
    again = false;
    const [invoice, linked] = await Promise.all([tx.get<Held>(INVOICES, invoiceId), linkedRows]);
    if (!invoice) throw new PaybackRefusal('Invoice not found!');
    // This very change is in the history already (a retry): once.
    const prior = paymentId ? (invoice.paymentHistory || []).find(p => p.id === paymentId) : undefined;
    if (prior) { again = true; paidBack = -prior.amount; return { ...invoice, id: invoiceId }; }

    if (invoice.status === 'Refunded') throw new PaybackRefusal('This invoice is refunded: there is no credit to give back.');
    if (!canHoldCredit(invoice.customerId)) throw new PaybackRefusal('A walk-in has no credit. Give the invoice a customer first.');
    if (!inCredit(invoice.balanceDue)) throw new PaybackRefusal('This invoice holds no credit.');
    const held = rupees(-invoice.balanceDue);
    const amount = given ?? held;
    if (amount > held) throw new PaybackRefusal(`Only PKR ${held.toLocaleString()} is held as credit on this invoice.`);

    const payment = {
      ...(paymentId && { id: paymentId }),
      amount: -amount,
      date,
      kind: 'credit-payback' as const,
      notes: note ? `Credit paid back: ${note}` : method ? `Credit paid back (${method})` : 'Credit paid back',
      ...(method && { method }),
    };
    const paymentHistory = [...(invoice.paymentHistory || []), payment];
    const amountPaid = rupees(paymentHistory.reduce((s, p) => s + (Number(p.amount) || 0), 0));
    const balanceDue = rupees((invoice.grandTotal || 0) - amountPaid);
    tx.update(INVOICES, invoiceId, { paymentHistory, amountPaid, balanceDue });
    // The credit row comes down to what is left, or goes at zero.
    followBalance(db, tx, invoiceId, invoice, linked, balanceDue, false);
    paidBack = amount;
    return { ...invoice, paymentHistory, amountPaid, balanceDue, id: invoiceId };
  });

  if (!again) {
    void Promise.resolve(fx.log?.(
      'invoice.payment',
      `Credit paid back on invoice ${invoiceId}`,
      `Amount: ${paidBack.toLocaleString()}${method ? ` (${method})` : ''} | Customer: ${updated.customerName} | Credit left ${Math.max(0, -updated.balanceDue).toLocaleString()}`,
      invoiceId,
    )).catch(() => { /* logged by the driver */ });
  }
  return { ...updated, paidBack };
}
