/**
 * GET /api/website/shopify-analytics/live — the best right-now picture of the Shopify store: sessions by the minute (the
 * hour where the minute grain isn't accepted), today's sessions by place, and orders and checkouts of the last 30 minutes.
 * Shopify has no Live View API. Sections are `{ data }`, `{ missingScope }` (read_reports / read_orders) or `{ error }`.
 * Owners only. Cached 60 seconds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { buildLive, cached } from '@/lib/website/shopify-analytics';
import { shopifyGate } from '../gate';

export const dynamic = 'force-dynamic';
const TTL_MS = 60_000;

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') return NextResponse.json({ error: 'Owners only' }, { status: 403 });
  const gate = await shopifyGate();
  if (!gate) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    return NextResponse.json(await cached('live', TTL_MS, () => buildLive(gate.gql)), { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 200) : 'Shopify did not answer' }, { status: 502 });
  }
}
