/**
 * What the shop does to a website order after it is placed.
 *
 * Three moves, each idempotent and each telling the customer what happened:
 *
 *   transfer received  — the money is in the account. The order becomes paid
 *                        in full (advancePayment = grandTotal, which is what
 *                        the rest of the POS reads as "Paid") and moves to
 *                        In Progress.
 *   ship               — book with Leopards, or record a consignment number
 *                        typed in at the counter, and send the tracking link.
 *   delivered          — close the order.
 *
 * These run server-side because the second one holds Leopards' credentials and
 * all three send WhatsApp from the shop's number; neither belongs in a browser.
 */

import { adminDb } from '@/lib/firebase-admin';
import { bookPacket, leopardsConfig, trackingUrlFor, trackPacket } from '@/lib/leopards';
import { STORE_CONFIG } from '@/lib/store-config';
import { customerPaidMessage, customerShippedMessage, trySend } from './notify';
import type { LeopardsMeta, WebsiteOrderMeta } from './types';

export class FulfilmentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

interface OrderDoc {
  id: string;
  status?: string;
  customerName?: string;
  customerContact?: string;
  grandTotal?: number;
  advancePayment?: number;
  delivery?: { address?: string; city?: string; contactName?: string; contactPhone?: string };
  items?: { estimatedWeightG?: number }[];
  website?: WebsiteOrderMeta;
  leopards?: LeopardsMeta;
}

async function load(id: string): Promise<OrderDoc> {
  const snap = await adminDb.collection('orders').doc(id).get();
  if (!snap.exists) throw new FulfilmentError('Order not found', 404);
  const o = { id: snap.id, ...(snap.data() as Omit<OrderDoc, 'id'>) };
  if (!o.website) throw new FulfilmentError('Not a website order', 409);
  return o;
}

export async function markTransferReceived(id: string, by: string): Promise<{ ok: true; notified: string | null }> {
  const o = await load(id);
  if (o.website!.paymentStatus === 'transfer_received') return { ok: true, notified: null };
  const now = new Date().toISOString();
  await adminDb.collection('orders').doc(id).update({
    advancePayment: o.grandTotal || 0,
    status: o.status === 'Pending' ? 'In Progress' : o.status,
    'website.paymentStatus': 'transfer_received',
    'website.paidAt': now,
    'website.paidConfirmedBy': by,
  });
  const notified = await trySend(o.customerContact, customerPaidMessage(id, o.customerName || 'there'));
  return { ok: true, notified };
}

export async function shipOrder(id: string, by: string, manualCn?: string): Promise<{ ok: true; leopards: LeopardsMeta; notified: string | null }> {
  const o = await load(id);
  if (o.website!.paymentStatus !== 'transfer_received') throw new FulfilmentError('Record the transfer before shipping', 409);
  if (o.leopards?.cn) return { ok: true, leopards: o.leopards, notified: null };

  let meta: LeopardsMeta;
  if (manualCn && manualCn.trim()) {
    const cn = manualCn.trim();
    meta = { cn, bookedAt: new Date().toISOString(), trackingUrl: trackingUrlFor(cn), manual: true };
  } else {
    if (!leopardsConfig()) throw new FulfilmentError('Leopards is not connected. Book at the counter and enter the CN number.', 409);
    const d = o.delivery || {};
    const weight = (o.items || []).reduce((s, it) => s + (it.estimatedWeightG || 0), 0);
    const booked = await bookPacket({
      orderId: id,
      weightGrams: weight,
      collectAmount: 0,
      originCity: 'Karachi',
      destinationCity: d.city || '',
      shipper: {
        name: STORE_CONFIG.name || 'TAHERI',
        phone: STORE_CONFIG.contact1Number || '',
        // The counter's address is not in STORE_CONFIG; Leopards needs one on the slip.
        address: process.env.WEBSITE_SHIP_FROM_ADDRESS || 'Najmi Market, Shop #40 & #16, Saddar, Karachi',
      },
      consignee: { name: d.contactName || o.customerName || '', phone: d.contactPhone || o.customerContact || '', address: `${d.address || ''}, ${d.city || ''}` },
    });
    meta = { cn: booked.cn, bookedAt: new Date().toISOString(), trackingUrl: booked.trackingUrl };
  }
  await adminDb.collection('orders').doc(id).update({ leopards: meta, 'website.shippedBy': by, status: 'In Progress' });
  const notified = await trySend(o.customerContact, customerShippedMessage(id, o.customerName || 'there', meta.cn, meta.trackingUrl));
  return { ok: true, leopards: meta, notified };
}

export async function markDelivered(id: string): Promise<{ ok: true }> {
  const o = await load(id);
  if (!o.leopards?.cn) throw new FulfilmentError('Nothing has been shipped yet', 409);
  await adminDb.collection('orders').doc(id).update({ 'leopards.deliveredAt': new Date().toISOString(), status: 'Completed' });
  return { ok: true };
}

/** Ask Leopards where the packet is. Read-only; nothing is written unless it says delivered. */
export async function refreshTracking(id: string) {
  const o = await load(id);
  if (!o.leopards?.cn) throw new FulfilmentError('Nothing has been shipped yet', 409);
  const t = await trackPacket(o.leopards.cn);
  if (t.delivered && !o.leopards.deliveredAt) {
    await adminDb.collection('orders').doc(id).update({ 'leopards.deliveredAt': new Date().toISOString(), status: 'Completed' });
  }
  return t;
}
