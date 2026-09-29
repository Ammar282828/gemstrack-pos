/**
 * GET ?id=site:<piece>|drive:<file>&size= → the photograph as a JPEG from this server.
 *
 * Drive keeps the shoots private, and a canvas can only export a picture that came from
 * its own origin, so the studio's grid, the model and the maker all take photos from
 * here. Only an asset in the studio's library is served: a piece the website lists, or a
 * file in a folder shared with the ERP.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { assetJpeg } from '@/lib/ads/studio/assets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  const id = q.get('id') || '';
  const size = Math.min(3000, Math.max(160, Number(q.get('size')) || 1080));
  try {
    const jpeg = await assetJpeg(id, size);
    return new NextResponse(new Uint8Array(jpeg), {
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load the photograph.' }, { status });
  }
}
