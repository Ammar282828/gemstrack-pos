/**
 * GET → the pieces on this house's website (src/lib/website/site-pieces.ts) and
 * when each last went to the community, for Posts → From the website.
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate } from '@/lib/social/gate';
import { STORE_SITE_POSTS } from '@/lib/store-config';
import { getSitePieces, lastPosted } from '@/lib/website/site-pieces';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await postGate(req, STORE_SITE_POSTS);
  if (who instanceof NextResponse) return who;
  try {
    const [{ site, pieces }, posted] = await Promise.all([getSitePieces(), lastPosted().catch(() => ({}))]);
    return NextResponse.json({ site, pieces, posted }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: `Could not read the website’s pieces: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }
}
