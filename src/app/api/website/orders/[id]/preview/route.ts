/**
 * What Transfer received or Let it lapse will send and book on a confirmed online order, before it is
 * done (lib/website/online-preview.ts): the iPhone app's confirmation shows the WhatsApp word for word
 * and the money it books. Reads only. Owners and staff, signed in.
 *
 *   GET ?action=transfer_received  → MovePreview, with the booking (the advance, the delivery as extra revenue)
 *   GET ?action=lapse              → MovePreview
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { FulfilmentError } from '@/lib/website/fulfilment';
import { lapsePreview, transferPreview, type OrderForPreview } from '@/lib/website/online-preview';
import { staffFail, staffGate } from '@/lib/website/staff-gate';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await staffGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  try {
    const snap = await adminDb.collection('orders').doc(id).get();
    if (!snap.exists) throw new FulfilmentError('Order not found', 404);
    const o = { id: snap.id, ...(snap.data() as Omit<OrderForPreview, 'id'>) };
    switch (req.nextUrl.searchParams.get('action')) {
      case 'transfer_received': return NextResponse.json(transferPreview(o));
      case 'lapse': return NextResponse.json(lapsePreview(o));
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) { return staffFail(e, 'website order preview'); }
}
