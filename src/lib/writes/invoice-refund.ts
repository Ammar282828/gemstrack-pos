/**
 * A partial refund on an invoice (the invoice page's Refund → Partial refund, store `refundInvoicePartial`):
 * money handed back, recorded as a negative payment, the invoice staying in the books. A full refund is
 * deleting the invoice (lib/writes/delete-invoice.ts), which puts its pieces back in stock.
 *
 * The one copy: the browser's store and the iPhone app's write route (/api/app/write
 * `refundInvoicePartial`) both drive it. Both ask for the delete code before it runs (decision "Delete
 * code"): the browser's dialog, or the server with the request.
 *
 * Read first, then one commit: the history with the refund, what is paid and owed recomputed from it
 * (lib/invoice-actions.ts `withRefund`), and the customer's ledger row while they owe again (kept at the
 * new balance, or made for a named customer who has none). The refund goes to Shopify after, for the
 * same amount, unless the invoice came from Shopify itself.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { withRefund, type InvoiceFigures } from '@/lib/invoice-actions';

const INVOICES = 'invoices';
const HISAAB = 'hisaab';

type LinkedRow = { id: string; cashDebit?: number };

export interface RefundSideEffects extends SideEffects {
  /** The same refund issued on the invoice's Shopify order (/api/shopify/sync/invoice `refund`). */
  refundOnShopify?: (invoiceId: string, amount: number, reason?: string) => void;
}

/** The invoice as the write reads it: its figures, and whom it is for. */
type InvoiceDoc = InvoiceFigures & { customerId?: string; customerName?: string; createdAt?: string };

/** The invoice as it now stands: everything on file, with the refund in its history. */
export type RefundedInvoice = InvoiceDoc & {
  id: string;
  amountPaid: number;
  balanceDue: number;
  paymentHistory: { amount?: number | null; date?: string; notes?: string }[];
};

export async function refundInvoicePartial(
  db: DbPort,
  input: { invoiceId: string; amount: number; reason?: string; date?: string },
  fx: RefundSideEffects = {},
): Promise<RefundedInvoice> {
  const { invoiceId, amount, reason } = input;
  if (!(amount > 0)) throw new Error('Enter a refund amount greater than 0.');
  const date = input.date ?? new Date().toISOString();

  const linkedRows = db.queryEquals<LinkedRow>(HISAAB, 'linkedInvoiceId', invoiceId);
  linkedRows.catch(() => { /* surfaced by the await inside the transaction */ });

  const updated = await db.runTransaction<RefundedInvoice>(async tx => {
    const [invoice, linked] = await Promise.all([tx.get<InvoiceDoc>(INVOICES, invoiceId), linkedRows]);
    if (!invoice) throw new Error('Invoice not found');

    const { paymentHistory, amountPaid, balanceDue } = withRefund(invoice, amount, date, reason);
    tx.update(INVOICES, invoiceId, { paymentHistory, amountPaid, balanceDue });

    // The customer owes again: their ledger row says how much.
    const debits = linked.filter(d => Number(d.cashDebit ?? 0) > 0);
    if (balanceDue > 0) {
      if (debits.length > 0) {
        tx.update(HISAAB, debits[0].id, { cashDebit: balanceDue });
        debits.slice(1).forEach(d => tx.delete(HISAAB, d.id));
      } else if (invoice.customerId && invoice.customerId !== 'walk-in') {
        tx.set(HISAAB, db.newId(HISAAB), {
          entityId: invoice.customerId,
          entityType: 'customer',
          entityName: invoice.customerName || 'Customer',
          date: invoice.createdAt,
          description: `Outstanding balance for Invoice ${invoiceId}`,
          cashDebit: balanceDue,
          cashCredit: 0,
          goldDebitGrams: 0,
          goldCreditGrams: 0,
          linkedInvoiceId: invoiceId,
        });
      }
    }

    return { ...invoice, id: invoiceId, paymentHistory, amountPaid, balanceDue };
  });

  void Promise.resolve(fx.log?.(
    'invoice.refund',
    `Partial refund on invoice ${invoiceId}`,
    `Amount: ${amount.toLocaleString()}${reason ? ` | ${reason}` : ''}`,
    invoiceId,
  )).catch(() => { /* logged by the driver */ });
  // A Shopify order's own invoice is Shopify's record already: nothing to send back to it.
  if (!invoiceId.startsWith('SHOPIFY-')) fx.refundOnShopify?.(invoiceId, amount, reason);
  return updated;
}
