/**
 * A Shopify web order as an ERP ORDER (House of Mina, STORE_SHOPIFY_SECTION; owner, 2026-11-09: "treat them as
 * orders now and not invoices in terms of functionality, so products will be made to order and completed").
 *
 * The one copy, on the DbPort (lib/db-port.ts), so the notice, the pull and the tests all run it:
 * - `importShopifyAsOrder`: the order SHOPIFY-<number>, made through createOrder like every other order (pieces from
 *   the line items, status Pending). Idempotent by id: the same notice twice, or a pull after a notice, finds it.
 *   No money here: Shopify's payments come in through the mirror, each once.
 * - `mirrorShopifyToOrder`: what Shopify says happened since — paid, shipped, cancelled — onto the order, as
 *   writes/invoice-payment.ts does for an invoice, and never rewriting what the shop changed: a payment becomes an
 *   ADVANCE with a deterministic id (`adv-shopify-<transaction id>`), up to what is still owed; fulfilment and
 *   cancellation are kept as Shopify's own words; an order cancelled there with nothing paid is Cancelled.
 *
 * From there it is an ordinary order: karigars, Ready, Finalize & invoice (writes/finalize-order.ts), whose invoice
 * keeps source 'shopify' and the order's Shopify ids.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { planShopifyMirror, shopifyDeliveryCharge, shopifyPaymentNote, type ShopifyOrderState, type ShopifyTransaction } from '@/lib/shopify-mirror';
import { rupees } from '@/lib/money';
import { createOrder, type CreateOrderDeps, type CreatedOrder } from './create-order';
import { orderBalance } from './order-pieces';
import { orderStatusPatch } from './order-status';
import { isShippedOut } from '@/lib/shopify-delivery';

const ORDERS = 'orders';
/** Most pieces one web order makes (a unit each): a runaway quantity must not make a thousand pieces. */
const MAX_PIECES = 50;

export const shopifyOrderId = (order: { order_number?: number | string }) => `SHOPIFY-${order.order_number}`;

interface LineItem { id?: number | string; name?: string | null; title?: string | null; price?: string | number | null; quantity?: number | null; properties?: { name?: string; value?: unknown }[] | null }

export interface ShopifyWebOrder extends ShopifyOrderState {
  id: number | string;
  order_number?: number | string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
  total_price?: string | number | null;
  total_discounts?: string | number | null;
  line_items?: LineItem[] | null;
  customer?: { id?: number | string; first_name?: string | null; last_name?: string | null; phone?: string | null } | null;
  shipping_address?: { name?: string | null; address1?: string | null; address2?: string | null; city?: string | null; phone?: string | null } | null;
  shipping_lines?: { price?: string | number | null }[] | null;
}

/** What the customer chose that is not a variant, from the line's properties (as _lib's lineItemNotes). */
const notesOf = (li: LineItem): string[] =>
  (Array.isArray(li.properties) ? li.properties : [])
    .filter(p => p && p.name && !String(p.name).startsWith('_') && String(p.value ?? '').trim())
    .map(p => `${p.name}: ${String(p.value).trim()}`);

/** The order's pieces: one per unit, described as the invoice line was (name · what was chosen), priced at the line's price. */
export function shopifyPieces(order: ShopifyWebOrder, metal: 'gold' | 'silver'): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const li of order.line_items || []) {
    const price = Math.round(parseFloat(String(li.price ?? '0')) || 0);
    const units = Math.min(Math.max(1, Number(li.quantity) || 1), MAX_PIECES);
    const description = [li.name || li.title || 'Shopify item', ...notesOf(li)].join(' · ');
    for (let u = 0; u < units && out.length < MAX_PIECES; u++) {
      out.push({
        description, metalType: metal, ...(metal === 'gold' && { karat: '21k' }),
        estimatedWeightG: 0, stoneWeightG: 0, hasStones: false, hasDiamonds: false, wastagePercentage: 0,
        makingCharges: price, diamondCharges: 0, stoneCharges: 0, totalEstimate: price,
        // The price the customer paid: Finalize & invoice starts from it.
        isManualPrice: true, manualPrice: price, sampleGiven: false, isCompleted: false,
      });
    }
  }
  if (!out.length) out.push({ description: 'Shopify order', metalType: metal, estimatedWeightG: 0, stoneWeightG: 0, hasStones: false, hasDiamonds: false, wastagePercentage: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, sampleGiven: false, isCompleted: false });
  return out;
}

/** The customer as the pull and the CSV name them (shopify-<id>); a guest by email. */
const customerNameOf = (o: ShopifyWebOrder) =>
  (o.customer ? [o.customer.first_name, o.customer.last_name].filter(Boolean).join(' ') : '') || o.shipping_address?.name || o.email || 'Shopify Customer';

export async function importShopifyAsOrder(
  db: DbPort,
  order: ShopifyWebOrder,
  deps: Omit<CreateOrderDeps, 'fixedId' | 'extra'> & { metal: 'gold' | 'silver' },
  fx: SideEffects = {},
): Promise<{ order: CreatedOrder; created: boolean }> {
  const id = shopifyOrderId(order);
  const { metal, ...orderDeps } = deps;
  const items = shopifyPieces(order, metal);
  const discount = Math.round(parseFloat(String(order.total_discounts ?? '0')) || 0);
  const total = Math.round(parseFloat(String(order.total_price ?? '0')) || 0);
  // The order's full amount is Shopify's total (delivery included): the pieces are the lines, the difference rides in the subtotal.
  const subtotal = total + discount;
  const a = order.shipping_address;
  const ship = [a?.address1, a?.address2, a?.city].map(s => (s || '').trim()).filter(Boolean).join(', ');
  const there = await db.get<CreatedOrder>(ORDERS, id);
  if (there) return { order: { ...there, id } as CreatedOrder, created: false };
  const made = await createOrder(db, {
    items: items as { description?: string }[],
    source: 'shopify',
    customerId: order.customer?.id ? `shopify-${order.customer.id}` : undefined,
    customerName: customerNameOf(order),
    customerContact: order.customer?.phone || order.phone || a?.phone || undefined,
    subtotal, discountAmount: discount, grandTotal: total,
    notes: `Shopify order #${order.order_number}${ship ? ` · Deliver to: ${ship}` : ''}`,
  }, {
    ...orderDeps,
    fixedId: id,
    extra: {
      createdAt: order.created_at || new Date().toISOString(),
      shopifyOrderId: String(order.id),
      shopifyOrderNumber: Number(order.order_number) || undefined,
      shopifyOrderName: `#${order.order_number}`,
      shopifyFinancialStatus: String(order.financial_status || ''),
      shopifyFulfillment: String(order.fulfillment_status || 'unfulfilled'),
      shopifyTransactionIds: [],
      advancePayment: 0,
      // The delivery the customer pays (Shopify's shipping): in the subtotal above, named so the order and its invoice say so.
      ...(Number(shopifyDeliveryCharge(order)) > 0 && { deliveryCharge: shopifyDeliveryCharge(order) }),
      ...(order.cancelled_at ? { shopifyCancelledAt: String(order.cancelled_at) } : {}),
    },
  }, { ...fx, notify: undefined });
  return { order: made, created: true };
}

export interface ShopifyOrderMirror {
  orderId: string;
  added: { amount: number; date: string; id: string }[];
  cancelled: boolean;
  /** Shipped on Shopify, so the piece is made: the order went to Completed. */
  completed?: boolean;
  changed: boolean;
  advancePayment?: number;
  balance?: number;
}

/** One Shopify order and its transactions onto the ERP order `orderId`; null when there is no such order. */
export async function mirrorShopifyToOrder(
  db: DbPort,
  orderId: string,
  shopify: ShopifyOrderState,
  transactions: ShopifyTransaction[],
  fx: SideEffects = {},
): Promise<ShopifyOrderMirror | null> {
  const result = await db.runTransaction<ShopifyOrderMirror | null>(async tx => {
    const o = await tx.get<Record<string, unknown>>(ORDERS, orderId);
    if (!o) return null;
    // An invoiced order's money is taken on the invoice (order-advance.ts); its Shopify state still shows.
    const invoiced = !!o.invoiceId;
    const subtotal = rupees(o.subtotal as number);
    const discount = rupees(o.discountAmount as number);
    const full = Math.max(0, subtotal - discount);
    const advances = [...((o.advances as { id?: string; amount?: number; date?: string }[]) || [])];
    let paid = rupees(o.advancePayment as number);
    let ids = ((o.shopifyTransactionIds as string[]) || []).map(String);
    const added: ShopifyOrderMirror['added'] = [];

    const state = () => ({ grandTotal: full, amountPaid: paid, paymentHistory: [{ amount: paid }] as never, shopifyTransactionIds: ids, status: o.status as string });
    if (!invoiced) {
      const known = new Set(ids);
      const fresh = (transactions || []).filter(t => t && !known.has(String(t.id)));
      // One at a time, in the order Shopify took them: each is capped by what is still owed, and once seen is never added again.
      for (const t of fresh.sort((a, b) => String(a.processed_at || a.created_at || '').localeCompare(String(b.processed_at || b.created_at || '')))) {
        const step = planShopifyMirror(state(), shopify, [t]);
        ids = step.fields.shopifyTransactionIds;
        const p = step.added[0];
        if (!p) continue;
        const advanceId = `adv-shopify-${t.id}`;
        if (advances.some(a => a.id === advanceId)) continue;
        advances.push({ id: advanceId, ...p } as never);
        paid = rupees(paid + p.amount);
        added.push({ amount: p.amount, date: p.date, id: advanceId });
      }
    }
    const plan = planShopifyMirror(state(), shopify, [], { voidWhenCancelled: true });
    const cancels = !invoiced && plan.voids && o.status !== 'Cancelled' && o.status !== 'Refunded';
    // Shipped (TCS has it, or it is delivered) and not back: the piece was made, so the order is done. Never over a
    // cancel, an invoiced order (its invoice is the record) or a status the shop set to Cancelled/Refunded/Completed.
    const completes = !invoiced && !cancels && !plan.fields.shopifyCancelledAt && isShippedOut(plan.fields.shopifyDelivery)
      && (o.status === 'Pending' || o.status === 'In Progress');
    const tracking = plan.fields.shopifyTracking;
    const tcsNo = tracking && /tcs/i.test(tracking.company) && !o.tcsConsignmentNo ? tracking.number : undefined;
    // An order made before its delivery was named (2026-11-09) learns it from Shopify; one the shop has set is kept.
    const shipping = shopifyDeliveryCharge(shopify);
    const delivery = !invoiced && o.deliveryCharge === undefined && shipping !== undefined && shipping > 0 ? shipping : undefined;
    const changed = cancels || completes || !!tcsNo || delivery !== undefined || added.length > 0
      || (plan.fields.shopifyDelivery !== undefined && plan.fields.shopifyDelivery !== ((o.shopifyDelivery as string) || ''))
      || (tracking?.number || '') !== (tracking ? ((o.shopifyTracking as { number?: string })?.number || '') : '')
      || plan.fields.shopifyFinancialStatus !== ((o.shopifyFinancialStatus as string) || '')
      || plan.fields.shopifyFulfillment !== ((o.shopifyFulfillment as string) || '')
      || (plan.fields.shopifyCancelledAt || '') !== ((o.shopifyCancelledAt as string) || '')
      || ids.length !== ((o.shopifyTransactionIds as string[]) || []).length;
    if (!changed) return { orderId, added: [], cancelled: false, changed: false };
    const balance = orderBalance({ subtotal, discountAmount: discount, advancePayment: paid, advanceInExchangeValue: rupees(o.advanceInExchangeValue as number) });
    tx.update(ORDERS, orderId, {
      shopifyFinancialStatus: plan.fields.shopifyFinancialStatus,
      shopifyFulfillment: plan.fields.shopifyFulfillment,
      ...(plan.fields.shopifyCancelledAt && { shopifyCancelledAt: plan.fields.shopifyCancelledAt }),
      shopifyTransactionIds: ids,
      shopifySyncedAt: new Date().toISOString(),
      ...(added.length && { advances, advancePayment: paid, grandTotal: balance }),
      ...(plan.fields.shopifyDelivery !== undefined && { shopifyDelivery: plan.fields.shopifyDelivery }),
      ...(tracking && { shopifyTracking: tracking }),
      ...(plan.fields.shopifyDeliveryAt && { shopifyDeliveryAt: plan.fields.shopifyDeliveryAt }),
      ...(tcsNo && { tcsConsignmentNo: tcsNo }),
      ...(delivery !== undefined && { deliveryCharge: delivery }),
      ...(cancels && { status: 'Cancelled' }),
      // Completing ticks every piece, as setting Completed by hand does (writes/order-status.ts).
      ...(completes && orderStatusPatch({ status: o.status as string, items: o.items as never }, 'Completed').patch),
    });
    return { orderId, added, cancelled: cancels, completed: completes, changed: true, advancePayment: paid, balance };
  });

  if (result?.cancelled) {
    void Promise.resolve(fx.log?.('order.update', `Cancelled on Shopify: order ${orderId}`, `Order #${shopify.order_number}, nothing paid`, orderId)).catch(() => undefined);
  }
  if (result?.completed) {
    void Promise.resolve(fx.log?.('order.update', `Shipped on Shopify: order ${orderId}`, `Order #${shopify.order_number} left the shop, so it is Completed`, orderId)).catch(() => undefined);
  }
  if (result?.added.length) {
    const total = result.added.reduce((s, p) => s + p.amount, 0);
    void Promise.resolve(fx.log?.('order.update', `Paid on Shopify: order ${orderId}`, `Advance: ${total.toLocaleString()} | ${shopifyPaymentNote(shopify.order_number)}`, orderId)).catch(() => undefined);
  }
  return result;
}
