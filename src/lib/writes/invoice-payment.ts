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

  const updated = await db.runTransaction<PaidInvoice>(async tx => {
    const invoice = await tx.get<Omit<PaidInvoice, 'id'>>(INVOICES, invoiceId);
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
    return { ...invoice, paymentHistory, amountPaid, balanceDue, id: invoiceId };
  });

  await fx.log?.(
    'invoice.payment',
    `Payment received for invoice ${invoiceId}`,
    `Amount: ${amount.toLocaleString()} | Customer: ${updated.customerName}`,
    invoiceId,
  );

  // The customer's ledger has to follow the invoice. Single-field query and a
  // filter in memory, to avoid needing a composite index for one lookup.
  const linked = await db.queryEquals<{ cashDebit?: number }>(HISAAB, 'linkedInvoiceId', invoiceId);
  const debits = linked.filter(d => (d.cashDebit ?? 0) > 0);

  const batch = db.batch();
  if (updated.balanceDue <= 0) {
    debits.forEach(d => batch.delete(HISAAB, d.id));
  } else if (debits.length > 0) {
    // Keep one entry at the remaining balance; older duplicates go.
    batch.update(HISAAB, debits[0].id, { cashDebit: updated.balanceDue });
    debits.slice(1).forEach(d => batch.delete(HISAAB, d.id));
  } else if (updated.customerId && updated.customerId !== 'walk-in') {
    // No linked entry to adjust — an edge case, but leaving the balance
    // unrecorded is worse than creating the row it should have had.
    batch.set(HISAAB, db.newId(HISAAB), {
      entityId: updated.customerId,
      entityType: 'customer',
      entityName: updated.customerName || 'Customer',
      date: updated.createdAt,
      description: `Outstanding balance for Invoice ${invoiceId}`,
      cashDebit: updated.balanceDue,
      cashCredit: 0,
      goldDebitGrams: 0,
      goldCreditGrams: 0,
      linkedInvoiceId: invoiceId,
    });
  }
  await batch.commit();

  // An order's grandTotal is stored NET of what has been paid, so it is the
  // balance — see lib/order-payment.ts. Paying the invoice moves it.
  if (updated.sourceOrderId) {
    await db.update(ORDERS, updated.sourceOrderId, { grandTotal: updated.balanceDue });
  }

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
