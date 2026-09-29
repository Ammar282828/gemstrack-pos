/**
 * The Guide's live parts.
 *
 * GET    the calendar (today, the sacred dates in the next four months, the quiet days of
 *        the next two weeks) and the last reading of the account's own winners
 * POST   read the winners again (research.ts: the last six months of ads, cheapest results
 *        against dearest, pictures and words to the model)
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { adDayStatus, hijriLabel, karachiDay, quietDaysBetween, upcomingObservances } from '@/lib/ads/studio/calendar';
import { analyseWinners, loadWinners } from '@/lib/ads/studio/research';
import { studioAiGate, studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
export const maxDuration = 240;

function calendar() {
  const now = new Date();
  const today = adDayStatus(now);
  const in14 = karachiDay(new Date(now.getTime() + 13 * 86_400_000));
  return {
    today: { date: today.date, level: today.level, hijri: hijriLabel(today.hijri), name: today.observance?.name ?? '', rule: today.observance?.rule ?? '' },
    upcoming: upcomingObservances(now, 270).slice(0, 5).map(u => ({ date: u.date, hijri: hijriLabel(u.hijri), id: u.observance.id, name: u.observance.name, rule: u.observance.rule, before: u.observance.before, to: u.observance.to - u.observance.from + 1 })),
    next14: quietDaysBetween(today.date, in14).map(d => ({ date: d.date, level: d.level, hijri: hijriLabel(d.hijri), name: d.observance?.name ?? '' })),
  };
}

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    return NextResponse.json({ calendar: calendar(), winners: await loadWinners() }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'guide');
  }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const blocked = await studioAiGate(req);
  if (blocked) return blocked;
  try {
    return NextResponse.json({ winners: await analyseWinners() }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'guide/winners');
  }
}
