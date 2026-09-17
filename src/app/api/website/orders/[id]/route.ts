/**
 * The shop's side of a website order. Owners and staff, signed in.
 *
 *   POST { action: 'transfer_received' }
 *   POST { action: 'ship', cn?: string }     — Leopards API, or a CN typed in
 *   POST { action: 'delivered' }
 *   GET                                       — live Leopards tracking
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { FulfilmentError, markDelivered, markTransferReceived, refreshTracking, shipOrder } from '@/lib/website/fulfilment';

export const dynamic = 'force-dynamic';

// This route does NOT follow NEXT_PUBLIC_OPEN_ACCESS the way the vision routes
// do. Those spend AI credits when open; this one marks an order paid and
// shipped. Under open access, anyone reaching it could make an unpaid order
// look paid and the shop would ship. So a verified owner or staff token is
// always required — which means, while the POS runs without sign-in, these
// actions are unavailable from the UI. That is the correct consequence.
//
// The one exception is for running a checkout test on a development machine:
// a server-only variable (no NEXT_PUBLIC_ prefix, so it never ships to a
// browser) that is additionally refused in production, so it cannot be
// switched on anywhere this route is reachable from the internet.
const DEV_BYPASS = process.env.WEBSITE_ACTIONS_DEV_BYPASS === '1' && process.env.NODE_ENV !== 'production';

async function gate(req: NextRequest): Promise<string | NextResponse> {
  if (DEV_BYPASS) return 'dev-bypass';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

function fail(e: unknown) {
  if (e instanceof FulfilmentError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error('[website order action]', e);
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; cn?: string };
  try {
    switch (body.action) {
      case 'transfer_received': return NextResponse.json(await markTransferReceived(id, who));
      case 'ship':              return NextResponse.json(await shipOrder(id, who, body.cn));
      case 'delivered':         return NextResponse.json(await markDelivered(id));
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  try { return NextResponse.json(await refreshTracking(id)); } catch (e) { return fail(e); }
}
