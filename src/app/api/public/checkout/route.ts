/**
 * POST /api/public/checkout  → places a website order.
 *
 * The body carries who is buying, where it goes, and which pieces. It does not
 * carry prices: the POS re-quotes every piece at this moment and the customer
 * pays what that says. If the quote moved since they filled their bag, the
 * reply says so and nothing is placed — the site shows the new total and asks
 * again.
 */

import { NextRequest } from 'next/server';
import { json, preflight } from '@/lib/website/cors';
import { rateLimit, callerKey } from '@/lib/website/ratelimit';
import { placeWebsiteOrder, CheckoutRejected } from '@/lib/website/checkout';
import { identityFromRequest } from '@/lib/website/customers';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) { return preflight(req); }

export async function POST(req: NextRequest) {
  const caller = callerKey(req.headers);
  const limit = await rateLimit('checkout', caller, 6, 3600);
  if (!limit.ok) return json(req, { error: 'Too many orders from this connection. Please try again later or message us on WhatsApp.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } });

  const body = await req.json().catch(() => null);
  try {
    // Optional: a signed-in customer's token ties the order to their account.
    const who = await identityFromRequest(req);
    const placed = await placeWebsiteOrder(body, { caller, origin: req.headers.get('origin') || '', customerUid: who?.uid });
    return json(req, placed, { status: 201 });
  } catch (e) {
    if (e instanceof CheckoutRejected) return json(req, { error: e.message, code: e.code, detail: e.detail }, { status: e.status });
    console.error('[website checkout]', e);
    return json(req, { error: 'We could not place the order just now. Please try again, or message us on WhatsApp.' }, { status: 500 });
  }
}
