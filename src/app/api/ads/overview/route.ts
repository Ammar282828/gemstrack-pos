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
import { breakdowns, daily, previousPeriod, problemAds, topAds, totals, tree } from '@/lib/ads/insights';
import { attentionItems, pacing } from '@/lib/ads/attention';
import { currencyOffset, isRange, type RangeKey } from '@/lib/ads/shape';

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

    const account = await accountSummary(act);
    const [now, days, top, split, problems, campaigns, thisMonth, lastMonth] = await Promise.all([
      totals(act, r),
      daily(act, r).catch(() => []),
      topAds(act, r),
      breakdowns(act, r),
      problemAds(act),
      tree(act, r, { offset: currencyOffset(account.currency) }).catch(() => []),
      totals(act, 'this_month').catch(() => null),
      totals(act, 'last_month').catch(() => null),
    ]);
    const prevRange = r !== 'maximum' && now.since && now.until ? previousPeriod(now.since, now.until) : null;
    const before = prevRange ? await totals(act, prevRange).catch(() => null) : null;
    const rangeDays = now.since && now.until ? Math.max(1, Math.round((Date.parse(now.until) - Date.parse(now.since)) / 86_400_000) + 1) : 7;
    // Today in the ad account's own time zone, for "day 27 of 30".
    const tz = account.timezone || 'Asia/Karachi';
    const today = new Date(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2') + 'T12:00:00');

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
      attention: attentionItems({ account, campaigns, days: rangeDays }),
      month: pacing(thisMonth?.metrics.spend ?? 0, lastMonth?.metrics.spend ?? 0, today),
      at: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), body });
    return NextResponse.json(body, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'overview');
  }
}
