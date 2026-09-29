/**
 * POST — a creative made in the studio has gone into the ad account's library (through
 * /api/ads/images): remember which photographs it used, so the picks hold them back.
 * GET — the latest thirty, for the studio's "made here" row.
 *
 * Body: { assets: string[], hash, url?, format, name? }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { adminDb } from '@/lib/firebase-admin';
import { CREATIVES, recordCreative } from '@/lib/ads/studio/assets';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const b = (await req.json().catch(() => ({}))) as { assets?: unknown; hash?: unknown; url?: unknown; format?: unknown; name?: unknown };
    const assets = (Array.isArray(b.assets) ? b.assets : []).filter((x): x is string => typeof x === 'string' && /^(site|drive):/.test(x)).slice(0, 10);
    if (typeof b.hash !== 'string' || !b.hash) return NextResponse.json({ error: 'No image reference.' }, { status: 400 });
    await recordCreative({
      assets, hash: b.hash, url: typeof b.url === 'string' ? b.url : null,
      format: typeof b.format === 'string' ? b.format.slice(0, 20) : 'square', name: typeof b.name === 'string' ? b.name.slice(0, 120) : '', by: who,
    });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'creatives');
  }
}

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const snap = await adminDb.collection(CREATIVES).orderBy('at', 'desc').limit(30).get();
    return NextResponse.json({ creatives: snap.docs.map(d => ({ id: d.id, ...d.data() })) }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'creatives');
  }
}
