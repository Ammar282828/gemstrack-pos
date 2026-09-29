/**
 * The website pixel (pixel.ts).
 *
 * GET                               the ad account's pixels, the chosen one, and whether it fires
 * POST { action: 'create', name }   a new pixel in the ad account, chosen
 * POST { action: 'choose', id }     use this one (null to stop)
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { createPixel, listPixels, pixelState } from '@/lib/ads/pixel';
import { saveAdsSettings } from '@/lib/ads/settings';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  try {
    const [pixels, state] = await Promise.all([listPixels(), pixelState()]);
    return NextResponse.json({ pixels, state }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'pixel');
  }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  try {
    const b = (await req.json().catch(() => ({}))) as { action?: string; name?: string; id?: string | null };
    if (b.action === 'create') {
      const id = await createPixel((b.name || '').trim() || 'Website');
      await saveAdsSettings({ pixelId: id });
    } else if (b.action === 'choose') {
      if (b.id !== null && !(typeof b.id === 'string' && /^\d{5,25}$/.test(b.id))) return NextResponse.json({ error: 'That is not a pixel id.' }, { status: 400 });
      await saveAdsSettings({ pixelId: b.id });
    } else return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    return NextResponse.json({ state: await pixelState() }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'pixel');
  }
}
