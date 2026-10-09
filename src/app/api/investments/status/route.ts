/**
 * GET → what the schedule will do with today's Investments post, part by part, in words — for the
 * iPhone app (apps/iphone, WebsiteInvestments.swift), which shows the page's lines without a copy of
 * the schedule's rules.
 *
 *   { today, enabled, mode, lastTick, targets: [{ id, label, to }],
 *     day: { id, parts: { <target>: { kind, line: { text, tone } | null } } } | null }
 *
 * `targets` are the parts this shop can send at all (the schedule route's `destinations`), in the
 * order they go; `kind` is statusOf()'s (lib/investments-schedule.ts) and `line` the page's sentence
 * for it (lib/investments-words.ts), given only while automatic sending is on, as the page shows it.
 * Read-only: sending stays /api/investments/[id]/publish, the schedule's say /[id]/plan.
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate } from '@/lib/social/gate';
import { STORE_INVESTMENTS } from '@/lib/store-config';
import { getInvestmentPost, getSchedule } from '@/lib/investments';
import { destinationOf } from '@/lib/investments-send';
import { TARGET_ORDER, karachiNow, statusOf } from '@/lib/investments-schedule';
import { TARGET_WORDS, autoLine } from '@/lib/investments-words';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await postGate(req, STORE_INVESTMENTS);
  if (who instanceof NextResponse) return who;
  const now = karachiNow();
  const [schedule, post] = await Promise.all([getSchedule(), getInvestmentPost(now.date)]);
  const usable = TARGET_ORDER.filter(t => !!destinationOf(t));
  const day = post ? {
    id: post.id,
    parts: Object.fromEntries(usable.map(t => {
      const st = statusOf(schedule, post, t, now);
      return [t, { kind: st.kind, line: schedule.enabled ? autoLine(st) : null }];
    })),
  } : null;
  return NextResponse.json({
    today: now.date,
    enabled: schedule.enabled,
    mode: schedule.mode,
    lastTick: schedule.lastTick ?? null,
    targets: usable.map(t => ({ id: t, ...TARGET_WORDS[t] })),
    day,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
