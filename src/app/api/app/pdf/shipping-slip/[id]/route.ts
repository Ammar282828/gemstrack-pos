/**
 * GET ?kind=order|invoice (default order) → the TCS shipping slip of the booking made from the ERP (lib/shipping-slip-pdf.ts: a 4 × 6
 * label with the consignment number as a barcode), drawn on the server for the apps to share and print natively. "TCS-<cn>.pdf".
 *
 * Owners and staff (lib/app-pdf.ts), as the booking is (ops-courier.ts). 404 when there is no booking to print: none made from the
 * ERP, or cancelled.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfResponse, pdfViewer, shippingSlipPdf } from '@/lib/app-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const kind = req.nextUrl.searchParams.get('kind') === 'invoice' ? 'invoice' : 'order';
  try {
    const pdf = await shippingSlipPdf(kind, id);
    if (!pdf) return NextResponse.json({ error: `No TCS booking to print on ${kind} ${id}. It may be cancelled.` }, { status: 404 });
    return pdfResponse(pdf);
  } catch (e) {
    console.error('[/api/app/pdf/shipping-slip]', id, e);
    return NextResponse.json({ error: 'The slip could not be drawn.' }, { status: 500 });
  }
}
