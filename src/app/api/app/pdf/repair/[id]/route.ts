/**
 * GET → the repair receipt's PDF, the one Print receipt saves (lib/repair-pdf.ts), drawn on the server
 * for the iPhone app to show and share natively. Named as the browser names it: "Repair-<id>.pdf".
 *
 * Owners and staff (lib/app-pdf.ts), as the Repairs page prints for both.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfResponse, pdfViewer, repairPdf } from '@/lib/app-pdf';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  try {
    const pdf = await repairPdf(id, who.role);
    if (!pdf) return NextResponse.json({ error: `No repair ${id}. It may have been deleted.` }, { status: 404 });
    return pdfResponse(pdf);
  } catch (e) {
    console.error('[/api/app/pdf/repair]', id, e);
    return NextResponse.json({ error: 'The repair receipt could not be drawn.' }, { status: 500 });
  }
}
