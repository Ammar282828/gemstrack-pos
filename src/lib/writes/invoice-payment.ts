/**
 * Recording a payment against an invoice.
 *
 * The one copy. Owners run it through the client SDK from the browser; shop
 * floor staff run it through the Admin SDK on the server, because they have no
 * database access of their own. Both drive the same function, so the takings
 * cannot start disagreeing with themselves depending on who is at the counter.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Payment } from '@/lib/store';
import { canHoldCredit, creditDescription, inCredit, isCreditRow } from '@/lib/invoice-credit';
import { planShopifyMirror, type MirroredInvoice, type ShopifyOrderState, type ShopifyTransaction } from '@/lib/shopify-mirror';

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
  const linkedRows = db.queryEquals<LinkedRow>(HISAAB, 'linkedInvoiceId', invoiceId);
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

    followBalance(db, tx, invoiceId, invoice, linked, balanceDue, false);

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
  fx.notify?.(invoiceId);

  return updated;
}

type Tx = Parameters<Parameters<DbPort['runTransaction']>[0]>[0];

/**
 * What is still owed has to agree with, in the same commit as the payment: the customer's ledger
 * row for the invoice, and the order's balance. Shared by recording a payment and deleting one,
 * so the two can never disagree about what a balance looks like.
 *
 * `walkInRow`: with no row to adjust, recording a payment makes one only for a named customer (as
 * it always has); deleting one can put a paid walk-in invoice back in debt, and then the walk-in
 * row it would have had at the till is written, under the fixed 'walk-in' entity.
 */
type LinkedRow = { id: string; cashDebit?: number; cashCredit?: number; description?: string };

function followBalance(db: DbPort, tx: Tx, invoiceId: string, invoice: Omit<PaidInvoice, 'id'>, linked: LinkedRow[], balanceDue: number, walkInRow: boolean) {
  followCredit(db, tx, invoiceId, invoice, linked, balanceDue);
  // The customer's ledger has to follow the invoice. Single-field query and a
  // filter in memory, to avoid needing a composite index for one lookup.
  const debits = linked.filter(d => (d.cashDebit ?? 0) > 0);
  if (balanceDue <= 0) {
    debits.forEach(d => tx.delete(HISAAB, d.id));
  } else if (debits.length > 0) {
    // Keep one entry at the remaining balance; older duplicates go.
    tx.update(HISAAB, debits[0].id, { cashDebit: balanceDue });
    debits.slice(1).forEach(d => tx.delete(HISAAB, d.id));
  } else if ((invoice.customerId && invoice.customerId !== 'walk-in') || walkInRow) {
    // No linked entry to adjust — an edge case, but leaving the balance
    // unrecorded is worse than creating the row it should have had.
    tx.set(HISAAB, db.newId(HISAAB), {
      entityId: invoice.customerId || 'walk-in',
      entityType: 'customer',
      entityName: invoice.customerName || (invoice.customerId ? 'Customer' : 'Walk-in Customer'),
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
}

/**
 * An invoice paid past its total is in credit (lib/invoice-credit.ts): the customer's hisaab holds
 * one credit row at the amount over, written in the same commit, and it goes when the invoice is
 * back at or under its total. Before this only the ledger sync wrote it, some time later.
 */
function followCredit(db: DbPort, tx: Tx, invoiceId: string, invoice: Omit<PaidInvoice, 'id'>, linked: LinkedRow[], balanceDue: number) {
  const credits = linked.filter(r => isCreditRow(r, invoiceId));
  if (!inCredit(balanceDue) || !canHoldCredit(invoice.customerId)) {
    credits.forEach(r => tx.delete(HISAAB, r.id));
    return;
  }
  const credit = -balanceDue;
  if (credits.length > 0) {
    tx.update(HISAAB, credits[0].id, { cashCredit: credit, cashDebit: 0, description: creditDescription(invoiceId) });
    credits.slice(1).forEach(r => tx.delete(HISAAB, r.id));
    return;
  }
  tx.set(HISAAB, db.newId(HISAAB), {
    entityId: invoice.customerId,
    entityType: 'customer',
    entityName: invoice.customerName || 'Customer',
    date: invoice.createdAt,
    description: creditDescription(invoiceId),
    cashDebit: 0,
    cashCredit: credit,
    goldDebitGrams: 0,
    goldCreditGrams: 0,
    linkedInvoiceId: invoiceId,
  });
}

export interface RemovePaymentInput {
  invoiceId: string;
  /** The payment's place in paymentHistory, as the page showed it. */
  index: number;
  /** Its amount and date as shown: if the invoice changed meanwhile, nothing is removed. */
  amount: number;
  date: string;
}

/**
 * Delete one payment from an invoice: an advance carried over from its order, a payment taken
 * since, or a partial refund (owner, 2026-10-01: "add ability to delete invoices/advances/orders").
 * What is paid is recomputed from what remains, and the ledger and the order's balance follow in
 * the same commit, exactly as recording a payment moves them.
 */
export async function removeInvoicePayment(
  db: DbPort,
  input: RemovePaymentInput,
  fx: SideEffects = {},
): Promise<PaidInvoice & { removed: { amount: number; date: string; notes?: string } }> {
  const { invoiceId, index } = input;
  const linkedRows = db.queryEquals<LinkedRow>(HISAAB, 'linkedInvoiceId', invoiceId);
  linkedRows.catch(() => { /* surfaced by the await inside the transaction */ });

  const updated = await db.runTransaction(async tx => {
    const [invoice, linked] = await Promise.all([tx.get<Omit<PaidInvoice, 'id'>>(INVOICES, invoiceId), linkedRows]);
    if (!invoice) throw new Error('Invoice not found!');
    const history = invoice.paymentHistory || [];
    const removed = history[index];
    if (!removed || Math.abs((removed.amount || 0) - input.amount) > 0.005 || removed.date !== input.date) {
      throw new Error('The payments on this invoice changed. Open it again and try once more.');
    }
    const paymentHistory = history.filter((_, i) => i !== index);
    const amountPaid = paymentHistory.reduce((acc, p) => acc + p.amount, 0);
    const balanceDue = (invoice.grandTotal || 0) - amountPaid;
    tx.update(INVOICES, invoiceId, { paymentHistory, amountPaid, balanceDue });
    followBalance(db, tx, invoiceId, invoice, linked, balanceDue, true);
    return { ...invoice, paymentHistory, amountPaid, balanceDue, id: invoiceId, removed };
  });

  void Promise.resolve(fx.log?.(
    'invoice.update',
    `Payment deleted from invoice ${invoiceId}`,
    `Amount: ${updated.removed.amount.toLocaleString()} of ${updated.removed.date.slice(0, 10)}${updated.removed.notes ? ` (${updated.removed.notes})` : ''} | Customer: ${updated.customerName} | Now paid ${updated.amountPaid.toLocaleString()}, due ${updated.balanceDue.toLocaleString()}`,
    invoiceId,
  )).catch(() => { /* logged by the driver */ });
  fx.syncInvoiceShopify?.(invoiceId, 'upsert');
  return updated;
}

export interface ShopifyMirrorResult {
  invoiceId: string;
  /** Payments added from Shopify, and what the invoice now says. */
  added: Payment[];
  amountPaid?: number;
  balanceDue?: number;
  /** Cancelled on Shopify with nothing paid: now Refunded. */
  voided?: boolean;
  changed: boolean;
}

/**
 * Shopify's word on a web order, onto its invoice (lib/shopify-mirror.ts has the rule): its payments,
 * each once and only up to what is owed, and its payment, fulfilment and cancellation state. Read and
 * written in one transaction, so the same notice delivered twice at once (Mina's store sends each to
 * two addresses) still adds a payment once. `extra` is written with it (a payment link's order id).
 */
export async function mirrorShopifyOrder(
  db: DbPort,
  invoiceId: string,
  order: ShopifyOrderState,
  transactions: ShopifyTransaction[],
  extra: Record<string, unknown> = {},
  fx: SideEffects = {},
  opts: { voidWhenCancelled?: boolean } = {},
): Promise<ShopifyMirrorResult | null> {
  const linkedRows = db.queryEquals<LinkedRow>(HISAAB, 'linkedInvoiceId', invoiceId);
  linkedRows.catch(() => { /* surfaced by the await inside the transaction */ });

  const result = await db.runTransaction<ShopifyMirrorResult | null>(async tx => {
    const [invoice, linked] = await Promise.all([
      tx.get<Omit<PaidInvoice, 'id'> & MirroredInvoice>(INVOICES, invoiceId),
      linkedRows,
    ]);
    if (!invoice) return null;
    const plan = planShopifyMirror(invoice, order, transactions, opts);
    const extraChanged = Object.entries(extra).some(([k, v]) => (invoice as unknown as Record<string, unknown>)[k] !== v);
    if (!plan.changed && !extraChanged) return { invoiceId, added: [], changed: false };
    tx.update(INVOICES, invoiceId, {
      ...plan.fields,
      ...extra,
      shopifySyncedAt: new Date().toISOString(),
      ...(plan.added.length && { paymentHistory: plan.paymentHistory, amountPaid: plan.amountPaid, balanceDue: plan.balanceDue }),
      ...(plan.voids && { status: 'Refunded', refundedAt: plan.fields.shopifyCancelledAt }),
    });
    // Voided, it owes nothing: its ledger row goes as a paid one's does.
    if (plan.added.length || plan.voids) followBalance(db, tx, invoiceId, invoice, linked, plan.voids ? 0 : plan.balanceDue, false);
    return { invoiceId, added: plan.added, amountPaid: plan.amountPaid, balanceDue: plan.balanceDue, voided: plan.voids, changed: true };
  });

  if (result?.voided) {
    void Promise.resolve(fx.log?.('invoice.refund', `Cancelled on Shopify: invoice ${invoiceId}`, `Order #${order.order_number}, nothing paid`, invoiceId))
      .catch(() => { /* logged by the driver */ });
  }
  if (result?.added.length) {
    const total = result.added.reduce((s, p) => s + p.amount, 0);
    void Promise.resolve(fx.log?.(
      'invoice.payment',
      `Paid on Shopify: invoice ${invoiceId}`,
      `Amount: ${total.toLocaleString()} | Order #${order.order_number}`,
      invoiceId,
    )).catch(() => { /* logged by the driver */ });
  }
  return result;
}
