/**
 * POST /api/public/order/:id/slip  { t, file: dataURL, reference?, amount?, fromBank? }
 *   → the customer's transfer slip, to the shop (lib/website/slips.ts). Then the order's view.
 *
 * JSON, not multipart: one shape for the site to send and for CORS to allow. The site shrinks a
 * photo to a JPEG first, so a slip is a few hundred kilobytes.
 */

import { NextRequest } from 'next/server';
import { json, preflight } from '@/lib/website/cors';
import { rateLimit, callerKey } from '@/lib/website/ratelimit';
import { publicOrderView } from '@/lib/website/checkout';
import { FulfilmentError } from '@/lib/website/fulfilment';
import { isOnlineId, publicOnlineView } from '@/lib/website/online';
import { recordSlip } from '@/lib/website/slips';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) { return preflight(req); }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limit = await rateLimit('slip', callerKey(req.headers), 12, 3600);
  if (!limit.ok) return json(req, { error: 'Too many uploads from this connection. Send the slip on WhatsApp instead.' }, { status: 429 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { t?: string; file?: string; reference?: string; amount?: number; fromBank?: string } | null;
  if (!body?.t || !body.file) return json(req, { error: 'Choose the slip first.' }, { status: 400 });
  try {
    const r = await recordSlip(id, body.t, { file: body.file, reference: body.reference, amount: body.amount, fromBank: body.fromBank });
    const view = isOnlineId(id) ? await publicOnlineView(id, body.t) : await publicOrderView(id, body.t);
    return json(req, { ok: true, slip: { at: r.slip.at }, order: view });
  } catch (e) {
    if (e instanceof FulfilmentError) return json(req, { error: e.message }, { status: e.status });
    console.error('[website slip]', e);
    return json(req, { error: 'The slip did not send. Please try again, or send it on WhatsApp.' }, { status: 500 });
  }
}
