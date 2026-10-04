/**
 * The shop's side of a confirmed online order. Owners and staff, signed in (staff-gate.ts).
 *
 *   POST { action: 'transfer_received' }
 *   POST { action: 'lapse' }                  — no money by the end of the hold; the bank checked
 *   POST { action: 'ship', cn?: string }     — Leopards API, or a CN typed in
 *   POST { action: 'delivered' }
 *   GET                                       — live Leopards tracking
 */

import { NextRequest, NextResponse } from 'next/server';
import { lapseOrder, markDelivered, markTransferReceived, refreshTracking, shipOrder } from '@/lib/website/fulfilment';
import { staffFail, staffGate } from '@/lib/website/staff-gate';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await staffGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; cn?: string };
  try {
    switch (body.action) {
      case 'transfer_received': return NextResponse.json(await markTransferReceived(id, who));
      case 'lapse':             return NextResponse.json(await lapseOrder(id, who));
      case 'ship':              return NextResponse.json(await shipOrder(id, who, body.cn));
      case 'delivered':         return NextResponse.json(await markDelivered(id));
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) { return staffFail(e, 'website order action'); }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await staffGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  try { return NextResponse.json(await refreshTracking(id)); } catch (e) { return staffFail(e, 'website order tracking'); }
}
