/**
 * Online orders: what taheri.shop places, and what the shop does before it is an order.
 *
 * The owner, 2026-10-04: "label online orders (they will always need to be confirmed before they
 * get fully integrated)". So placing one writes only `online_orders/{ONL-…}`: no ORD- number, no
 * customer, no product, nothing on the karigars' lists or in Analytics, and the customer is sent
 * no bank details, so no money can move on an order nobody has looked at. The shop sees it at the
 * top of Orders (Online — to confirm) and gets the PDF alert.
 *
 *   confirm  the products and the ORD- order are written through the same createOrder the counter
 *            uses, stamped with the rates the customer was quoted, labelled Online
 *            (`source: 'website'`, `website.onlineId`). The customer gets the bank details and a
 *            day's hold on the price (WEBSITE_HOLD_HOURS); the hold starts now, not when they
 *            ordered, so a night's wait for the shop to open does not eat their time to pay.
 *   decline  with a reason the customer is sent. Nothing else is written.
 *
 * The customer keeps one reference, the ONL- number: their link works before and after, and the
 * page shows the shop's ORD- number once there is one. The money (fulfilment.ts) and the reminders
 * (sweepOnline, on the five-minute tick) follow the ORD- order.
 *
 * Two people pressing Confirm at once make one order: confirming first claims the online order in a
 * transaction (`confirming`), and a claim older than two minutes — a confirm that died half way — can
 * be taken again.
 */

import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { createOrder } from '@/lib/writes/create-order';
import { normalizePhoneNumber } from '@/lib/utils';
import { bankDetails, loadRates, loadWebsiteConfig } from './config';
import { getCatalogAttributes } from './catalog-source';
import { getPosWeights, mergeWeights } from './weights';
import { deliveryChargeFor } from './pricing';
import { priceBook } from './price-book';
import { buildWebsiteOrder, publicOrderView, ratesForOrder, safeEqual, statusUrl, stripUndefined, websiteCustomer } from './checkout';
import {
  customerConfirmedMessage, customerDeclinedMessage, customerReceivedMessage, customerReminderMessage,
  shopNumber, trySend, trySendShopCopy, trySendShopDoc, type OrderSummaryForMessage,
} from './notify';
import { FulfilmentError } from './fulfilment';
import type { OnlineOrder, OnlineOrderRow, PublicOrderView, WebsiteOrderMeta } from './types';

export const ONLINE_ORDERS = 'online_orders';

const origin = () => (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');
export const holdHours = () => (Number(process.env.WEBSITE_HOLD_HOURS) > 0 ? Number(process.env.WEBSITE_HOLD_HOURS) : 24);

/** Six characters a customer can read out on the phone: no 0/O, 1/I/L. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function newOnlineId(bytes: Buffer = randomBytes(6)): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `ONL-${out}`;
}

export const isOnlineId = (id: string) => /^ONL-[A-Z0-9]{6}$/.test(id);

function summaryOf(o: OnlineOrder, id = o.id, holdUntil?: string): OrderSummaryForMessage {
  return {
    id, customerName: o.customer.name, customerPhone: o.customer.phone, city: o.delivery.city,
    lines: o.lines.map(l => ({ description: l.description, price: l.price })),
    subtotal: o.subtotal, deliveryCharge: o.deliveryCharge, grandTotal: o.grandTotal,
    statusUrl: statusUrl(origin(), o.id, o.token), ...(holdUntil ? { holdUntil } : {}),
  };
}

// ─── Placing ────────────────────────────────────────────────────────────────

export interface PlacedOnline {
  id: string;
  token: string;
  statusUrl: string;
  confirmation: 'to_confirm' | 'confirmed' | 'declined';
  grandTotal: number;
  subtotal: number;
  deliveryCharge: number;
  lines: { description: string; price: number; image: string }[];
}

export async function placeOnlineOrder(raw: unknown, meta: { customerUid?: string }): Promise<PlacedOnline> {
  // Read fresh, not from the price book's memory: this is the price the customer will be held to.
  const [config, rates, published, pos] = await Promise.all([loadWebsiteConfig(), loadRates(), getCatalogAttributes(), getPosWeights()]);
  const built = buildWebsiteOrder(raw, { config, rates, catalog: mergeWeights(published, pos), origin: origin(), bank: bankDetails() });
  const order = built.order as Record<string, unknown> & { website: WebsiteOrderMeta & { bagId: string }; customerName: string; customerContact: string; delivery: { address: string; city: string; notes?: string } };
  if (meta.customerUid) order.website.customerUid = meta.customerUid;
  const bagId = order.website.bagId;

  const toPlaced = (o: Pick<OnlineOrder, 'id' | 'token' | 'state' | 'grandTotal' | 'subtotal' | 'deliveryCharge' | 'lines'>): PlacedOnline => ({
    id: o.id, token: o.token, statusUrl: statusUrl(origin(), o.id, o.token),
    confirmation: o.state === 'declined' ? 'declined' : o.state === 'confirmed' ? 'confirmed' : 'to_confirm',
    grandTotal: o.grandTotal, subtotal: o.subtotal, deliveryCharge: o.deliveryCharge,
    lines: o.lines.map(l => ({ description: l.description, price: l.price, image: l.image })),
  });

  // The same bag sent twice — a double tap, a retry after a timeout — is one order.
  const dup = await adminDb.collection(ONLINE_ORDERS).where('bagId', '==', bagId).limit(1).get();
  if (!dup.empty) return toPlaced({ id: dup.docs[0].id, ...(dup.docs[0].data() as Omit<OnlineOrder, 'id'>) });

  const sizes = order.website.sizes || {};
  const items = order.items as { description: string }[];
  const online: Omit<OnlineOrder, 'id'> = {
    state: 'to_confirm',
    token: built.token,
    bagId,
    placedAt: order.website.placedAt,
    customer: { name: order.customerName, phone: order.customerContact, ...(order.website.customerEmail ? { email: order.website.customerEmail } : {}) },
    delivery: { address: order.delivery.address, city: order.delivery.city, ...(order.delivery.notes ? { notes: order.delivery.notes } : {}) },
    ...(meta.customerUid ? { customerUid: meta.customerUid } : {}),
    lines: built.quotes.map((q, i) => ({ key: q.key, description: items[i].description, price: q.price!, image: built.lines[i].image, ...(sizes[q.key] ? { size: sizes[q.key] } : {}) })),
    subtotal: built.subtotal,
    deliveryCharge: built.deliveryCharge,
    grandTotal: built.grandTotal,
    rates: ratesForOrder(rates),
    draft: { products: built.products, order: built.order },
  };

  // An id that is taken (one in a billion) is drawn again; create() refuses to overwrite.
  let id = '';
  for (let tries = 0; tries < 4 && !id; tries++) {
    const candidate = newOnlineId();
    try { await adminDb.collection(ONLINE_ORDERS).doc(candidate).create(stripUndefined(online)); id = candidate; }
    catch (e) { if ((e as { code?: number }).code !== 6) throw e; }
  }
  if (!id) throw new Error('Could not number the order');

  const placed = { id, ...online } as OnlineOrder;
  const summary = summaryOf(placed);
  const [toCustomer, toShop] = await Promise.all([trySend(placed.customer.phone, customerReceivedMessage(summary)), trySendShopCopy(summary)]);
  if (toCustomer || toShop) await adminDb.collection(ONLINE_ORDERS).doc(id).update({ notify: { received: toCustomer, shop: toShop } }).catch(() => undefined);
  return toPlaced(placed);
}

// ─── The shop's inbox ───────────────────────────────────────────────────────

async function load(id: string): Promise<OnlineOrder> {
  const snap = await adminDb.collection(ONLINE_ORDERS).doc(id).get();
  if (!snap.exists) throw new FulfilmentError('Online order not found', 404);
  return { id: snap.id, ...(snap.data() as Omit<OnlineOrder, 'id'>) };
}

/** How many wait for the shop: the sidebar's count beside Orders. One aggregate read. */
export async function countWaiting(): Promise<number> {
  const snap = await adminDb.collection(ONLINE_ORDERS).where('state', '==', 'to_confirm').count().get();
  return snap.data().count;
}

/** Waiting ones first, then the last fortnight's. */
export async function listOnlineOrders(now = new Date()): Promise<OnlineOrderRow[]> {
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
  const [waiting, recent] = await Promise.all([
    adminDb.collection(ONLINE_ORDERS).where('state', 'in', ['to_confirm', 'confirming']).limit(100).get(),
    adminDb.collection(ONLINE_ORDERS).where('placedAt', '>=', since).orderBy('placedAt', 'desc').limit(100).get(),
  ]);
  const seen = new Set<string>();
  const docs = [...waiting.docs, ...recent.docs].filter(d => !seen.has(d.id) && seen.add(d.id));
  // What the same pieces cost now, so whoever confirms sees how far gold has moved since.
  const book = docs.some(d => d.data().state === 'to_confirm') ? await priceBook().catch(() => null) : null;
  const config = book?.selling ? await loadWebsiteConfig().catch(() => null) : null;
  const rows = docs.map(d => {
    const { draft: _draft, rates: _rates, ...o } = { id: d.id, ...(d.data() as Omit<OnlineOrder, 'id'>) };
    let todayTotal: number | null = null;
    if (o.state === 'to_confirm' && book?.selling && config) {
      const prices = o.lines.map(l => book.prices[l.key]?.[0]);
      if (prices.every(p => typeof p === 'number')) {
        const sub = (prices as number[]).reduce((s, p) => s + p, 0);
        todayTotal = sub + deliveryChargeFor(config, sub);
      }
    }
    return { ...o, statusUrl: statusUrl(origin(), o.id, o.token), todayTotal };
  });
  const rank = (r: OnlineOrderRow) => (r.state === 'to_confirm' || r.state === 'confirming' ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || b.placedAt.localeCompare(a.placedAt));
}

export async function confirmOnlineOrder(id: string, by: string, now = new Date()): Promise<{ orderId: string; notified: string | null }> {
  const bank = bankDetails();
  if (!bank.bankName || !(bank.iban || bank.accountNumber)) throw new FulfilmentError('The bank account is not set (NEXT_PUBLIC_STORE_BANK_LINE and NEXT_PUBLIC_STORE_IBAN), so the customer could not be told where to pay.', 409);
  const ref = adminDb.collection(ONLINE_ORDERS).doc(id);
  const at = now.toISOString();
  const claim = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new FulfilmentError('Online order not found', 404);
    const o = { id: snap.id, ...(snap.data() as Omit<OnlineOrder, 'id'>) };
    if (o.state === 'confirmed') return { already: true as const, o };
    if (o.state === 'declined') throw new FulfilmentError('This order was declined.', 409);
    if (o.state === 'confirming' && o.claimedAt && now.getTime() - Date.parse(o.claimedAt) < 120_000) throw new FulfilmentError(`${o.claimedBy || 'Someone'} is confirming it right now.`, 409);
    tx.update(ref, { state: 'confirming', claimedAt: at, claimedBy: by });
    return { already: false as const, o };
  });
  if (claim.already) return { orderId: claim.o.orderId || '', notified: null };
  const o = claim.o;

  const holdUntil = new Date(now.getTime() + holdHours() * 3_600_000).toISOString();
  let orderId: string;
  try {
    const batch = adminDb.batch();
    for (const p of o.draft.products) batch.set(adminDb.collection('products').doc(String(p.sku)), p, { merge: true });
    await batch.commit();
    const draft = o.draft.order as Record<string, unknown> & { website: WebsiteOrderMeta };
    const created = await createOrder(adminPort, {
      ...draft,
      items: draft.items as { description?: string }[],
      ratesApplied: o.rates,
      website: { ...draft.website, token: o.token, onlineId: o.id, confirmedAt: at, confirmedBy: by, holdUntil },
    }, {
      createCustomer: websiteCustomer,
      normalizePhone: normalizePhoneNumber,
      clean: stripUndefined,
    }, { log: async (action, title, detail, relatedId) => { console.log('[online order]', action, title, detail, relatedId, 'from', o.id, 'by', by); } });
    orderId = created.id;
  } catch (e) {
    // Let it be confirmed again: nothing was written, or the order number was not taken.
    await ref.update({ state: 'to_confirm', claimedAt: FieldValue.delete(), claimedBy: FieldValue.delete() }).catch(() => undefined);
    throw e;
  }
  await ref.update({ state: 'confirmed', orderId, confirmedAt: at, confirmedBy: by, holdUntil });

  const notified = await trySend(o.customer.phone, customerConfirmedMessage(summaryOf(o, o.id, holdUntil), bank));
  if (notified) await adminDb.collection('orders').doc(orderId).update({ 'website.notify': { confirmed: notified, at } }).catch(() => undefined);
  return { orderId, notified };
}

export async function declineOnlineOrder(id: string, by: string, reason: string, now = new Date()): Promise<{ notified: string | null }> {
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) throw new FulfilmentError('Say why, in a few words: the customer is sent it.', 400);
  const ref = adminDb.collection(ONLINE_ORDERS).doc(id);
  const o = await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new FulfilmentError('Online order not found', 404);
    const cur = { id: snap.id, ...(snap.data() as Omit<OnlineOrder, 'id'>) };
    if (cur.state === 'confirmed' || cur.state === 'confirming') throw new FulfilmentError('It is confirmed already: cancel the order itself instead.', 409);
    if (cur.state === 'declined') return null;
    tx.update(ref, { state: 'declined', declinedAt: now.toISOString(), declinedBy: by, declineReason: why });
    return cur;
  });
  if (!o) return { notified: null };
  const notified = await trySend(o.customer.phone, customerDeclinedMessage(o.id, o.customer.name, why, statusUrl(origin(), o.id, o.token)));
  return { notified };
}

// ─── The customer's view ────────────────────────────────────────────────────

export async function publicOnlineView(id: string, token: string): Promise<PublicOrderView | null> {
  if (!id || !token) return null;
  const snap = await adminDb.collection(ONLINE_ORDERS).doc(id).get();
  if (!snap.exists) return null;
  const o = { id: snap.id, ...(snap.data() as Omit<OnlineOrder, 'id'>) };
  if (!o.token || !safeEqual(o.token, token)) return null;
  // Confirmed: the order itself says where it stands (money, karigars, Leopards).
  if (o.state === 'confirmed' && o.orderId) {
    const v = await publicOrderView(o.orderId, token);
    if (v) return { ...v, id: o.id, ref: o.orderId };
  }
  return {
    id: o.id,
    confirmation: o.state === 'declined' ? 'declined' : 'to_confirm',
    ...(o.declineReason ? { declineReason: o.declineReason } : {}),
    placedAt: o.placedAt,
    status: o.state === 'declined' ? 'Cancelled' : 'Pending',
    paymentStatus: 'awaiting_transfer',
    items: o.lines.map(l => ({ description: l.description, price: l.price, image: l.image, path: l.key, ...(l.size ? { size: l.size } : {}) })),
    subtotal: o.subtotal,
    deliveryCharge: o.deliveryCharge,
    grandTotal: o.grandTotal,
    bank: null,
    deliveryTo: { name: o.customer.name, city: o.delivery.city },
    whatsapp: shopNumber(),
  };
}

/** A signed-in customer's orders, newest first, as their account page lists them. */
export async function onlineOrdersFor(uid: string): Promise<{ id: string; token: string; placedAt: string; confirmation: PublicOrderView['confirmation']; status: string; paymentStatus: string; grandTotal: number; courier?: PublicOrderView['courier']; items: { description: string; image: string }[] }[]> {
  const snap = await adminDb.collection(ONLINE_ORDERS).where('customerUid', '==', uid).limit(50).get();
  const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<OnlineOrder, 'id'>) }));
  const confirmed = list.filter(o => o.state === 'confirmed' && o.orderId);
  const orders = confirmed.length ? await adminDb.getAll(...confirmed.map(o => adminDb.collection('orders').doc(o.orderId!))) : [];
  const byId = new Map(orders.filter(s => s.exists).map(s => [s.id, s.data() as { status?: string; website?: WebsiteOrderMeta; leopards?: { cn: string; trackingUrl: string; deliveredAt?: string } }]));
  return list.map(o => {
    const ord = o.orderId ? byId.get(o.orderId) : undefined;
    return {
      id: o.id, token: o.token, placedAt: o.placedAt,
      confirmation: o.state === 'declined' ? 'declined' as const : o.state === 'confirmed' ? 'confirmed' as const : 'to_confirm' as const,
      status: ord ? String(ord.status || 'Pending') : o.state === 'declined' ? 'Cancelled' : 'Pending',
      paymentStatus: ord?.website?.paymentStatus || 'awaiting_transfer',
      grandTotal: o.grandTotal,
      ...(ord?.leopards ? { courier: { cn: ord.leopards.cn, trackingUrl: ord.leopards.trackingUrl, deliveredAt: ord.leopards.deliveredAt } } : {}),
      items: o.lines.map(l => ({ description: l.description, image: l.image })),
    };
  }).sort((a, b) => b.placedAt.localeCompare(a.placedAt));
}

// ─── The five-minute tick ───────────────────────────────────────────────────

/** Karachi's hour, 0–23, and whether it is Friday there. */
function karachiClock(now: Date): { hour: number; friday: boolean } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(now);
  return { hour: Number(parts.find(p => p.type === 'hour')?.value ?? 0), friday: parts.find(p => p.type === 'weekday')?.value === 'Fri' };
}

/** Shop hours (Sat–Thu 11–21, Fri 15:30–20), to the hour: when a nudge to the shop is any use. */
export function shopOpen(now: Date): boolean {
  const { hour, friday } = karachiClock(now);
  return friday ? hour >= 15 && hour < 20 : hour >= 11 && hour < 21;
}

/** Waking hours, for a customer's reminder. */
const customerAwake = (now: Date) => { const { hour } = karachiClock(now); return hour >= 9 && hour < 22; };

/**
 * What the tick does for online orders, each once:
 *   - an online order waiting two hours in shop hours: one PDF to the shop listing every one waiting;
 *   - a confirmed order with no transfer, four hours before its hold ends: a reminder to the customer
 *     (only in waking hours; missed at night, it is not sent late);
 *   - the hold over with no transfer recorded: a PDF to the shop to check the bank. Nothing is
 *     cancelled on its own — people pay and forget the slip, and a lapse message to someone whose
 *     money is in the account is the worst thing the shop could send.
 */
export async function sweepOnline(now = new Date(), dry = false): Promise<{ nudged: number; reminded: number; holdEnded: number }> {
  const out = { nudged: 0, reminded: 0, holdEnded: 0 };
  const iso = now.toISOString();

  if (shopOpen(now)) {
    const waiting = await adminDb.collection(ONLINE_ORDERS).where('state', '==', 'to_confirm').limit(50).get();
    const all = waiting.docs.map(d => ({ id: d.id, ...(d.data() as Omit<OnlineOrder, 'id'>) }));
    const due = all.filter(o => !o.shopNudgedAt && now.getTime() - Date.parse(o.placedAt) > 2 * 3_600_000);
    if (due.length) {
      out.nudged = due.length;
      if (!dry) {
        const { onlineWaitingDoc } = await import('@/lib/notifications/alerts');
        await trySendShopDoc(() => onlineWaitingDoc(all.map(o => ({ id: o.id, customerName: o.customer.name, city: o.delivery.city, grandTotal: o.grandTotal, placedAt: o.placedAt })), now), 'online waiting');
        const batch = adminDb.batch();
        for (const o of due) batch.update(adminDb.collection(ONLINE_ORDERS).doc(o.id), { shopNudgedAt: iso });
        await batch.commit();
      }
    }
  }

  const unpaid = await adminDb.collection('orders').where('website.paymentStatus', 'in', ['awaiting_transfer', 'slip_sent']).limit(100).get();
  for (const d of unpaid.docs) {
    const o = d.data() as { status?: string; customerName?: string; customerContact?: string; subtotal?: number; website: WebsiteOrderMeta };
    const w = o.website;
    if (!w.holdUntil || o.status === 'Cancelled' || o.status === 'Refunded') continue;
    const left = Date.parse(w.holdUntil) - now.getTime();
    const ref = w.onlineId || d.id;
    const total = typeof w.total === 'number' ? w.total : (Number(o.subtotal) || 0) + (w.deliveryCharge || 0);
    if (w.paymentStatus === 'awaiting_transfer' && !w.remindedAt && left > 0 && left < 4 * 3_600_000 && customerAwake(now)) {
      out.reminded++;
      if (!dry) {
        await d.ref.update({ 'website.remindedAt': iso });
        await trySend(o.customerContact, customerReminderMessage(ref, o.customerName || 'there', total, w.holdUntil, statusUrl(origin(), ref, w.token)));
      }
    }
    if (left <= 0 && !w.holdEndedAt && shopOpen(now)) {
      out.holdEnded++;
      if (!dry) {
        await d.ref.update({ 'website.holdEndedAt': iso });
        const { holdEndedDoc } = await import('@/lib/notifications/alerts');
        await trySendShopDoc(() => holdEndedDoc({ orderId: d.id, onlineId: w.onlineId, customerName: o.customerName || '', total, slipSent: w.paymentStatus === 'slip_sent' }, now), `${d.id} hold ended`);
      }
    }
  }
  return out;
}

/** Whether the house has ever taken an online order: the tick skips the rest where it has not (Mina). */
export async function onlineOrdersPossible(): Promise<boolean> {
  const any = await adminDb.collection(ONLINE_ORDERS).limit(1).get().catch(() => null);
  return !!any && !any.empty;
}
