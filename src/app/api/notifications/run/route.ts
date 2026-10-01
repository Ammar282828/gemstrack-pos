/**
 * POST {task, force?} → send one WhatsApp report to every number in Settings → Notifications.
 *
 * Callers: Cloud Scheduler (`ads-daily-summary` in both projects, Mina's `mina-daily-report`,
 * Bearer CRON_SECRET), which sends only a report that is switched on and not yet sent today
 * (the five-minute tick sends the same ones at the times in Settings — see
 * lib/notifications/schedule.ts); and Settings' "Send now" (`force`), which sends it anyway.
 *
 * "Send now" is open while sign-in is off, like the test button: a report only ever goes to
 * the shop's own saved numbers, never to the caller. The gold tasks stay scheduler-only.
 *
 * GET → when each scheduled report last went (for Settings): dates, how many numbers, errors.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-auth';
import { verifyRequestEmail, isOwnerEmail } from '@/lib/karigar-auth';
import { textDoc } from '@/lib/notifications/alerts';
import { sendDoc } from '@/lib/notifications/send-doc';
import { shortDay } from '@/lib/notifications/doc';
import { generateGoldDailyUpdate, checkGoldBreakingNews } from '@/lib/gold-update';
import { lastRuns, runReport } from '@/lib/notifications/dispatch';
import { isReportTask } from '@/lib/notifications/schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

const GOLD_UPDATE_PHONE = process.env.GOLD_UPDATE_PHONE || '923352275554';

export async function GET() {
  try {
    return NextResponse.json({ last: await lastRuns() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { task?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request body.' }, { status: 400 });
  }
  const { task } = body;
  const force = body.force === true;

  const viaCron = isCronAuthorized(req, { strict: true });
  if (!viaCron) {
    // From the page: a report the owner asked for, to the shop's own numbers.
    const allowed = isReportTask(task) && force && (OPEN_ACCESS || isOwnerEmail(await verifyRequestEmail(req)));
    if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Gold tasks bypass the shop's notification settings — they use their own phone.
    // As PDFs like every other report (lib/notifications/doc.ts), from the AI's WhatsApp-formatted words.
    if (task === 'gold-daily-update') {
      const msg = await generateGoldDailyUpdate();
      const now = new Date();
      const r = await sendDoc(textDoc({ kind: task, title: 'Gold update', headline: shortDay(now.toISOString()), text: msg }, now), [GOLD_UPDATE_PHONE]);
      if (!r.sent) throw new Error(r.failed.join('; ') || 'not sent');
      return NextResponse.json({ ok: true, task, fileName: r.fileName, preview: msg.substring(0, 200) + '...' });
    }
    if (task === 'gold-breaking-news') {
      const msg = await checkGoldBreakingNews();
      if (!msg) return NextResponse.json({ ok: true, task, alert: false, message: 'No breaking news' });
      const now = new Date();
      const r = await sendDoc(textDoc({ kind: task, title: 'Gold news', headline: shortDay(now.toISOString()), text: msg }, now), [GOLD_UPDATE_PHONE]);
      if (!r.sent) throw new Error(r.failed.join('; ') || 'not sent');
      return NextResponse.json({ ok: true, task, alert: true, fileName: r.fileName, preview: msg.substring(0, 200) + '...' });
    }
    if (!isReportTask(task)) return NextResponse.json({ error: `Unknown task: ${String(task)}` }, { status: 400 });

    const r = await runReport(task, { force, by: viaCron ? 'scheduler' : 'settings' });
    if (r.status === 'failed') return NextResponse.json({ ...r, error: r.error ?? `Could not send: ${r.failed?.join('; ')}` }, { status: 502 });
    return NextResponse.json({ ok: true, forced: force, ...r });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/notifications/run]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
