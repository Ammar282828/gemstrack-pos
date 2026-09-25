/**
 * GET ?range=last_7d → the Overview: the ad account's state, the range's totals
 * against the same length of time before it, day by day, the ads that spent
 * most, who saw them (age and gender, placement, region) and anything Meta has
 * stopped or flagged.
 *
 * Kept for 90 seconds per range (Meta rations calls per ad account, and a
 * development-tier app gets few); `fresh=1` asks again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { accountSummary, requireAccount } from '@/lib/ads/settings';
import { breakdowns, daily, previousPeriod, problemAds, topAds, totals } from '@/lib/ads/insights';
import { isRange, type RangeKey } from '@/lib/ads/shape';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const cache = new Map<string, { at: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  const r: RangeKey = isRange(q.get('range')) ? (q.get('range') as RangeKey) : 'last_7d';
  try {
    const { act } = await requireAccount();
    const key = `${act}|${r}`;
    const hit = cache.get(key);
    if (hit && q.get('fresh') !== '1' && Date.now() - hit.at < 90_000) return NextResponse.json(hit.body, { headers: noStore });

    const [account, now, days, top, split, problems] = await Promise.all([
      accountSummary(act),
      totals(act, r),
      daily(act, r).catch(() => []),
      topAds(act, r),
      breakdowns(act, r),
      problemAds(act),
    ]);
    const prevRange = r !== 'maximum' && now.since && now.until ? previousPeriod(now.since, now.until) : null;
    const before = prevRange ? await totals(act, prevRange).catch(() => null) : null;

    const body = {
      range: r,
      account,
      since: now.since,
      until: now.until,
      totals: now.metrics,
      previous: before ? { since: prevRange!.since, until: prevRange!.until, metrics: before.metrics } : null,
      daily: days,
      topAds: top,
      breakdowns: split,
      problems,
      at: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'overview');
  }
}
