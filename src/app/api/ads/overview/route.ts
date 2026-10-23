/**
 * GET ?range=last_7d → the Overview: the ad account's state, the range's totals
 * against the same length of time before it, day by day, the ads that spent
 * most, who saw them (age and gender, placement, region) and anything Meta has
 * stopped or flagged.
 *
 * Kept for 90 seconds per range (Meta rations calls per ad account, and a
 * development-tier app gets few), then shown at once for up to ten minutes more
 * while it is asked again behind the scenes (swr.ts); `fresh=1` asks now.
 *
 * About 17 Graph calls, all at once: the only waits in a row are the account's
 * currency before the campaign tree and the range's dates before the period
 * before it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { accountSummary, requireAccount } from '@/lib/ads/settings';
import { breakdowns, daily, previousPeriod, problemAds, topAds, totals, tree } from '@/lib/ads/insights';
import { attentionItems, pacing } from '@/lib/ads/attention';
import { currencyOffset, isRange, type RangeKey } from '@/lib/ads/shape';
import { remembered } from '@/lib/ads/swr';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  const r: RangeKey = isRange(q.get('range')) ? (q.get('range') as RangeKey) : 'last_7d';
  try {
    const { act } = await requireAccount();
    const body = await remembered(`overview|${act}|${r}`, () => build(act, r), { ttl: 90_000, stale: 10 * 60_000, fresh: q.get('fresh') === '1' });
    return NextResponse.json(body, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'overview');
  }
}

async function build(act: string, r: RangeKey) {
  // Everything at once; only the tree waits for the currency, and the period before for the range's dates.
  const accountP = accountSummary(act);
  const nowP = totals(act, r);
  const [account, now, before, days, top, split, problems, campaigns, thisMonth, lastMonth] = await Promise.all([
    accountP,
    nowP,
    nowP.then(n => {
      const prev = r !== 'maximum' && n.since && n.until ? previousPeriod(n.since, n.until) : null;
      return prev ? totals(act, prev).then(t => ({ ...prev, metrics: t.metrics })) : null;
    }).catch(() => null),
    daily(act, r).catch(() => []),
    topAds(act, r),
    breakdowns(act, r),
    problemAds(act),
    // Only for "Needs a look": no ad-level numbers or big pictures (the Campaigns tab has those).
    accountP.then(a => tree(act, r, { offset: currencyOffset(a.currency), light: true })).catch(() => []),
    totals(act, 'this_month').catch(() => null),
    totals(act, 'last_month').catch(() => null),
  ]);
  const rangeDays = now.since && now.until ? Math.max(1, Math.round((Date.parse(now.until) - Date.parse(now.since)) / 86_400_000) + 1) : 7;
  // Today in the ad account's own time zone, for "day 27 of 30".
  const tz = account.timezone || 'Asia/Karachi';
  const today = new Date(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2') + 'T12:00:00');

  return {
    range: r,
    account,
    since: now.since,
    until: now.until,
    totals: now.metrics,
    previous: before,
    daily: days,
    topAds: top,
    breakdowns: split,
    problems,
    attention: attentionItems({ account, campaigns, days: rangeDays }),
    month: pacing(thisMonth?.metrics.spend ?? 0, lastMonth?.metrics.spend ?? 0, today),
    at: new Date().toISOString(),
  };
}
