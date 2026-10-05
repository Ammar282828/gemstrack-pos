/**
 * POST /api/public/quote   { pieces: string[] }  → prices at today's rate.
 *
 * Called by the catalogue for the pieces on screen — up to a page of 48. The
 * reply is what the site shows beside each photograph, and nothing in the
 * request influences a price: keys are looked up in the manifest the site
 * itself published, and priced from the shop's settings.
 */

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, preflight } from '@/lib/website/cors';
import { callerKey } from '@/lib/website/ratelimit';
import { memoryLimit } from '@/lib/website/memory-limit';
import { isSelling, quoteInputs } from '@/lib/website/price-book';
import { getCatalogAttributes, normalisePieceKey } from '@/lib/website/catalog-source';
import { quotePiece } from '@/lib/website/pricing';
import { mergeWeights } from '@/lib/website/weights';
import { getPieceWeights } from '@/lib/website/piece-weights';

export const dynamic = 'force-dynamic';

const Body = z.object({ pieces: z.array(z.string().min(1).max(300)).min(1).max(64) });

export function OPTIONS(req: NextRequest) { return preflight(req); }

export async function POST(req: NextRequest) {
  // In this instance's memory, not a Firestore transaction per ask: a price lookup changes nothing,
  // and many phones share one address on Pakistan's mobile networks — a crowd must not trip it.
  // The site now reads the cached price book (GET /api/public/prices) and asks here only for a piece
  // the book doesn't have yet (a drop since it was built).
  const limit = memoryLimit('quote', callerKey(req.headers), 600, 60);
  if (!limit.ok) return json(req, { error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: 'Send { pieces: string[] }' }, { status: 400 });

  const [{ config, rates }, published, pos] = await Promise.all([quoteInputs(), getCatalogAttributes(), getPieceWeights()]);
  const catalog = mergeWeights(published, pos);
  // The same test checkout applies: a price the site shows must be one it can
  // take an order at, or the bag leads to a refusal.
  const selling = isSelling(config, rates);

  const quotes = parsed.data.pieces.map(raw => {
    const key = normalisePieceKey(raw);
    const q = quotePiece(key, catalog[key], selling ? config : { ...config, enabled: false }, rates);
    const a = catalog[key];
    // The site gets a price or a reason, never the breakdown — margins stay in
    // the book. The weight and where it came from travel regardless of selling:
    // the site draws counter-entered weights onto the photo.
    // A drop the catalogue doesn't hold yet still carries a weight the counter recorded (no price).
    const counter = a ? null : pos[key]?.weightGrams ?? null;
    return { key, priceable: q.priceable, price: q.price, reason: q.reason, weightGrams: a?.weightGrams ?? counter, weightSource: a?.weightSource ?? (counter ? 'pos' : null) };
  });

  return json(req, {
    selling,
    currency: config.currency,
    // When the shop last set its rate (not the moment of asking, which it used to say — a quote
    // struck at last week's rate read as today's). Before any rate is stamped, the moment of
    // asking, as before, so the site never shows an empty date; `ratesUpdatedAt` is the plain fact.
    ratesAt: rates.updatedAt ?? new Date().toISOString(),
    ratesUpdatedAt: rates.updatedAt,
    deliveryCharge: config.deliveryCharge,
    freeDeliveryOver: config.freeDeliveryOver ?? null,
    quotes,
  });
}
