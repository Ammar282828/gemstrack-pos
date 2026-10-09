/**
 * GET → the order's workshop slip, the one Print slip saves (lib/order-slip-pdf.ts), drawn on the server
 * for the iPhone app to show, print and share natively. "OrderSlip-<id>.pdf".
 *
 * Owners and staff (lib/app-pdf.ts). Staff's is drawn from the copy their browser holds: the bench
 * notes on each piece, never the owner's internal note (`adminNote`) or the rates.
 */

import { NextRequest, NextResponse } from 'next/server';
import { orderSlipPdf, pdfResponse, pdfViewer } from '@/lib/app-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  try {
    const pdf = await orderSlipPdf(id, who.role);
    if (!pdf) return NextResponse.json({ error: `No order ${id}. It may have been deleted.` }, { status: 404 });
    return pdfResponse(pdf);
  } catch (e) {
    console.error('[/api/app/pdf/order-slip]', id, e);
    return NextResponse.json({ error: 'The slip could not be drawn.' }, { status: 500 });
  }
}
