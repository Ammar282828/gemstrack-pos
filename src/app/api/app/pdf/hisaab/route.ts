/**
 * GET → the Hisaab page's Summary PDF (lib/hisaab-pdf.ts), drawn on the server for the iPhone app:
 * everyone with something outstanding, by name; `?q=` keeps only names holding it, as the page's
 * search does. Named as the browser names it: "Hisaab-Summary-<day>.pdf". Owners only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfResponse } from '@/lib/app-pdf';
import { hisaabSummaryPdf, pdfOwner } from '@/lib/app-pdf-owner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const who = await pdfOwner(req, 'The hisaab');
  if (who instanceof NextResponse) return who;
  try {
    return pdfResponse(await hisaabSummaryPdf(req.nextUrl.searchParams.get('q') ?? ''));
  } catch (e) {
    console.error('[/api/app/pdf/hisaab]', e);
    return NextResponse.json({ error: 'The hisaab summary could not be drawn.' }, { status: 500 });
  }
}
