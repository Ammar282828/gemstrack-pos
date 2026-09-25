/**
 * GET ?range=last_7d[&archived=1] → every campaign, its ad sets and their ads,
 * each with its status, budget, schedule, Meta's warnings and the range's
 * numbers — the Campaigns tab.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { accountSummary, requireAccount } from '@/lib/ads/settings';
import { tree } from '@/lib/ads/insights';
import { currencyOffset, isRange, type RangeKey } from '@/lib/ads/shape';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  const r: RangeKey = isRange(q.get('range')) ? (q.get('range') as RangeKey) : 'last_7d';
  try {
    const { act } = await requireAccount();
    const account = await accountSummary(act);
    const campaigns = await tree(act, r, { archived: q.get('archived') === '1', offset: currencyOffset(account.currency) });
    return NextResponse.json({ range: r, account, campaigns }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'campaigns');
  }
}
