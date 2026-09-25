/**
 * POST → the schedule's check: send whatever part of today's Investments post
 * is due (src/lib/investments-schedule.ts), each once, in order.
 *
 * Called every five minutes by Cloud Scheduler (job `investments-tick`,
 * gemstrack-pos, us-central1) with `Authorization: Bearer <CRON_SECRET>`.
 * Nothing goes unless the owner has switched the schedule on in the POS; each
 * part is claimed first (claimAuto) so an overlapping or retried check can't
 * send it twice; a failure is logged, shown on the page, and tried again at the
 * next check, three times in all.
 *
 * `?dry=1` answers what is due now without sending anything — for checking a
 * schedule without posting to anyone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-auth';
import { mediaOrigin, notInThisShop } from '@/lib/social/gate';
import { recordError } from '@/lib/social/errors';
import { STORE_INVESTMENTS } from '@/lib/store-config';
import { autoFailed, autoSucceeded, claimAuto, getInvestmentPost, getSchedule, touchTick } from '@/lib/investments';
import { sendInvestmentPart } from '@/lib/investments-send';
import { dueTargets, karachiNow } from '@/lib/investments-schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!STORE_INVESTMENTS) return notInThisShop();
  if (!isCronAuthorized(req, { strict: true })) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const started = new Date();
  const now = karachiNow(started);
  const schedule = await getSchedule();
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  if (!dry) await touchTick(started.toISOString()).catch(e => console.warn('[investments/tick] heartbeat', e));
  if (!schedule.enabled && !dry) return NextResponse.json({ ok: true, now, enabled: false });

  const day = await getInvestmentPost(now.date);
  const due = dueTargets(schedule, day, now);
  if (dry) return NextResponse.json({ ok: true, dry: true, now, arrived: !!day, due });
  const results: { target: string; ok: boolean; ref?: string; error?: string }[] = [];
  for (const target of due) {
    if (!(await claimAuto(now.date, target, started))) continue;
    try {
      const sent = await sendInvestmentPart(now.date, target, { by: 'schedule', origin: mediaOrigin(req) });
      await autoSucceeded(now.date, target).catch(() => undefined);
      results.push({ target, ok: true, ref: sent.ref });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await autoFailed(now.date, target, message).catch(() => undefined);
      await recordError(target === 'instagram' ? 'instagram' : 'whatsapp', e, { by: 'schedule', investments: now.date, target });
      results.push({ target, ok: false, error: message });
    }
  }
  if (results.length) console.log(`[investments/tick] ${now.date} ${results.map(r => `${r.target}:${r.ok ? 'sent' : 'failed'}`).join(' ')}`);
  return NextResponse.json({ ok: true, now, arrived: !!day, due, results });
}
