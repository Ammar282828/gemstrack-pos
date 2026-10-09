/**
 * GET → the invoice's PDF, the one Print saves (lib/invoice-pdf.ts), drawn on the server for the iPhone
 * app to show and share natively. `?perPiece=1`: one invoice per piece, each on its own page.
 *
 * Owners and staff (lib/app-pdf.ts); staff's is drawn from the copy their browser holds, so it prints
 * what theirs prints. Named as the browser names it: Taheri "Invoice - <customer>.pdf", never the
 * number; House of Mina "Invoice-<number>.pdf".
 */

import { NextRequest, NextResponse } from 'next/server';
import { invoicePdf, pdfResponse, pdfViewer } from '@/lib/app-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const perPiece = req.nextUrl.searchParams.get('perPiece') === '1';
  try {
    const pdf = await invoicePdf(id, who.role, { perPiece });
    if (!pdf) return NextResponse.json({ error: `No invoice ${id}. It may have been refunded in full, which removes it.` }, { status: 404 });
    return pdfResponse(pdf);
  } catch (e) {
    console.error('[/api/app/pdf/invoice]', id, e);
    return NextResponse.json({ error: 'The invoice PDF could not be drawn.' }, { status: 500 });
  }
}
