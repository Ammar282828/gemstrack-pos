/**
 * GET → online orders: the ones waiting to be confirmed first, then the last fortnight's. Owners and staff.
 * GET ?count=1 → { waiting, pausedForRates, ratesUpdatedAt }: the sidebar's count, and whether the
 *   site's selling waits on today's rate (the dashboard says so).
 */

import { NextRequest, NextResponse } from 'next/server';
import { countWaiting, listOnlineOrders, sellingPausedForRates } from '@/lib/website/online';
import { staffFail, staffGate } from '@/lib/website/staff-gate';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await staffGate(req);
  if (who instanceof NextResponse) return who;
  try {
    if (req.nextUrl.searchParams.get('count') === '1') {
      const [waiting, rates] = await Promise.all([countWaiting(), sellingPausedForRates().catch(() => ({ paused: false, ratesUpdatedAt: null }))]);
      return NextResponse.json({ waiting, pausedForRates: rates.paused, ratesUpdatedAt: rates.ratesUpdatedAt });
    }
    return NextResponse.json({ orders: await listOnlineOrders() });
  } catch (e) { return staffFail(e, 'online orders'); }
}
