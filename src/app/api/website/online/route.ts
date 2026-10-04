/**
 * GET → online orders: the ones waiting to be confirmed first, then the last fortnight's. Owners and staff.
 * GET ?count=1 → { waiting } only, for the sidebar.
 */

import { NextRequest, NextResponse } from 'next/server';
import { countWaiting, listOnlineOrders } from '@/lib/website/online';
import { staffFail, staffGate } from '@/lib/website/staff-gate';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await staffGate(req);
  if (who instanceof NextResponse) return who;
  try {
    if (req.nextUrl.searchParams.get('count') === '1') return NextResponse.json({ waiting: await countWaiting() });
    return NextResponse.json({ orders: await listOnlineOrders() });
  } catch (e) { return staffFail(e, 'online orders'); }
}
