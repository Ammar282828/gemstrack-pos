/**
 * GET → the pieces on this house's website (src/lib/website/site-pieces.ts) and
 * when each last went to the community, for the Posts hub.
 *
 * `?lean=1` leaves off what only the editor reads (`own`, `words`, an empty `change`): about
 * a third of the answer, 1.3 MB for House of Mina's 675 pieces (2026-10-26). The apps and the
 * pickers ask for it; Website → Edit a piece reads /api/website/edits.
 * The body is gzipped here when the caller accepts it: App Hosting sent this route
 * uncompressed (the log's response size equalled the JSON's), which a phone on mobile data felt.
 */

import { NextRequest, NextResponse } from 'next/server';
import { gzipSync } from 'node:zlib';
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
    const body = JSON.stringify({ site, pieces: lean ? pieces.map(leanPiece) : pieces, posted });
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
    if (/\bgzip\b/i.test(req.headers.get('accept-encoding') ?? '') && body.length > 1024) {
      return new NextResponse(new Uint8Array(gzipSync(body)), { headers: { ...headers, 'Content-Encoding': 'gzip' } });
    }
    return new NextResponse(body, { headers });
  } catch (e) {
    return NextResponse.json({ error: `Could not read the website’s pieces: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
