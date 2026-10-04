/**
 * Transfer slips: the customer sends one from their order page; the shop sees it in its alert and
 * on the order, checks the bank, and presses Transfer received. A slip is the customer's word, not
 * the money: it moves the order to `slip_sent` and nothing more.
 *
 * Kept in Firestore (`website_slips/{id}`, the file as bytes beside its order), the way order photos
 * are (`order_photos`): no second store to secure. A slip is a phone screenshot or a bank's PDF; the
 * site shrinks a picture to a JPEG well under the 900 KB kept here before it sends it.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { safeEqual } from './checkout';
import { customerTotal, FulfilmentError } from './fulfilment';
import { isOnlineId, ONLINE_ORDERS } from './online';
import { trySendShopDoc } from './notify';
import type { OnlineOrder, WebsiteOrderMeta, WebsiteSlip } from './types';

export const SLIPS = 'website_slips';
export const MAX_SLIP_BYTES = 900_000;
const MAX_SLIPS = 6;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export interface SlipInput {
  /** A data: URL — what a browser's FileReader or canvas gives. */
  file: string;
  reference?: string;
  amount?: number;
  fromBank?: string;
}

/** The data URL's type and bytes, or why not. Pure, for the tests. */
export function parseSlipFile(file: string): { contentType: typeof TYPES[number]; bytes: Buffer } {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(file || '');
  if (!m) throw new FulfilmentError('The slip did not come through. Try a photo or a screenshot of it.', 400);
  const contentType = m[1].toLowerCase() as typeof TYPES[number];
  if (!TYPES.includes(contentType)) throw new FulfilmentError('A slip has to be a picture (JPG, PNG) or a PDF.', 415);
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length < 200) throw new FulfilmentError('That file is empty.', 400);
  if (bytes.length > MAX_SLIP_BYTES) throw new FulfilmentError('That file is too large. A screenshot of the slip is plenty.', 413);
  // The bytes have to be what the type says: a renamed file is refused, not stored.
  const head = bytes.subarray(0, 12);
  const ok = contentType === 'image/jpeg' ? head[0] === 0xff && head[1] === 0xd8
    : contentType === 'image/png' ? head.subarray(1, 4).toString('latin1') === 'PNG'
    : contentType === 'image/webp' ? head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
    : head.subarray(0, 5).toString('latin1') === '%PDF-';
  if (!ok) throw new FulfilmentError('That file is not the picture or PDF it says it is.', 415);
  return { contentType, bytes };
}

/** The ORD- order a customer's reference and token open, or null. */
async function orderFor(id: string, token: string): Promise<{ orderId: string; onlineId?: string } | null> {
  if (isOnlineId(id)) {
    const snap = await adminDb.collection(ONLINE_ORDERS).doc(id).get();
    if (!snap.exists) return null;
    const o = snap.data() as OnlineOrder;
    if (!safeEqual(o.token || '', token)) return null;
    if (o.state !== 'confirmed' || !o.orderId) throw new FulfilmentError('We have not confirmed this order yet: please wait for the bank details before paying.', 409);
    return { orderId: o.orderId, onlineId: id };
  }
  const snap = await adminDb.collection('orders').doc(id).get();
  const w = snap.exists ? (snap.data()?.website as WebsiteOrderMeta | undefined) : undefined;
  if (!w?.token || !safeEqual(w.token, token)) return null;
  return { orderId: id, onlineId: w.onlineId };
}

export async function recordSlip(id: string, token: string, input: SlipInput, now = new Date()): Promise<{ slip: WebsiteSlip; notified: string | null }> {
  const found = await orderFor(id, token);
  if (!found) throw new FulfilmentError('Order not found', 404);
  const { contentType, bytes } = parseSlipFile(input.file);
  const orderRef = adminDb.collection('orders').doc(found.orderId);
  const slipRef = adminDb.collection(SLIPS).doc();
  const slip: WebsiteSlip = {
    id: slipRef.id, at: now.toISOString(), contentType, bytes: bytes.length,
    ...(input.reference?.trim() ? { reference: input.reference.trim().slice(0, 60) } : {}),
    ...(Number(input.amount) > 0 ? { amount: Math.round(Number(input.amount)) } : {}),
    ...(input.fromBank?.trim() ? { fromBank: input.fromBank.trim().slice(0, 60) } : {}),
  };

  const order = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new FulfilmentError('Order not found', 404);
    const o = snap.data() as { status?: string; customerName?: string; subtotal?: number; website: WebsiteOrderMeta };
    const w = o.website;
    if (o.status === 'Cancelled' || o.status === 'Refunded' || w.paymentStatus === 'expired') throw new FulfilmentError('This order is closed. Message us on WhatsApp and we will help.', 409);
    if (w.paymentStatus === 'transfer_received') throw new FulfilmentError('We have your transfer already — nothing more to send.', 409);
    if ((w.slips?.length || 0) >= MAX_SLIPS) throw new FulfilmentError('We have several slips for this order already. Message us on WhatsApp.', 409);
    tx.set(slipRef, { orderId: found.orderId, ...(found.onlineId ? { onlineId: found.onlineId } : {}), contentType, data: bytes, bytes: bytes.length, at: slip.at });
    tx.update(orderRef, {
      'website.slips': FieldValue.arrayUnion(slip),
      ...(w.paymentStatus === 'awaiting_transfer' ? { 'website.paymentStatus': 'slip_sent' } : {}),
    });
    return o;
  });

  const image = contentType === 'image/jpeg' || contentType === 'image/png'
    ? { dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`, format: (contentType === 'image/png' ? 'PNG' : 'JPEG') as 'PNG' | 'JPEG' }
    : undefined;
  const notified = await trySendShopDoc(async () => (await import('@/lib/notifications/alerts')).onlineSlipDoc({
    orderId: found.orderId, onlineId: found.onlineId, customerName: order.customerName || '', total: customerTotal(order), slip, image,
  }, now), `${found.orderId} slip`);
  return { slip, notified };
}

/** The file, for the shop (the staff route checks who is asking). */
export async function readSlip(orderId: string, slipId: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  const snap = await adminDb.collection(SLIPS).doc(slipId).get();
  if (!snap.exists) return null;
  const d = snap.data() as { orderId: string; contentType: string; data: Buffer | Uint8Array };
  if (d.orderId !== orderId) return null;
  return { contentType: d.contentType, bytes: Buffer.from(d.data) };
}
