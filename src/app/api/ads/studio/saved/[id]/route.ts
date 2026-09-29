/**
 * GET ?key=image|photo|doc → one of a saved ad's files: the finished picture, the photo it was drawn on
 * (JPEG), or its layout document (JSON), for "Open in the maker" and downloads.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { getSaved, readFile, SAVED_KEYS, type SavedKey } from '@/lib/ads/studio/saved';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const key = (req.nextUrl.searchParams.get('key') || 'image') as SavedKey;
  if (!/^[\w-]{1,40}$/.test(id) || !SAVED_KEYS.includes(key)) return NextResponse.json({ error: 'Which file?' }, { status: 400 });
  try {
    const item = await getSaved(id);
    if (!item) return NextResponse.json({ error: 'That saved ad is gone.' }, { status: 404 });
    const data = await readFile(item, key);
    if (!data) return NextResponse.json({ error: 'This saved ad has no such file.' }, { status: 404 });
    return new NextResponse(new Uint8Array(data), { headers: { 'content-type': key === 'doc' ? 'application/json' : 'image/jpeg', 'cache-control': 'private, max-age=300' } });
  } catch (e) {
    return studioFail(e, 'saved file');
  }
}
