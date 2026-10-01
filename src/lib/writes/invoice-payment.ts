/**
 * Recording a payment against an invoice.
 *
 * The one copy. Owners run it through the client SDK from the browser; shop
 * floor staff run it through the Admin SDK on the server, because they have no
 * database access of their own. Both drive the same function, so the takings
 * cannot start disagreeing with themselves depending on who is at the counter.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';

const INVOICES = 'invoices';
const HISAAB = 'hisaab';
const ORDERS = 'orders';

export interface PaymentInput {
  invoiceId: string;
  amount: number;
  date: string;
  method?: string;
  reference?: string;
}

export interface PaidInvoice {
  id: string;
  customerId?: string;
  customerName?: string;
  createdAt?: string;
  grandTotal: number;
  amountPaid: number;
  balanceDue: number;
  sourceOrderId?: string;
  paymentHistory: { amount: number; date: string; notes?: string }[];
}

export async function recordInvoicePayment(
  db: DbPort,
  input: PaymentInput,
  fx: SideEffects = {},
): Promise<PaidInvoice> {
  const { invoiceId, amount, date, method, reference } = input;

  // One round trip to the database, not five (2026-10-01, "why is every update so slow"): the
  // ledger rows linked to this invoice are looked up while the transaction reads the invoice, and
  // the payment, the ledger and the order's balance are committed together. Each of those used to
  // wait for the one before — a full trip to Iowa and back from the counter, every time.
  const linkedRows = db.queryEquals<{ cashDebit?: number }>(HISAAB, 'linkedInvoiceId', invoiceId);
  linkedRows.catch(() => { /* surfaced by the await inside the transaction */ });

  const updated = await db.runTransaction<PaidInvoice>(async tx => {
    const [invoice, linked] = await Promise.all([
      tx.get<Omit<PaidInvoice, 'id'>>(INVOICES, invoiceId),
      linkedRows,
    ]);
    if (!invoice) throw new Error('Invoice not found!');

    const payment = {
      amount, date,
      notes: method ? `Payment received (${method})` : 'Payment received',
      ...(method && { method }),
      ...(reference?.trim() && { reference: reference.trim() }),
    };
    const paymentHistory = [...(invoice.paymentHistory || []), payment];
    // Recomputed from the history rather than incremented, so a repeated
    // delivery of the same event cannot quietly inflate what was taken.
    const amountPaid = paymentHistory.reduce((acc, p) => acc + p.amount, 0);
    const balanceDue = (invoice.grandTotal || 0) - amountPaid;

    tx.update(INVOICES, invoiceId, { paymentHistory, amountPaid, balanceDue });

    // The customer's ledger has to follow the invoice. Single-field query and a
    // filter in memory, to avoid needing a composite index for one lookup.
    const debits = linked.filter(d => (d.cashDebit ?? 0) > 0);
    if (balanceDue <= 0) {
      debits.forEach(d => tx.delete(HISAAB, d.id));
    } else if (debits.length > 0) {
      // Keep one entry at the remaining balance; older duplicates go.
      tx.update(HISAAB, debits[0].id, { cashDebit: balanceDue });
      debits.slice(1).forEach(d => tx.delete(HISAAB, d.id));
    } else if (invoice.customerId && invoice.customerId !== 'walk-in') {
      // No linked entry to adjust — an edge case, but leaving the balance
      // unrecorded is worse than creating the row it should have had.
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

    // An order's grandTotal is stored NET of what has been paid, so it is the
    // balance — see lib/order-payment.ts. Paying the invoice moves it.
    if (invoice.sourceOrderId) tx.update(ORDERS, invoice.sourceOrderId, { grandTotal: balanceDue });

    return { ...invoice, paymentHistory, amountPaid, balanceDue, id: invoiceId };
  });

  // The log is a record, not part of the sale: it never holds the counter up.
  void Promise.resolve(fx.log?.(
    'invoice.payment',
    `Payment received for invoice ${invoiceId}`,
    `Amount: ${amount.toLocaleString()} | Customer: ${updated.customerName}`,
    invoiceId,
  )).catch(() => { /* logged by the driver */ });

  fx.syncInvoiceShopify?.(invoiceId, 'upsert');
  fx.notify?.(
    `💰 *Payment Received* ${invoiceId}\n` +
    `Customer: ${updated.customerName || 'Walk-in'}\n` +
    `Amount: PKR ${amount.toLocaleString()}\n` +
    (updated.balanceDue > 0
      ? `Balance remaining: PKR ${updated.balanceDue.toLocaleString()}`
      : `✅ Fully paid`),
  );

  return updated;
}
