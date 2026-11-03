/**
 * GET /api/website/shopify-analytics?range=today|7d|30d|90d|month[&compare=1]
 * — House of Mina's Shopify store over a period (and the one before): sales, traffic, series, funnel, products, channels,
 * discounts, customers, sources, places, devices, landing pages, searches (lib/website/shopify-analytics.ts).
 * Each section is `{ data }`, `{ missingScope: "read_reports" }` or `{ error }`. Owners only. Cached 10 minutes.
 * 404 where the house has no Shopify analytics (NEXT_PUBLIC_STORE_SHOPIFY_ANALYTICS, SHOPIFY_STORE_DOMAIN).
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { karachiDay } from '@/lib/website/piece-interest';
import { buildReport, cached, parseRange } from '@/lib/website/shopify-analytics';
import { shopifyGate } from './gate';

export const dynamic = 'force-dynamic';
const TTL_MS = 10 * 60_000;

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') return NextResponse.json({ error: 'Owners only' }, { status: 403 });
  const gate = await shopifyGate();
  if (!gate) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const q = req.nextUrl.searchParams;
  const range = parseRange(q.get('range'));
  const compare = q.get('compare') === '1';
  const today = karachiDay();
  try {
    const body = await cached(`report:${range}:${compare}:${today}`, TTL_MS, () => buildReport(gate.gql, { range, compare, today }));
    return NextResponse.json(body, { headers: { 'Cache-Control': 'private, max-age=600' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : 'Shopify did not answer' }, { status: 502 });
  }
}
