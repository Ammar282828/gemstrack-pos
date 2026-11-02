/**
 * GET → the customer's copy of an order (lib/order-pdf.ts): its pieces, estimate, advances, balance and
 * ready-by day, never the bench's notes; drawn on the server for the apps to show and share natively, and
 * the file /api/app/whatsapp/send-doc sends. Taheri "Order - <customer>.pdf"; Mina "Order-<number>.pdf".
 * Not the workshop slip (/api/app/pdf/order-slip/[id]), which is the karigar's.
 *
 * Owners and staff (lib/app-pdf.ts); staff's from the copy their browser holds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { orderPdf, pdfResponse, pdfViewer } from '@/lib/app-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  try {
    const pdf = await orderPdf(id, who.role);
    if (!pdf) return NextResponse.json({ error: `No order ${id}. It may have been deleted.` }, { status: 404 });
    return pdfResponse(pdf);
  } catch (e) {
    console.error('[/api/app/pdf/order]', id, e);
    return NextResponse.json({ error: 'The order PDF could not be drawn.' }, { status: 500 });
  }
}
