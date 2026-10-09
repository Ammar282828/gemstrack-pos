/**
 * Finalize & invoice: an order's invoice, as the order page's dialog makes it (store.ts
 * generateInvoiceFromOrder), for the browser and the iPhone app alike (lib/db-port.ts for why one copy).
 *
 * Each piece is priced at the figures typed in the dialog and the rates the order was booked at
 * (lib/order-finalize.ts). Everything the order settled is carried over as what it is (the owner,
 * 2026-09-25): gold taken in exchange is the invoice's exchange, row for row; each cash advance is a payment
 * of its own, with its day and how it was paid. The order is marked Completed with the balance as its total
 * and the invoice's number; the hisaab gets what is still owed, or the credit, in the same commit.
 *
 * Types are structural: the store imports this, and importing the store back would close the circle.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Invoice, InvoiceItem, Order, Payment, Settings } from '@/lib/store';
import { exchangeTotal, invoiceExchangeFields, orderExchanges } from '@/lib/exchange';
import { creditDescription } from '@/lib/invoice-credit';
import { finalizedItemCosts, orderInvoiceRates, type FinalizedItem } from '@/lib/order-finalize';
import { orderAdvancePayments } from '@/lib/order-payment';
import { newShareToken } from '@/lib/share-token';

const ORDERS = 'orders';
const INVOICES = 'invoices';
const SETTINGS = 'app_settings';
const GLOBAL = 'global';
const HISAAB = 'hisaab';

const invoiceNumber = (n: number) => `INV-${n.toString().padStart(6, '0')}`;

/**
 * The invoice an order becomes, without its number: the pieces priced as the dialog showed them, the
 * order's exchange and advances carried over. Pure, so the dialog's figures, the browser's write and the
 * server's are one sum.
 */
export function invoiceFromOrder(
  order: Order,
  finalizedItems: FinalizedItem[],
  additionalDiscount: number,
  costRate24k: number | undefined,
  settings: Settings,
  now: string,
  clean: <T extends object>(o: T) => T,
): Omit<Invoice, 'id'> {
  const ratesForInvoice = orderInvoiceRates(order, settings);
  let finalSubtotal = 0;
  const finalInvoiceItems: InvoiceItem[] = [];
  order.items.forEach((originalItem, index) => {
    const finalizedData = finalizedItems[index]; // Use index for reliability
    if (!finalizedData) throw new Error(`Finalized data for item "${originalItem.description}" not found.`);
    // The figures typed in Finalize & invoice — weight, wastage, making, stones, diamonds —
    // priced exactly as the dialog showed them (lib/order-finalize.ts).
    const itemCosts = finalizedItemCosts(originalItem, finalizedData, ratesForInvoice);
    const itemPrice = itemCosts.price;
    finalSubtotal += itemPrice;
    const numericPart = String(order.id).replace(/^ORD-/, '');
    const itemToAdd: InvoiceItem = {
      sku: `ORD-${numericPart}-${index + 1}`,
      name: originalItem.description,
      categoryId: '',
      metalType: originalItem.metalType,
      karat: originalItem.karat,
      // A fixed price keeps its weight too: it prints, and costs the margin (2026-10-07).
      metalWeightG: Number(finalizedData.finalWeightG) || 0,
      stoneWeightG: originalItem.stoneWeightG,
      quantity: 1,
      unitPrice: itemPrice,
      itemTotal: itemPrice,
      metalCost: itemCosts.metalCost,
      wastageCost: itemCosts.wastageCost,
      wastagePercentage: itemCosts.wastagePercentage,
      makingCharges: itemCosts.makingCharges,
      diamondChargesIfAny: itemCosts.diamondCharges,
      stoneChargesIfAny: itemCosts.stoneCharges,
      miscChargesIfAny: 0,
      stoneDetails: originalItem.stoneDetails,
      diamondDetails: originalItem.diamondDetails,
      ...(originalItem.size && { size: originalItem.size }),
      ...(finalizedData.isManualPrice && { isManualPrice: true }),
      ...(finalizedData.isManualPrice && originalItem.hasDiamonds && { hasDiamonds: true }),
      ...(finalizedData.isManualPrice && originalItem.hasStones && { hasStones: true }),
      ...(originalItem.itemCategory && { itemCategory: originalItem.itemCategory }),
      ...(originalItem.adminNote && { adminNote: originalItem.adminNote }),
      // Silver's plating was left behind, so a Mina order's "21K gold plating,
      // nickel-free" vanished from its invoice.
      ...(originalItem.platingType && { platingType: originalItem.platingType }),
      ...(originalItem.platingNote && { platingNote: originalItem.platingNote }),
      ...(originalItem.nickelFree && { nickelFree: true }),
    };
    finalInvoiceItems.push(clean(itemToAdd));
  });

  const totalDiscount = additionalDiscount;
  const exchanges = orderExchanges(order);
  const grandTotal = finalSubtotal - totalDiscount - exchangeTotal(exchanges);
  const paymentHistory: Payment[] = orderAdvancePayments(order).map((p) => clean(p));
  const amountPaid = paymentHistory.reduce((sum, p) => sum + p.amount, 0);
  const balanceDue = grandTotal - amountPaid;

  return {
    items: finalInvoiceItems,
    subtotal: finalSubtotal,
    discountAmount: totalDiscount,
    grandTotal,
    amountPaid,
    balanceDue,
    createdAt: now,
    ratesApplied: ratesForInvoice,
    paymentHistory,
    customerId: order.customerId,
    customerName: order.customerName || 'Walk-in Customer',
    customerContact: order.customerContact,
    ...(order.source && { acquisitionSource: order.source }),
    sourceOrderId: order.id,
    ...(order.hideRates ? { hideRates: true } : {}),
    ...(Number(costRate24k) > 0 ? { costRate24k: Number(costRate24k) } : {}),
    ...invoiceExchangeFields(exchanges),
    ...(order.takenBy ? { takenBy: order.takenBy } : {}),
    // The order's notes are the shop's; on the invoice they are its note for the shop,
    // which is never printed.
    ...(order.notes?.trim() ? { internalNote: order.notes.trim() } : {}),
    // The address the customer gave when ordering is the address it
    // ships to. Without this the invoice was raised with no delivery
    // details at all and they had to be typed in again.
    ...(order.delivery?.required && order.delivery.address?.trim() ? { delivery: order.delivery } : {}),
    // Carry forward: if this order had previously been linked to a Shopify
    // order (and was reverted to be re-finalized), preserve the link so the
    // upsert handler reuses the same Shopify order instead of creating a new one.
    ...(order.shopifyOrderId && { shopifyOrderId: order.shopifyOrderId }),
    ...(order.shopifyOrderNumber && { shopifyOrderNumber: order.shopifyOrderNumber }),
  } as Omit<Invoice, 'id'>;
}

/** The hisaab row an invoice made from an order leaves: what is still owed, or the advance that came to more. */
export function finalizeHisaabRow(invoice: Invoice): Record<string, unknown> | null {
  if (invoice.balanceDue === 0) return null;
  const owes = invoice.balanceDue > 0;
  return {
    entityId: invoice.customerId || 'walk-in',
    entityType: 'customer',
    entityName: invoice.customerName || 'Walk-in Customer',
    date: invoice.createdAt,
    description: owes ? `Outstanding balance for Invoice ${invoice.id}` : creditDescription(invoice.id),
    cashDebit: owes ? invoice.balanceDue : 0,
    cashCredit: owes ? 0 : Math.abs(invoice.balanceDue),
    goldDebitGrams: 0,
    goldCreditGrams: 0,
    linkedInvoiceId: invoice.id,
  };
}

/**
 * The whole of Finalize & invoice in one commit on the server's port: the invoice under the next number
 * (never over one that exists), the counter, the order marked Completed and linked, and the hisaab row. An
 * order already invoiced is refused: undoing that is "Undo invoice", which asks for the delete code.
 */
export async function finalizeOrder(
  db: DbPort,
  input: { orderId: string; items: FinalizedItem[]; additionalDiscount: number; costRate24k?: number; now?: string },
  deps: { clean: <T extends object>(o: T) => T },
  fx: SideEffects = {},
): Promise<Invoice> {
  const now = input.now || new Date().toISOString();
  const invoice = await db.runTransaction<Invoice>(async (tx) => {
    const [settings, order] = await Promise.all([
      tx.get<Settings>(SETTINGS, GLOBAL),
      tx.get<Omit<Order, 'id'>>(ORDERS, input.orderId),
    ]);
    if (!settings) throw new Error('Global settings not found.');
    if (!order) throw new Error(`Order ${input.orderId} not found.`);
    if (order.invoiceId) throw new Error(`${input.orderId} is invoiced already, as ${order.invoiceId}.`);
    if (!Array.isArray(order.items) || order.items.length !== input.items.length) {
      throw new Error(`${input.orderId} has changed since it was opened: open it again and finalize.`);
    }
    const next = (settings.lastInvoiceNumber || 0) + 1;
    const id = invoiceNumber(next);
    // Guard: never silently overwrite an existing invoice if the counter is stale.
    if (await tx.get(INVOICES, id)) {
      throw new Error(`Invoice ${id} already exists — the invoice counter (lastInvoiceNumber=${settings.lastInvoiceNumber}) is stale. Please contact your administrator to recalibrate it.`);
    }
    const base = invoiceFromOrder({ ...order, id: input.orderId } as Order, input.items, input.additionalDiscount, input.costRate24k, settings, now, deps.clean);
    const withKey = { ...base, shareToken: newShareToken() };
    const made = { id, ...withKey } as Invoice;
    tx.set(INVOICES, id, deps.clean({ ...withKey }) as Record<string, unknown>);
    tx.update(SETTINGS, GLOBAL, { lastInvoiceNumber: next });
    tx.update(ORDERS, input.orderId, {
      status: 'Completed',
      grandTotal: made.balanceDue,
      invoiceId: id,
      // The Shopify link now lives on the invoice, and the draft is cancelled: cleared from the order.
      ...(order.shopifyOrderId && { shopifyOrderId: null, shopifyOrderNumber: null }),
      ...(order.shopifyDraftOrderId && { shopifyDraftOrderId: null, shopifyDraftOrderName: null }),
    });
    const row = finalizeHisaabRow(made);
    if (row) tx.set(HISAAB, db.newId(HISAAB), row);
    return made;
  });
  await fx.log?.('invoice.create', `Created invoice ${invoice.id} from order ${input.orderId}`,
    `Customer: ${invoice.customerName} | Total: ${invoice.grandTotal.toLocaleString()}`, invoice.id);
  return invoice;
}
