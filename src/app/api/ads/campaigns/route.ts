/**
 * GET ?range=last_7d[&archived=1] → every campaign, its ad sets and their ads,
 * each with its status, budget, schedule, Meta's warnings and the range's
 * numbers — the Campaigns tab.
 * &format=csv → the same as Campaigns' "Download (CSV)" (export.ts), for the iPhone's share sheet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { accountSummary, requireAccount } from '@/lib/ads/settings';
import { campaignTotals, previousPeriod, totals, tree } from '@/lib/ads/insights';
import { currencyOffset, isRange, type Metrics, type RangeKey } from '@/lib/ads/shape';
import { campaignsCsv } from '@/lib/ads/export';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  const r: RangeKey = isRange(q.get('range')) ? (q.get('range') as RangeKey) : 'last_7d';
  try {
    const { act } = await requireAccount();
    const csv = q.get('format') === 'csv';
    // All at once: the tree waits only for the currency, the period before only for the range's dates.
    const accountP = accountSummary(act);
    const [account, campaigns, before] = await Promise.all([
      accountP,
      accountP.then(a => tree(act, r, { archived: q.get('archived') === '1', offset: currencyOffset(a.currency) })),
      // Against the same length of time before — "▲ 18%" on each campaign row.
      csv || r === 'maximum' ? new Map<string, Metrics>() : totals(act, r)
        .then(span => { const prev = span.since && span.until ? previousPeriod(span.since, span.until) : null; return prev ? campaignTotals(act, prev) : new Map<string, Metrics>(); })
        .catch(() => new Map<string, Metrics>()),
    ]);
    if (csv) {
      return new NextResponse(campaignsCsv(campaigns), {
        headers: { ...noStore, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ads-${r}-${new Date().toISOString().slice(0, 10)}.csv"` },
      });
    }
    for (const c of campaigns) { const b = before.get(c.id); if (b) c.previous = b; }
    return NextResponse.json({ range: r, account, campaigns }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'campaigns');
  }
}
