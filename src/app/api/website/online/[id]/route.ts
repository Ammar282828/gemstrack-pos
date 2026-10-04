/**
 * The shop's decision on an online order (lib/website/online.ts). Owners and staff, signed in.
 *
 *   POST { action: 'confirm' }                  → { orderId, notified }  the ORD- order, the bank details sent
 *   POST { action: 'decline', reason: string }  → { notified }           the customer told why
 */

import { NextRequest, NextResponse } from 'next/server';
import { confirmOnlineOrder, declineOnlineOrder } from '@/lib/website/online';
import { staffFail, staffGate } from '@/lib/website/staff-gate';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await staffGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; reason?: string };
  try {
    switch (body.action) {
      case 'confirm': return NextResponse.json(await confirmOnlineOrder(id, who));
      case 'decline': return NextResponse.json(await declineOnlineOrder(id, who, String(body.reason || '')));
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) { return staffFail(e, 'online order'); }
}
