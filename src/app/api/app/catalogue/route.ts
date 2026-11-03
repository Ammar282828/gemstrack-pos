/**
 * GET /api/app/catalogue?category=<itemCategory>&q=<text> → { pieces: [{ id, title, category, image, thumb }] }
 *
 * Owners and staff. The website's pieces (lib/website/site-pieces.ts), newest first, at most 500, for picking a
 * reference picture: `category` (an ERP item category, lib/categories.ts) keeps only that category's photos (all
 * when empty or unknown); `q` filters by title, collection, words of the key or id. `category` in the answer is the
 * site's own collection.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfViewer } from '@/lib/app-pdf';
import { getSitePieces } from '@/lib/website/site-pieces';
import { CATALOGUE_LIMIT, pieceInCategory, pieceMatches } from '@/lib/website/catalogue-category';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const category = req.nextUrl.searchParams.get('category') || '';
  const q = (req.nextUrl.searchParams.get('q') || '').slice(0, 100);
  try {
    const { pieces } = await getSitePieces();
    const out = pieces
      .filter(p => p.image && pieceInCategory(p, category) && pieceMatches(p, q))
      .slice(0, CATALOGUE_LIMIT)
      .map(p => ({ id: p.id, title: p.words?.name || p.name, category: p.collection, image: p.image, thumb: p.thumb || p.image }));
    return NextResponse.json({ pieces: out }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    console.error('[catalogue]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the catalogue.' }, { status: 502 });
  }
}
