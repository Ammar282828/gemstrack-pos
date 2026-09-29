/**
 * GET — today's gold rates per gram from the ERP's settings (the ones the website quotes at), for
 * the Ad studio's rate board. Nothing is guessed: a karat the shop hasn't set is left out.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { loadRates } from '@/lib/website/config';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const r = await loadRates();
    return NextResponse.json({ k24: r.goldRatePerGram24k, k22: r.goldRatePerGram22k, k21: r.goldRatePerGram21k, k18: r.goldRatePerGram18k, silver: r.silverRatePerGram }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'rates');
  }
}
