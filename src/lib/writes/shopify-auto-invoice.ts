/**
 * A Shopify web order that has left the shop is invoiced by itself (House of Mina; owner, 2026-11-19: "make the invoice
 * automatically for all fulfilled orders"). Until now a shipped web order went to Completed (writes/shopify-order.ts) and
 * waited for a person to press Finalize & invoice, which for a web order only ever confirmed what Shopify already said:
 * each piece at the price the customer paid, the order's discount, the delivery.
 *
 * So the invoice is exactly the one that dialog makes untouched (components/order/order-dialogs.tsx defaults), through the
 * same write (writes/finalize-order.ts): the next INV- number, Shopify's payments carried over as payments (so the mirror adds
 * none twice), the order linked, and what is still owed (a parcel TCS has not yet delivered against cash) on the customer's
 * hisaab. When TCS delivers, the mirror records the cash on the invoice (lib/shopify-mirror.ts withDeliveredCod).
 *
 * Left for a person, with the reason: an order whose pieces the shop re-priced by weight, or whose pieces and delivery no
 * longer add up to what the order says it is for (the invoice would then disagree with Shopify's total).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { FinalizedItem } from '@/lib/order-finalize';
import { isShippedOut } from '@/lib/shopify-delivery';
import { rupees } from '@/lib/money';
import { finalizeOrder } from './finalize-order';

const ORDERS = 'orders';

interface AutoInvoiceOrder {
  id?: string;
  source?: string;
  status?: string;
  invoiceId?: string | null;
  shopifyFulfillment?: string;
  shopifyDelivery?: string;
  shopifyCancelledAt?: string;
  subtotal?: number;
  discountAmount?: number;
  deliveryCharge?: number;
  items?: {
    description?: string; metalType?: string; karat?: string; isManualPrice?: boolean; manualPrice?: number; totalEstimate?: number;
    estimatedWeightG?: number; wastagePercentage?: number; makingCharges?: number; diamondCharges?: number; stoneCharges?: number;
  }[];
}

/** Shipped out of the shop by Shopify's or TCS's word, and not back. */
export const leftTheShop = (o: { shopifyFulfillment?: string; shopifyDelivery?: string; shopifyCancelledAt?: string }) =>
  !o.shopifyCancelledAt && o.shopifyDelivery !== 'returned'
  && (String(o.shopifyFulfillment || '').toLowerCase() === 'fulfilled' || isShippedOut(o.shopifyDelivery));

/** What Finalize & invoice would be sent for this order untouched, or why it is a person's to do. Pure. */
export function autoInvoicePlan(o: AutoInvoiceOrder): { items: FinalizedItem[]; additionalDiscount: number } | { skip: string } {
  if (!String(o.source || '').startsWith('shopify')) return { skip: 'not a web order' };
  if (o.invoiceId) return { skip: 'invoiced already' };
  if (o.status !== 'Completed') return { skip: 'not completed' };
  if (!leftTheShop(o)) return { skip: 'not shipped' };
  const pieces = Array.isArray(o.items) ? o.items : [];
  if (!pieces.length) return { skip: 'no pieces' };
  if (pieces.some(p => !p?.isManualPrice)) return { skip: 'priced by weight: finalize by hand' };
  const items = pieces.map(p => ({
    description: p.description || 'Item',
    karat: p.karat,
    metalType: p.metalType,
    isManualPrice: true,
    finalManualPrice: Number(p.manualPrice || p.totalEstimate) || 0,
    finalWeightG: Number(p.estimatedWeightG) || 0,
    finalWastagePercentage: Number(p.wastagePercentage) || 0,
    finalMakingCharges: Number(p.makingCharges) || 0,
    finalDiamondCharges: Number(p.diamondCharges) || 0,
    finalStoneCharges: Number(p.stoneCharges) || 0,
  })) as FinalizedItem[];
  // The invoice is the pieces plus the delivery; the order's subtotal holds both (importShopifyAsOrder). They must agree.
  const lines = items.reduce((t, i) => t + rupees(i.finalManualPrice), 0);
  const delivery = Math.max(0, rupees(o.deliveryCharge));
  if (Math.abs(lines + delivery - rupees(o.subtotal)) >= 1) return { skip: `pieces and delivery (${lines + delivery}) differ from the order (${rupees(o.subtotal)})` };
  return { items, additionalDiscount: Math.max(0, rupees(o.discountAmount)) };
}

/** Invoice one shipped web order; null when it is not one to invoice (the reason in `skip`). */
export async function autoInvoiceShopifyOrder(
  db: DbPort,
  orderId: string,
  deps: { clean: <T extends object>(o: T) => T },
  fx: SideEffects = {},
): Promise<{ invoiceId: string } | { skip: string }> {
  const o = await db.get<AutoInvoiceOrder>(ORDERS, orderId);
  if (!o) return { skip: 'no such order' };
  const plan = autoInvoicePlan(o);
  if ('skip' in plan) return plan;
  // finalizeOrder re-reads the order in its transaction and refuses one invoiced meanwhile: a notice and the sweep can race.
  const invoice = await finalizeOrder(db, { orderId, ...plan }, deps, fx);
  return { invoiceId: invoice.id };
}
