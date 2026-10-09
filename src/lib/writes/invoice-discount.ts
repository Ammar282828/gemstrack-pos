/**
 * Changing the discount on a saved invoice (the invoice page's Discount, store `updateInvoiceDiscount`).
 *
 * The one copy: the browser's store and the iPhone app's write route (/api/app/write
 * `updateInvoiceDiscount`) both drive it, so the total, the customer's ledger row and the order's
 * balance move the same way whoever changes it. The total is the lines less the discount and the
 * exchange (lib/invoice-actions.ts `withDiscount`); what is owed follows on what has been paid.
 *
 * Read first, then everything in one commit: the invoice, its ledger row (kept at the new balance,
 * gone when nothing is owed, made for a named customer who has none), and the order it came from,
 * whose stored total is its balance (lib/order-payment.ts).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { discountProblem, withDiscount, type InvoiceFigures } from '@/lib/invoice-actions';

const INVOICES = 'invoices';
const HISAAB = 'hisaab';
const ORDERS = 'orders';

type LinkedRow = { id: string; cashDebit?: number };

/** The invoice as the write reads it: its figures, and who and what it is linked to. */
type InvoiceDoc = InvoiceFigures & {
  customerId?: string;
  customerName?: string;
  createdAt?: string;
  sourceOrderId?: string;
  discountAmount?: number;
};

/** The invoice as it now stands: everything on file, with the new discount, total and balance. */
export type DiscountedInvoice = InvoiceDoc & { id: string; discountAmount: number; grandTotal: number; balanceDue: number };

export async function updateInvoiceDiscount(
  db: DbPort,
  input: { invoiceId: string; discountAmount: number },
  fx: SideEffects = {},
): Promise<DiscountedInvoice> {
  const { invoiceId, discountAmount } = input;
  const linkedRows = db.queryEquals<LinkedRow>(HISAAB, 'linkedInvoiceId', invoiceId);
  linkedRows.catch(() => { /* surfaced by the await inside the transaction */ });

  const updated = await db.runTransaction<DiscountedInvoice>(async tx => {
    const [invoice, linked] = await Promise.all([tx.get<InvoiceDoc>(INVOICES, invoiceId), linkedRows]);
    if (!invoice) throw new Error('Invoice not found!');
    // The page refuses these before it asks; checked again here against the invoice as it is now.
    const problem = discountProblem(invoice.subtotal, discountAmount);
    if (problem) throw new Error(problem);

    const fields = withDiscount(invoice, discountAmount);
    tx.update(INVOICES, invoiceId, fields);

    const debits = linked.filter(d => (d.cashDebit ?? 0) > 0);
    if (fields.balanceDue <= 0) {
      debits.forEach(d => tx.delete(HISAAB, d.id));
    } else if (debits.length > 0) {
      tx.update(HISAAB, debits[0].id, { cashDebit: fields.balanceDue });
      debits.slice(1).forEach(d => tx.delete(HISAAB, d.id));
    } else if (invoice.customerId && invoice.customerId !== 'walk-in') {
      tx.set(HISAAB, db.newId(HISAAB), {
        entityId: invoice.customerId,
        entityType: 'customer',
        entityName: invoice.customerName || 'Customer',
        date: invoice.createdAt,
        description: `Outstanding balance for Invoice ${invoiceId}`,
        cashDebit: fields.balanceDue,
        cashCredit: 0,
        goldDebitGrams: 0,
        goldCreditGrams: 0,
        linkedInvoiceId: invoiceId,
      });
    }

    if (invoice.sourceOrderId) tx.update(ORDERS, invoice.sourceOrderId, { grandTotal: fields.balanceDue });

    return { ...invoice, ...fields, id: invoiceId };
  });

  void Promise.resolve(fx.log?.(
    'invoice.update',
    `Discount updated on invoice ${invoiceId}`,
    `Discount: ${Number(updated.discountAmount || 0).toLocaleString()} | New total: ${Number(updated.grandTotal || 0).toLocaleString()}`,
    invoiceId,
  )).catch(() => { /* logged by the driver */ });
  fx.syncInvoiceShopify?.(invoiceId, 'upsert');
  return updated;
}
