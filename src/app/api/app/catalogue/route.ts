/**
 * GET /api/app/catalogue?category=<itemCategory>&type=<a,b>&stone=<a,b>&q=<text>
 *   → { pieces: [{ id, title, category, image, thumb, type, stones }], facets: { types: [{ id, label, count }], stones: [...] } }
 *
 * Owners and staff. The website's pieces (lib/website/site-pieces.ts), newest first, at most 500, for picking a
 * reference picture: `category` (an ERP item category, lib/categories.ts) keeps only that category's photos (all
 * when empty or unknown); `q` filters by title, collection, words of the key or id. `category` in the answer is the
 * site's own collection.
 *
 * Added 2026-11-03 (additive): each piece carries `type` (ring, bangle, bracelet, earrings, pendant, necklace, set,
 * nosepin, chain, anklet, tikka, coin, button, band, or `other`) and `stones` (diamond, ruby, emerald, sapphire, pearl,
 * zircon, polki, kundan, turquoise, coral, onyx, moissanite, …), derived by lib/website/catalogue-facets.ts.
 * `type` and `stone` are comma lists: a piece must be one of the types and have every stone. `q`: every word must be in
 * the title, collection, key, the site's words, the stones or the type. `facets` count the category asked (all when
 * empty), before type, stone and q narrow it, so the chips stay put while the grid narrows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pdfViewer } from '@/lib/app-pdf';
import { getSitePieces } from '@/lib/website/site-pieces';
import { CATALOGUE_LIMIT, pieceInCategory } from '@/lib/website/catalogue-category';
import { buildFacets, catalogueMatches, idList, matchesFacets, pieceStones, pieceType } from '@/lib/website/catalogue-facets';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await pdfViewer(req);
  if (who instanceof NextResponse) return who;
  const category = req.nextUrl.searchParams.get('category') || '';
  const q = (req.nextUrl.searchParams.get('q') || '').slice(0, 100);
  const types = idList(req.nextUrl.searchParams.get('type'));
  const stones = idList(req.nextUrl.searchParams.get('stone'));
  try {
    const { pieces } = await getSitePieces();
    const inCategory = pieces
      .filter(p => p.image && pieceInCategory(p, category))
      .map(p => ({ p, type: pieceType(p), stones: pieceStones(p) }));
    const out = inCategory
      .filter(x => matchesFacets(x, types, stones) && catalogueMatches({ ...x.p, type: x.type, stones: x.stones }, q))
      .slice(0, CATALOGUE_LIMIT)
      .map(({ p, type, stones: st }) => ({ id: p.id, title: p.words?.name || p.name, category: p.collection, image: p.image, thumb: p.thumb || p.image, type, stones: st }));
    return NextResponse.json({ pieces: out, facets: buildFacets(inCategory) }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (e) {
    console.error('[catalogue]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the catalogue.' }, { status: 502 });
  }
}
