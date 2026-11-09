/**
 * The Shopify section's reading of an invoice (owner, 2026-11-09; House of Mina, STORE_SHOPIFY_SECTION): a Shopify order
 * is an invoice whose `source` starts with "shopify" (the sync, the CSV import). One predicate, here, for Invoices (which
 * drops them) and /shopify (which lists them), and the chips' classification from the order's WhatsApp state
 * (lib/shopify-whatsapp.ts: `whatsappOrder.state`) and Shopify's own cancel (lib/shopify-mirror.ts).
 */
import { owesMoney } from '@/lib/money';

export interface ShopifyInvoiceLike {
  source?: string;
  status?: string;
  balanceDue?: number;
  shopifyCancelledAt?: string;
  whatsappOrder?: { state?: string } | null;
}

export const isShopifyInvoice = (inv: { source?: string } | null | undefined): boolean =>
  !!inv && typeof inv.source === 'string' && inv.source.startsWith('shopify');

export type ShopifyChip = 'all' | 'confirm' | 'unpaid' | 'paid' | 'cancelled';

/** Cancelled: the customer asked to cancel on WhatsApp, Shopify cancelled it, or the invoice was refunded. */
export function isShopifyCancelled(inv: ShopifyInvoiceLike): boolean {
  return inv.whatsappOrder?.state === 'declined' || !!inv.shopifyCancelledAt || inv.status === 'Refunded' || inv.status === 'Cancelled';
}

/** To confirm: the confirmation message went out and the customer has not answered (not confirmed, not cancelled). */
export function isToConfirm(inv: ShopifyInvoiceLike): boolean {
  return inv.whatsappOrder?.state === 'awaiting-confirmation' && !isShopifyCancelled(inv);
}

/** Which of the section's chips (besides All) an order sits under. Cancelled orders are in neither Unpaid nor Paid. */
export function shopifyChipsOf(inv: ShopifyInvoiceLike): ShopifyChip[] {
  if (isShopifyCancelled(inv)) return ['all', 'cancelled'];
  const out: ShopifyChip[] = ['all'];
  if (isToConfirm(inv)) out.push('confirm');
  out.push(owesMoney(inv.balanceDue ?? 0) ? 'unpaid' : 'paid');
  return out;
}

/** What an invoice must look like to be made an order (lib/writes/shopify-invoice-to-order.ts; the section's banner and the invoice page's "Make it an order"). */
export interface ConvertibleInvoice extends ShopifyInvoiceLike {
  sourceOrderId?: string;
  orderId?: string;
  fromOrder?: string;
  shopifyFulfillment?: string;
  exchanges?: unknown[];
  paymentHistory?: { amount?: number; kind?: string }[];
}

/**
 * Why a Shopify invoice cannot be made an order (a sentence), or null when it can: it must be a Shopify sale, not one made
 * from an order, not cancelled or refunded, not fulfilled (shipped: it is done), with no exchange and no money handed back.
 */
export function convertBlocker(inv: ConvertibleInvoice | null | undefined): string | null {
  if (!inv || !isShopifyInvoice(inv)) return 'not a Shopify sale';
  if (inv.sourceOrderId || inv.orderId || inv.fromOrder) return 'made from an order already';
  if (inv.status === 'Refunded' || inv.status === 'Cancelled' || inv.shopifyCancelledAt) return 'cancelled or refunded';
  if (String(inv.shopifyFulfillment || '').toLowerCase() === 'fulfilled') return 'already fulfilled';
  if (Array.isArray(inv.exchanges) && inv.exchanges.length > 0) return 'has an exchange';
  if ((inv.paymentHistory || []).some(p => p?.kind === 'credit-payback' || !(Number(p?.amount) > 0))) return 'has a refund or credit paid back';
  return null;
}
