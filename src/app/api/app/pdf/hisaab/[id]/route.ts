/**
 * GET → one person's Ledger Statement (lib/hisaab-pdf.ts), as the ledger page's Print saves it,
 * drawn on the server for the iPhone app. `?type=customer|karigar` says which book the person is in,
 * as the page's address does; without it their rows decide. Owners only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfResponse } from '@/lib/app-pdf';
import { hisaabLedgerPdf, pdfOwner } from '@/lib/app-pdf-owner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await pdfOwner(req, 'The hisaab');
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const t = req.nextUrl.searchParams.get('type');
  const type = t === 'customer' || t === 'karigar' ? t : null;
  try {
    const pdf = await hisaabLedgerPdf(id, type);
    if (!pdf) return NextResponse.json({ error: `No hisaab for ${id}. It may have been deleted.` }, { status: 404 });
    return pdfResponse(pdf);
  } catch (e) {
    console.error('[/api/app/pdf/hisaab/[id]]', id, e);
    return NextResponse.json({ error: 'The ledger could not be drawn.' }, { status: 500 });
  }
}
