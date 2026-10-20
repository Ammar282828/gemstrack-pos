/**
 * GET ?id=site:<piece>|drive:<file>&size= → the photograph as a JPEG (or, with &alpha=1, an upload's transparent PNG) from this server.
 *
 * Drive keeps the shoots private, and a canvas can only export a picture that came from
 * its own origin, so the studio's grid, the model and the maker all take photos from
 * here. Only an asset in the studio's library is served: a piece the website lists, or a
 * file in a folder shared with the ERP.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { assetImage } from '@/lib/ads/studio/assets';
import { dailyCap, dailyCapForRequest, AI_PER_DAY, WHATSAPP_PER_DAY, INSTAGRAM_PER_DAY } from '@/lib/daily-cap';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const capped = await dailyCap('ai', who, req, AI_PER_DAY);
  if (capped) return capped;
  const q = req.nextUrl.searchParams;
  const id = q.get('id') || '';
  const size = Math.min(3000, Math.max(160, Number(q.get('size')) || 1080));
  try {
    // ?alpha=1 (the designer's canvas): an upload kept with transparency comes as its PNG; anything else, and every other caller, gets a JPEG.
    const img = await assetImage(id, size, { keepAlpha: q.get('alpha') === '1' });
    return new NextResponse(new Uint8Array(img.data), {
      headers: { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=3600' },
    });
  } catch (e) {
    const status = (e as { status?: number }).status ?? 502;
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not load the photograph.' }, { status });
  }
}
