/**
 * POST → send the queued pieces whose time has come (Post a Piece's "Spread
 * over the day"), each claimed first so an overlapping or retried check can't
 * send it twice; a piece that fails is tried again at the next check, three
 * times in all. Also clears drafts that never finished arriving.
 *
 * Called every five minutes by Cloud Scheduler (job `social-queue-tick`, in
 * each house's project) with `Authorization: Bearer <CRON_SECRET>`.
 *
 * After the queue it sends the WhatsApp reports whose time has come (Settings → Notifications;
 * lib/notifications/schedule.ts) — in every house, with or without Post a Piece — and then, in
 * a house with the Ad studio, assesses the library in the background (assess-run.ts): a paced
 * slice in whatever time was left, so the photos get assessed with no page open. Their own jobs
 * would be cleaner; the cloud sessions can't create Scheduler jobs.
 * `?dry=1` answers what is due without sending anything.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-auth';
import { mediaOrigin } from '@/lib/social/gate';
import { claimItem, dueItems, sendItem, sweep } from '@/lib/social/queue';
import { STORE_AD_STUDIO, STORE_POST_PIECE } from '@/lib/store-config';
import { aiConfigured } from '@/lib/social/ai';
import { loadAssessState, runAssessSlice } from '@/lib/ads/studio/assess-run';
import { runDueReports } from '@/lib/notifications/dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Stop taking new pieces after this long, so the last one finishes inside the request. */
const BUDGET_MS = 150_000;

/** The reports due now; a failure here must never stop the queue. */
async function reports(dry: boolean) {
  try {
    const r = await runDueReports({ by: 'tick', dry });
    return { due: r.due, results: r.results.filter(x => x.status !== 'already').map(x => ({ task: x.task, status: x.status, sent: x.sent, error: x.error })) };
  } catch (e) {
    console.warn('[queue/tick] reports:', e instanceof Error ? e.message : e);
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req, { strict: true })) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const dry = req.nextUrl.searchParams.get('dry') === '1';
  // The reports ride this tick in every house, so they come before the Post a Piece gate.
  if (!STORE_POST_PIECE) return NextResponse.json({ ok: true, notifications: await reports(dry) });
  const started = Date.now();
  const due = await dueItems(new Date(started));
  if (dry) return NextResponse.json({ ok: true, dry: true, due: due.map(d => ({ id: d.id, headline: d.headline, dueAt: d.dueAt, status: d.status })), notifications: await reports(true) });
  const results: { id: string; headline: string; status: string }[] = [];
  for (const d of due) {
    if (Date.now() - started > BUDGET_MS) break;
    const item = await claimItem(d.id, new Date());
    if (!item) continue;
    const after = await sendItem(item, { by: 'schedule', origin: mediaOrigin(req) });
    results.push({ id: d.id, headline: d.headline, status: after.status });
  }
  const swept = await sweep().catch(() => 0);
  if (results.length) console.log(`[queue/tick] ${results.map(r => `${r.headline || r.id}:${r.status}`).join(' ')}`);
  const notifications = await reports(false);

  // The Ad studio's library, in the time left (the Scheduler's deadline is 300 s): a batch of ten
  // photographs, a pause, and so on — gentle on the AI key the counter shares.
  let assessed: { done: number; remaining: number; stopped: string | null; busy?: boolean } | null = null;
  const left = 240_000 - (Date.now() - started);
  if (STORE_AD_STUDIO && aiConfigured() && left > 60_000 && (await loadAssessState().then(s => s.background).catch(() => false))) {
    try {
      const r = await runAssessSlice({ budgetMs: Math.min(150_000, left - 45_000), by: 'background', paceMs: 12_000 });
      assessed = { done: r.done.length, remaining: r.remaining, stopped: r.stopped, busy: r.busy };
      if (r.done.length || r.stopped) console.log(`[queue/tick] assessed ${r.done.length}, ${r.remaining} left${r.stopped ? ` — ${r.stopped}` : ''}`);
    } catch (e) {
      console.warn('[queue/tick] assessing:', e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ ok: true, due: due.length, results, swept, notifications, assessed });
}
