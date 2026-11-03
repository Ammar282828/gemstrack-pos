/**
 * GET /api/public/catalog-feed → every piece on the house's website as a Meta product feed (CSV, price 0), which Meta
 * fetches daily for the WhatsApp catalogue (lib/website/catalog-feed.ts). Only what the website already shows.
 * Cached at the edge for an hour.
 */

import { NextResponse } from 'next/server';
import { getSitePieces } from '@/lib/website/site-pieces';
import { catalogFeedCsv } from '@/lib/website/catalog-feed';
import { STORE_CONFIG } from '@/lib/store-config';

/** "TAHERI" → "Taheri"; a name already in mixed case stays. */
const brandName = (n: string) => (n === n.toUpperCase() ? n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : n);

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const { pieces } = await getSitePieces();
    return new NextResponse(catalogFeedCsv(pieces, brandName(STORE_CONFIG.name || 'Taheri')), {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'public, max-age=600, s-maxage=3600, stale-if-error=86400' },
    });
  } catch (e) {
    console.error('[catalog-feed]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'The feed is unavailable just now.' }, { status: 503 });
  }
}
