/**
 * What confirming or declining an online order will send, before it is done (lib/website/online-preview.ts):
 * the iPhone app's confirmation shows the WhatsApp word for word. Reads only. Owners and staff, signed in.
 *
 *   GET ?action=confirm                → MovePreview, with when the price hold would end
 *   GET ?action=decline&reason=<text>  → MovePreview
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { bankDetails } from '@/lib/website/config';
import { FulfilmentError } from '@/lib/website/fulfilment';
import { holdHours, ONLINE_ORDERS } from '@/lib/website/online';
import { confirmPreview, declinePreview, websiteOrigin } from '@/lib/website/online-preview';
import { staffFail, staffGate } from '@/lib/website/staff-gate';
import type { OnlineOrder } from '@/lib/website/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await staffGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const q = req.nextUrl.searchParams;
  try {
    const snap = await adminDb.collection(ONLINE_ORDERS).doc(id).get();
    if (!snap.exists) throw new FulfilmentError('Online order not found', 404);
    const o = { id: snap.id, ...(snap.data() as Omit<OnlineOrder, 'id'>) };
    switch (q.get('action')) {
      case 'confirm': return NextResponse.json(confirmPreview(o, { bank: bankDetails(), origin: websiteOrigin(), holdHours: holdHours() }));
      case 'decline': return NextResponse.json(declinePreview(o, q.get('reason'), { origin: websiteOrigin() }));
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) { return staffFail(e, 'online order preview'); }
}
