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
import { rateLimit, callerKey } from '@/lib/website/ratelimit';
import { configReadiness, loadRates, loadWebsiteConfig, ratesUsable } from '@/lib/website/config';
import { getCatalogAttributes, normalisePieceKey } from '@/lib/website/catalog-source';
import { quotePiece } from '@/lib/website/pricing';

export const dynamic = 'force-dynamic';

const Body = z.object({ pieces: z.array(z.string().min(1).max(300)).min(1).max(64) });

export function OPTIONS(req: NextRequest) { return preflight(req); }

export async function POST(req: NextRequest) {
  const limit = await rateLimit('quote', callerKey(req.headers), 240, 60);
  if (!limit.ok) return json(req, { error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json(req, { error: 'Send { pieces: string[] }' }, { status: 400 });

  const [config, rates, catalog] = await Promise.all([loadWebsiteConfig(), loadRates(), getCatalogAttributes()]);
  // The same test checkout applies: a price the site shows must be one it can
  // take an order at, or the bag leads to a refusal.
  const selling = config.enabled && ratesUsable(rates) && configReadiness(config).ready;

  const quotes = parsed.data.pieces.map(raw => {
    const key = normalisePieceKey(raw);
    const q = quotePiece(key, catalog[key], selling ? config : { ...config, enabled: false }, rates);
    // The site gets a price or a reason, never the breakdown — margins stay in the book.
    return { key, priceable: q.priceable, price: q.price, reason: q.reason };
  });

  return json(req, {
    selling,
    currency: config.currency,
    ratesAt: new Date().toISOString(),
    deliveryCharge: config.deliveryCharge,
    freeDeliveryOver: config.freeDeliveryOver ?? null,
    quotes,
  });
}
