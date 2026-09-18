/**
 * Placing an order from taheri.shop.
 *
 * Two halves. buildWebsiteOrder is pure: given the request, the shop's config,
 * today's rates and the catalogue, it either rejects the request with a reason
 * the site can show, or returns exactly what will be written — the products,
 * the order, the messages. placeWebsiteOrder is the thin part that writes it,
 * through the same createOrder every counter order goes through, so a website
 * order gets the next ORD- number and the day's rates stamped like any other.
 *
 * What the browser sends is treated as a wish list, never as a fact: keys are
 * looked up in the published manifest, every piece is re-quoted here, and the
 * total the customer saw is compared to the total we compute. If the rate moved
 * between the bag and the button, the order is refused with the new figure and
 * the site asks them to confirm it — nobody pays a number they did not see.
 */

import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import { createOrder } from '@/lib/writes/create-order';
import { normalizePhoneNumber } from '@/lib/utils';
import { bankDetails, loadRates, loadWebsiteConfig, ratesUsable, configReadiness } from './config';
import { getCatalogAttributes, normalisePieceKey } from './catalog-source';
import { getPosWeights, mergeWeights } from './weights';
import { deliveryChargeFor, quotePiece, type QuoteRates } from './pricing';
import { customerPlacedMessage, shopPlacedMessage, shopNumber, trySend } from './notify';
import type { PieceAttrs, PublicOrderView, Quote, WebsiteBankDetails, WebsiteConfig, WebsiteOrderMeta } from './types';

// ─── Request ────────────────────────────────────────────────────────────────

export const CheckoutBody = z.object({
  customer: z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(10).max(20),
    email: z.string().trim().email().max(120).optional().or(z.literal('')),
  }),
  delivery: z.object({
    address: z.string().trim().min(10).max(300),
    city: z.string().trim().min(2).max(60),
    notes: z.string().trim().max(300).optional().or(z.literal('')),
  }),
  pieces: z.array(z.string().min(1).max(300)).min(1).max(12),
  /** The grand total the site showed. Must match what we compute now. */
  expectedTotal: z.number().int().nonnegative(),
  /** Stable per bag; a retry of the same bag returns the same order. */
  bagId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  /** Honeypot. Real forms leave it empty. */
  website: z.string().max(0).optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutBody>;

export class CheckoutRejected extends Error {
  constructor(public code: string, message: string, public status = 400, public detail?: unknown) { super(message); }
}

// ─── The pure half ──────────────────────────────────────────────────────────

export interface BuildContext {
  config: WebsiteConfig;
  rates: QuoteRates;
  catalog: Record<string, PieceAttrs>;
  origin: string;
  bank?: WebsiteBankDetails;
  now?: Date;
  token?: string;
}

export interface BuiltOrder {
  products: Record<string, unknown>[];
  order: Record<string, unknown>;
  quotes: Quote[];
  subtotal: number;
  deliveryCharge: number;
  grandTotal: number;
  token: string;
  lines: { description: string; price: number; image: string }[];
}

export function buildWebsiteOrder(raw: unknown, ctx: BuildContext): BuiltOrder {
  // A filled honeypot is a bot. Refuse before parsing so it learns nothing
  // about the form from the field errors a real mistake would get.
  if (raw && typeof raw === 'object' && (raw as { website?: unknown }).website) throw new CheckoutRejected('rejected', 'Rejected.', 400);
  const parsed = CheckoutBody.safeParse(raw);
  if (!parsed.success) throw new CheckoutRejected('invalid', 'Please check the form — something is missing or malformed.', 400, parsed.error.flatten().fieldErrors);
  const input = parsed.data;

  const readiness = configReadiness(ctx.config, ctx.bank);
  if (!readiness.ready || !ratesUsable(ctx.rates)) {
    throw new CheckoutRejected('not_selling', 'Online ordering is not open right now. Please message us on WhatsApp.', 503);
  }

  const keys = [...new Set(input.pieces.map(normalisePieceKey))];
  const quotes = keys.map(k => quotePiece(k, ctx.catalog[k], ctx.config, ctx.rates));
  const unpriceable = quotes.filter(q => !q.priceable);
  if (unpriceable.length) {
    throw new CheckoutRejected('unpriceable', 'One of these pieces can only be ordered by enquiry.', 409, unpriceable.map(q => ({ key: q.key, reason: q.reason })));
  }

  const subtotal = quotes.reduce((s, q) => s + (q.price || 0), 0);
  const deliveryCharge = deliveryChargeFor(ctx.config, subtotal);
  const grandTotal = subtotal + deliveryCharge;
  if (grandTotal !== input.expectedTotal) {
    throw new CheckoutRejected('price_changed', 'The gold rate has moved since you filled your bag. Please review the new total.', 409, { grandTotal, subtotal, deliveryCharge, quotes: quotes.map(q => ({ key: q.key, price: q.price })) });
  }

  const now = ctx.now || new Date();
  const phone = normalizePhoneNumber(input.customer.phone);
  const token = ctx.token || randomBytes(18).toString('base64url');
  const origin = ctx.origin.replace(/\/+$/, '');

  const products = quotes.map(q => stripUndefined(productFor(q, ctx.catalog[q.key]!, ctx.config, origin, now)));
  const lines = quotes.map((q, i) => ({ description: String(products[i].name), price: q.price!, image: `${origin}/catalog-thumb/${encodeURI(q.key)}` }));

  const items = quotes.map((q, i) => {
    const b = q.breakdown!;
    return {
      description: products[i].name,
      itemCategory: q.collection,
      metalType: b.metalType,
      karat: b.karat,
      estimatedWeightG: b.weightGrams,
      stoneWeightG: 0,
      hasStones: b.stoneCharges > 0,
      hasDiamonds: b.diamondCharges > 0,
      stoneDetails: ctx.catalog[q.key]!.stone !== 'None' ? ctx.catalog[q.key]!.stone : undefined,
      wastagePercentage: b.wastagePercentage,
      makingCharges: b.makingCharges,
      diamondCharges: b.diamondCharges,
      stoneCharges: b.stoneCharges,
      metalCost: b.metalCost,
      wastageCost: b.wastageCost,
      totalEstimate: q.price,
      referenceSku: products[i].sku,
      sampleGiven: false,
      isCompleted: false,
    };
  });

  const website: WebsiteOrderMeta = {
    token,
    paymentMethod: 'bank_transfer',
    paymentStatus: 'awaiting_transfer',
    pieces: keys,
    deliveryCharge,
    quotedAt: now.toISOString(),
    placedAt: now.toISOString(),
    customerPhone: phone,
    customerEmail: input.customer.email || undefined,
  };

  const order = {
    status: 'Pending',
    source: 'website',
    customerName: input.customer.name,
    customerContact: phone,
    items,
    subtotal,
    grandTotal,
    advancePayment: 0,
    delivery: {
      required: true,
      address: input.delivery.address,
      city: input.delivery.city,
      contactName: input.customer.name,
      contactPhone: phone,
      notes: input.delivery.notes || undefined,
      charge: deliveryCharge,
    },
    summary: `Website order — ${keys.length} piece${keys.length === 1 ? '' : 's'}, full advance by bank transfer, Leopards to ${input.delivery.city}.`,
    website: { ...website, bagId: input.bagId },
  };

  return { products, order: stripUndefined(order), quotes, subtotal, deliveryCharge, grandTotal, token, lines };
}

/** A product record for a photographed piece, made at the moment it is bought. */
function productFor(q: Quote, attrs: PieceAttrs, config: WebsiteConfig, origin: string, now: Date) {
  const b = q.breakdown!;
  const file = q.key.split('/').pop() || q.key;
  const design = file.replace(/\.webp$/i, '');
  const stone = attrs.stone && attrs.stone !== 'None' ? ` with ${attrs.stone}` : '';
  return {
    sku: skuFor(q.key),
    name: `${attrs.metal} ${singular(q.collection)}${stone} — ${design}`,
    categoryId: config.posCategoryId,
    metalType: b.metalType,
    karat: b.karat,
    metalWeightG: b.weightGrams,
    hasStones: b.stoneCharges > 0,
    stoneWeightG: 0,
    stoneDetails: stone ? attrs.stone : undefined,
    wastagePercentage: b.wastagePercentage,
    makingCharges: b.makingCharges,
    hasDiamonds: b.diamondCharges > 0,
    diamondCharges: b.diamondCharges,
    stoneCharges: b.stoneCharges,
    miscCharges: 0,
    imageUrl: `${origin}/catalog-full/${encodeURI(q.key)}`,
    description: `Ordered from taheri.shop. Catalogue piece ${q.key}. Style: ${attrs.style}; cut: ${attrs.cut}.`,
    source: 'website',
    websitePiece: q.key,
    createdAt: now.toISOString(),
  };
}

/** Deterministic, so the same design bought twice is the same product. */
export function skuFor(key: string): string {
  return 'WEB-' + createHash('sha1').update(key).digest('base64url').slice(0, 8).toUpperCase().replace(/[-_]/g, 'X');
}

const singular = (name: string) => name.replace(/(\w+?)(?<!s)s\b(?=[^\w]*$)/, '$1');

// ─── The writing half ───────────────────────────────────────────────────────

export interface PlacedOrder {
  id: string;
  token: string;
  statusUrl: string;
  grandTotal: number;
  subtotal: number;
  deliveryCharge: number;
  bank: WebsiteBankDetails;
  lines: BuiltOrder['lines'];
}

export async function placeWebsiteOrder(raw: unknown, meta: { caller: string; origin: string }): Promise<PlacedOrder> {
  const [config, rates, published, pos] = await Promise.all([loadWebsiteConfig(), loadRates(), getCatalogAttributes(), getPosWeights()]);
  const catalog = mergeWeights(published, pos);
  const origin = process.env.WEBSITE_ORIGIN || 'https://taheri.shop';
  const bank = bankDetails();
  const built = buildWebsiteOrder(raw, { config, rates, catalog, origin, bank });

  // The same bag submitted twice — a double tap, a retry after a timeout — is one order.
  const bagId = (built.order.website as { bagId: string }).bagId;
  const dup = await adminDb.collection('orders').where('website.bagId', '==', bagId).limit(1).get();
  if (!dup.empty) {
    const d = dup.docs[0].data();
    const w = d.website as WebsiteOrderMeta;
    return { id: dup.docs[0].id, token: w.token, statusUrl: statusUrl(origin, dup.docs[0].id, w.token), grandTotal: d.grandTotal, subtotal: d.subtotal, deliveryCharge: w.deliveryCharge, bank, lines: built.lines };
  }

  const batch = adminDb.batch();
  for (const p of built.products) batch.set(adminDb.collection('products').doc(String(p.sku)), p, { merge: true });
  await batch.commit();

  const created = await createOrder(adminPort, built.order as never, {
    createCustomer: async c => {
      const ref = await adminDb.collection('customers').add({
        name: c.name, phone: c.phone || null, email: null, address: null, source: 'website',
        createdAt: new Date().toISOString(), createdBy: 'taheri.shop',
      });
      return { id: ref.id, name: c.name };
    },
    normalizePhone: normalizePhoneNumber,
    clean: stripUndefined,
  }, { log: async (action, title, detail, relatedId) => { console.log('[website order]', action, title, detail, relatedId); } });

  const url = statusUrl(origin, created.id, built.token);
  const summary = { id: created.id, customerName: String(built.order.customerName), customerPhone: String(built.order.customerContact), city: (built.order.delivery as { city: string }).city, lines: built.lines, subtotal: built.subtotal, deliveryCharge: built.deliveryCharge, grandTotal: built.grandTotal, statusUrl: url };
  const [toCustomer, toShop] = await Promise.all([
    trySend(summary.customerPhone, customerPlacedMessage(summary, bank)),
    trySend(shopNumber(), shopPlacedMessage(summary)),
  ]);
  if (toCustomer || toShop) {
    await adminDb.collection('orders').doc(created.id).update({ 'website.notify': { customer: toCustomer, shop: toShop, at: new Date().toISOString() } });
  }

  return { id: created.id, token: built.token, statusUrl: url, grandTotal: built.grandTotal, subtotal: built.subtotal, deliveryCharge: built.deliveryCharge, bank, lines: built.lines };
}

export const statusUrl = (origin: string, id: string, token: string) => `${origin.replace(/\/+$/, '')}/order/${encodeURIComponent(id)}?t=${encodeURIComponent(token)}`;

// ─── The customer's view ────────────────────────────────────────────────────

export async function publicOrderView(id: string, token: string): Promise<PublicOrderView | null> {
  if (!id || !token) return null;
  const snap = await adminDb.collection('orders').doc(id).get();
  if (!snap.exists) return null;
  const o = snap.data() as Record<string, unknown>;
  const w = o.website as WebsiteOrderMeta | undefined;
  if (!w?.token || !safeEqual(w.token, token)) return null;

  const origin = (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');
  const items = (o.items as { description: string; totalEstimate?: number; referenceSku?: string }[] || []).map((it, i) => ({
    description: it.description,
    price: it.totalEstimate || 0,
    image: w.pieces[i] ? `${origin}/catalog-thumb/${encodeURI(w.pieces[i])}` : '',
  }));
  const delivery = (o.delivery || {}) as { contactName?: string; city?: string };
  const leopards = o.leopards as { cn: string; trackingUrl: string; deliveredAt?: string } | undefined;
  return {
    id: snap.id,
    placedAt: w.placedAt,
    status: String(o.status || 'Pending'),
    paymentStatus: w.paymentStatus,
    items,
    subtotal: Number(o.subtotal) || 0,
    deliveryCharge: w.deliveryCharge,
    grandTotal: Number(o.grandTotal) || 0,
    bank: bankDetails(),
    deliveryTo: { name: delivery.contactName || String(o.customerName || ''), city: delivery.city || '' },
    courier: leopards ? { cn: leopards.cn, trackingUrl: leopards.trackingUrl, deliveredAt: leopards.deliveredAt } : undefined,
  };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function stripUndefined<T extends object>(o: T): T {
  if (Array.isArray(o)) return o.map(v => (v && typeof v === 'object' ? stripUndefined(v as object) : v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' ? stripUndefined(v as object) : v;
  }
  return out as T;
}
