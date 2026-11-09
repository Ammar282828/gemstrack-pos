/**
 * Booking an order or invoice with TCS from the ERP (op bookTcs, the order page's "Book with TCS"): what the form starts
 * with, and what the booking writes back. Pure; the calls are lib/tcs-cod-server.ts.
 *
 * The form starts from the Shopify order's shipping address when there is one (Mina's web orders), else the ERP's own
 * delivery block, else the "Deliver to: …" the import wrote into the notes. The cash to collect is what is still owed:
 * an order's balance (its grandTotal, delivery included) or an invoice's balanceDue, 0 once paid.
 */

import { tcsMobile } from '@/lib/tcs-cod';

/** What a booking leaves on the order or invoice (beside tcsConsignmentNo), for the slip and the card. */
export interface TcsBooking {
  cn: string;
  bookedAt: string;
  by: string;
  codAmount: number;
  destinationCity: string;
  weight: number;
  pieces: number;
  reference: string;
  consignee: { name: string; address: string; mobile: string };
  originCity: string;
  /** Set when it was cancelled with TCS; tcsConsignmentNo is then cleared. */
  cancelledAt?: string;
  /** Whether the Shopify order was fulfilled with this number, or why not. */
  shopify?: { ok: boolean; message: string };
}

export interface BookingPrefill {
  consignee: { name: string; address: string; mobile: string; email: string };
  destinationCity: string;
  codAmount: number;
  weight: number;
  pieces: number;
  reference: string;
  productDetails: string;
  /** A Shopify order sits behind it: the form offers to fulfil it with the number. */
  shopifyOrderId?: string;
}

export interface ShopifyShipTo {
  name?: string | null; first_name?: string | null; last_name?: string | null;
  address1?: string | null; address2?: string | null; city?: string | null; province?: string | null; zip?: string | null; phone?: string | null;
}

export interface BookableDoc {
  id: string;
  customerName?: string;
  customerContact?: string;
  notes?: string;
  delivery?: { address?: string; city?: string; contactName?: string; contactPhone?: string } | null;
  grandTotal?: number;
  balanceDue?: number;
  shopifyOrderId?: string;
  shopifyOrderName?: string;
  shopifyOrderNumber?: number;
  shopifyFinancialStatus?: string;
}

const t = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** "Shopify order #1460 · Deliver to: House 12, Street 4, Lahore" → { address: "House 12, Street 4", city: "Lahore" }. */
export function deliverToFromNotes(notes: string | undefined): { address: string; city: string } | null {
  const m = /Deliver to:\s*([^\n·]+)/i.exec(notes || '');
  if (!m) return null;
  const parts = m[1].split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const city = parts.length > 1 ? parts[parts.length - 1] : '';
  return { address: (parts.length > 1 ? parts.slice(0, -1) : parts).join(', '), city };
}

/** What is still owed on it, whole rupees: the cash the rider collects. */
export function codOwed(doc: BookableDoc, kind: 'order' | 'invoice'): number {
  if (/^paid$/i.test(doc.shopifyFinancialStatus || '')) return 0;
  const owed = kind === 'invoice' ? Number(doc.balanceDue) : Number(doc.grandTotal);
  return Number.isFinite(owed) && owed > 0.5 ? Math.round(owed) : 0;
}

export function prefillBooking(doc: BookableDoc, kind: 'order' | 'invoice', ship?: ShopifyShipTo | null, email?: string | null): BookingPrefill {
  const fromNotes = deliverToFromNotes(doc.notes);
  const d = doc.delivery || {};
  const shipName = t(ship?.name) || [t(ship?.first_name), t(ship?.last_name)].filter(Boolean).join(' ');
  const shipAddress = [t(ship?.address1), t(ship?.address2)].filter(Boolean).join(', ');
  const address = shipAddress || t(d.address) || fromNotes?.address || '';
  const city = t(ship?.city) || t(d.city) || fromNotes?.city || '';
  const name = shipName || t(d.contactName) || t(doc.customerName);
  const mobile = tcsMobile(t(ship?.phone) || t(d.contactPhone) || t(doc.customerContact));
  return {
    consignee: { name, address, mobile, email: t(email) },
    destinationCity: city,
    codAmount: codOwed(doc, kind),
    weight: 0.5,
    pieces: 1,
    reference: t(doc.shopifyOrderName) || (doc.shopifyOrderNumber ? `#${doc.shopifyOrderNumber}` : '') || doc.id,
    productDetails: 'Jewellery',
    ...(doc.shopifyOrderId ? { shopifyOrderId: String(doc.shopifyOrderId) } : {}),
  };
}
