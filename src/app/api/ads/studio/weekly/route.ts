/**
 * This week's board (weekly.ts): GET where it stands; POST { action: 'start' } makes one now (even
 * if this week has one) and designs what it can in about a minute and a half; POST { action:
 * 'continue' } designs the next pieces. The queue tick does the same on Mondays from 9:00.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { loadWeekly, runWeeklySlice, startWeekly } from '@/lib/ads/studio/weekly';
import { studioAiGate, studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try { return NextResponse.json({ weekly: await loadWeekly() }, { headers: noStore }); } catch (e) { return studioFail(e, 'weekly'); }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const blocked = await studioAiGate(req);
  if (blocked) return blocked;
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action === 'start') await startWeekly(new Date(), true);
    const weekly = await runWeeklySlice(150_000);
    return NextResponse.json({ weekly }, { headers: noStore });
  } catch (e) { return studioFail(e, 'weekly'); }
}
