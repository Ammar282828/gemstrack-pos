/**
 * The owner's schedule for Investments by Taheri.
 *
 *   GET → { schedule, now (Karachi), destinations } — which parts this shop can send at all
 *   PUT { schedule } → save it (validated; the scheduler's heartbeat is kept)
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate } from '@/lib/social/gate';
import { STORE_INVESTMENTS } from '@/lib/store-config';
import { getSchedule, saveSchedule } from '@/lib/investments';
import { destinationOf } from '@/lib/investments-send';
import { TARGET_ORDER, karachiNow, normalizeSchedule } from '@/lib/investments-schedule';

export const dynamic = 'force-dynamic';

const destinations = () => Object.fromEntries(TARGET_ORDER.map(t => [t, !!destinationOf(t)]));

export async function GET(req: NextRequest) {
  const who = await postGate(req, STORE_INVESTMENTS);
  if (who instanceof NextResponse) return who;
  return NextResponse.json({ schedule: await getSchedule(), now: karachiNow(), destinations: destinations() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(req: NextRequest) {
  const who = await postGate(req, STORE_INVESTMENTS);
  if (who instanceof NextResponse) return who;
  const b = await req.json().catch(() => null) as { schedule?: unknown } | null;
  if (!b?.schedule) return NextResponse.json({ error: 'Send the schedule.' }, { status: 400 });
  const next = normalizeSchedule(b.schedule);
  // A part this shop can't send can't be scheduled either.
  const can = destinations();
  for (const t of TARGET_ORDER) if (!can[t]) next.targets[t].on = false;
  if (next.enabled && !next.days.length) return NextResponse.json({ error: 'Choose at least one day, or switch it off.' }, { status: 400 });
  const saved = await saveSchedule(next, who);
  console.log(`[investments/schedule] ${saved.enabled ? 'on' : 'off'} by ${who}`);
  return NextResponse.json({ ok: true, schedule: saved, now: karachiNow(), destinations: can });
}
