/**
 * GET /api/app/tracking?order=<id> | ?invoice=<id> [&fresh=1] → { tracking: Tracking | null }
 *
 * Where the order's parcel is (lib/tracking-server.ts): TCS's own scans when the account works, else Shopify's fulfilment
 * events, else what the order recorded. Owners and staff (the counter answers "where is my parcel"). Kept 10 minutes;
 * fresh=1 asks again.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { pdfViewer, isDocId } from '@/lib/app-pdf';
import { askOf, getTracking } from '@/lib/tracking-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  const orderId = q.get('order') || '', invoiceId = q.get('invoice') || '';
  const id = orderId || invoiceId;
  if (!isDocId(id) || (orderId && invoiceId)) return NextResponse.json({ error: 'Which order or invoice?' }, { status: 400 });
  const snap = await adminDb.collection(orderId ? 'orders' : 'invoices').doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const tracking = await getTracking({ ...askOf(snap.data() || {}), fresh: q.get('fresh') === '1' });
    return NextResponse.json({ tracking }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[/api/app/tracking]', e);
    return NextResponse.json({ error: 'Tracking could not be read. Try again.' }, { status: 502 });
  }
}
