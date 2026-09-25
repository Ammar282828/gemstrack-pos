/**
 * POST { hold?, approve?, retry? } → the owner's say over one day's schedule:
 * hold it back (or let it go again), give it the OK the schedule is waiting
 * for, or clear a part that failed three times so the next check tries again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate } from '@/lib/social/gate';
import { STORE_INVESTMENTS } from '@/lib/store-config';
import { getInvestmentPost, isDateId, setDayPlan, type Target } from '@/lib/investments';
import { TARGET_ORDER } from '@/lib/investments-schedule';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await postGate(req, STORE_INVESTMENTS);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  if (!isDateId(id) || !(await getInvestmentPost(id))) return NextResponse.json({ error: 'No such post.' }, { status: 404 });
  const b = await req.json().catch(() => null) as { hold?: unknown; approve?: unknown; retry?: unknown } | null;
  const change: { hold?: boolean; approve?: boolean; retry?: Target } = {};
  if (typeof b?.hold === 'boolean') change.hold = b.hold;
  if (typeof b?.approve === 'boolean') change.approve = b.approve;
  if (typeof b?.retry === 'string' && TARGET_ORDER.includes(b.retry as Target)) change.retry = b.retry as Target;
  if (!Object.keys(change).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
  await setDayPlan(id, change, who);
  return NextResponse.json({ ok: true, post: await getInvestmentPost(id) });
}
