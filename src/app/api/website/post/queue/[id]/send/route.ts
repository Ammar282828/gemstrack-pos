/**
 * POST → send a queued piece now (the page's "Send now" and "Send all now",
 * one piece per call). Only what hasn't gone is sent, so pressing it again
 * after a failure never posts a group twice. A piece an AI queued goes only
 * once approved on its own (PATCH { action: 'approve' }): Send now is not an
 * approval, so a tray's Send all can never send one.
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate, mediaOrigin } from '@/lib/social/gate';
import { awaitingApproval, claimItem, getItem, sendItem, toView } from '@/lib/social/queue';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return NextResponse.json({ error: 'No such piece.' }, { status: 404 });
  const item = await claimItem(id, new Date(), true);
  if (!item) {
    const now = await getItem(id);
    if (!now) return NextResponse.json({ error: 'That piece is no longer in the queue.' }, { status: 404 });
    const error = now.status === 'sent' ? 'That piece has already gone out.'
      : awaitingApproval(now) ? `${now.proposedBy} made this piece: approve it first (its own Approve, in Posts).`
      : 'That piece is being sent right now.';
    return NextResponse.json({ error, item: toView(now), ...(awaitingApproval(now) ? { needsApproval: true } : {}) }, { status: 409 });
  }
  const after = await sendItem(item, { by: who, origin: mediaOrigin(req) });
  return NextResponse.json({ ok: after.status === 'sent', item: toView(after) });
}
