/**
 * GET /api/public/order/:id?t=<token>  → the customer's view of their order.
 *
 * `id` is the ONL- number the customer was given when they ordered (online.ts); an ORD- number
 * still opens an order placed before confirming existed. The token was minted at checkout and lives
 * only in the link the customer was given. It is a capability, not a login: whoever has the link sees
 * this one order's status, bank details (once confirmed) and tracking — and nothing else in the book.
 */

import { NextRequest } from 'next/server';
import { json, preflight } from '@/lib/website/cors';
import { rateLimit, callerKey } from '@/lib/website/ratelimit';
import { publicOrderView } from '@/lib/website/checkout';
import { isOnlineId, publicOnlineView } from '@/lib/website/online';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) { return preflight(req); }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit('order', callerKey(req.headers), 120, 600);
  if (!limit.ok) return json(req, { error: 'Too many requests' }, { status: 429 });

  const { id } = await params;
  const token = req.nextUrl.searchParams.get('t') || '';
  const view = isOnlineId(id) ? await publicOnlineView(id, token) : await publicOrderView(id, token);
  if (!view) return json(req, { error: 'Order not found' }, { status: 404 });
  // The page polls while it waits for the shop; never a cached answer.
  return json(req, view, { headers: { 'Cache-Control': 'no-store' } });
}
