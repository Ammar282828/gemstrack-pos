/**
 * GET /api/public/prices → the price book (lib/website/price-book.ts): every piece on the site at
 * today's rate, for the whole site at once.
 *
 * Cached at Google's edge in front of App Hosting for two minutes, and in the visitor's browser for
 * one, so a crowd on taheri.shop is a request every couple of minutes here. Nothing in the request
 * shapes the answer — it is the same for everyone — which is what makes it safe to cache.
 */

import { NextRequest } from 'next/server';
import { json, preflight } from '@/lib/website/cors';
import { priceBook } from '@/lib/website/price-book';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) { return preflight(req); }

export async function GET(req: NextRequest) {
  try {
    const res = json(req, await priceBook());
    res.headers.set('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600, stale-if-error=86400');
    return res;
  } catch (e) {
    console.error('[prices] could not build the book:', e instanceof Error ? e.message : e);
    return json(req, { error: 'Prices are unavailable just now.' }, { status: 503 });
  }
}
