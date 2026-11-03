/**
 * GET /api/app/describe?category=<itemCategory> → { history: [{ text, count, lastAt, category }], combos: string[] }
 *
 * Owners and staff. The words pieces have been described with on orders and invoices (every category, the asked
 * one's first; clients filter), and the owner's saved stone combinations (`setStoneCombos`). Cached five minutes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfViewer } from '@/lib/app-pdf';
import { resolveCategoryId } from '@/lib/website/catalogue-category';
import { describeHistory, readStoneCombos } from '@/lib/describe-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  try {
    const raw = (req.nextUrl.searchParams.get('category') || '').slice(0, 80);
    const category = resolveCategoryId(raw) ?? raw;
    const [history, combos] = await Promise.all([describeHistory(category), readStoneCombos()]);
    return NextResponse.json({ history, combos }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[describe]', e);
    return NextResponse.json({ error: 'Could not read the descriptions.' }, { status: 500 });
  }
}
