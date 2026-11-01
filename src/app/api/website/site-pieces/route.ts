/**
 * GET → the pieces on this house's website (src/lib/website/site-pieces.ts) and
 * when each last went to the community, for the Posts hub.
 *
 * `?lean=1` leaves off what only the editor reads (`own`, `words`, an empty `change`): about
 * a third of the answer, 1.3 MB for House of Mina's 675 pieces (2026-10-26). The apps and the
 * pickers ask for it; Website → Edit a piece reads /api/website/edits.
 * The body is gzipped when the caller accepts it (lib/http/gzip-json.ts): App Hosting sent this route
 * uncompressed (the log's response size equalled the JSON's), which a phone on mobile data felt.
 */

import { NextRequest, NextResponse } from 'next/server';
import { gzipJson } from '@/lib/http/gzip-json';
import { postGate } from '@/lib/social/gate';
import { STORE_SITE_POSTS } from '@/lib/store-config';
import { getSitePieces, lastPosted, leanPiece } from '@/lib/website/site-pieces';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await postGate(req, STORE_SITE_POSTS);
  if (who instanceof NextResponse) return who;
  try {
    const [{ site, pieces }, posted] = await Promise.all([getSitePieces(), lastPosted().catch(() => ({}))]);
    const lean = req.nextUrl.searchParams.get('lean') === '1';
    return gzipJson(req, { site, pieces: lean ? pieces.map(leanPiece) : pieces, posted }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: `Could not read the website’s pieces: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
