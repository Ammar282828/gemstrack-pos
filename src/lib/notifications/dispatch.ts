/**
 * Sends the WhatsApp reports: each built once and sent to every number in Settings.
 *
 * Callers: the five-minute tick (what schedule.ts says is due), `/api/notifications/run`
 * (the Cloud Scheduler jobs `ads-daily-summary` and Mina's `mina-daily-report`, and Settings'
 * "Send now"). A scheduled send claims `notif_runs/<date>_<task>` in a transaction first, so a
 * report goes once a day however many of those ask; a send that reached nobody is tried
 * again at the next tick, three times in all. "Send now" (`force`) takes no claim.
 */

import { adminDb } from '@/lib/firebase-admin';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { adsDigest } from '@/lib/ads/digest';
import { STORE_META_ADS } from '@/lib/store-config';
import { fromThisPos } from '@/lib/notify-label';
import { karachiNow } from '@/lib/investments-schedule';
import {
  buildDailyChecklist, buildDailyReport, buildEndOfDaySummary, buildGivenItems,
  buildKarigarPayments, buildOverdueOrders, buildWeeklyReport,
} from './reports';
import { dueReports, REPORT_TOGGLE, REPORT_TASKS, runKey, type NotifSettings, type ReportTask } from './schedule';

/**
 * The shop's settings are the `global` document. Reading "the first document" of
 * app_settings, as these routes did, found `ad_studio_assess` once the Ad studio wrote
 * one (29 Sep) — it sorts first — and every alert and report was refused from then on.
 */
export async function readNotifSettings(): Promise<NotifSettings | null> {
  const snap = await adminDb.collection('app_settings').doc('global').get();
  return snap.exists ? (snap.data() as NotifSettings) : null;
}

const BUILDERS: Record<ReportTask, () => Promise<string | null>> = {
  'daily-checklist': buildDailyChecklist,
  'overdue-orders': buildOverdueOrders,
  'given-items': buildGivenItems,
  'end-of-day': buildEndOfDaySummary,
  'daily-report': buildDailyReport,
  'weekly-report': buildWeeklyReport,
  'karigar-payments': buildKarigarPayments,
  'ads-daily': async () => fromThisPos(await adsDigest()),
};

export const RUNS = 'notif_runs';
const MAX_TRIES = 3;
/** A send in progress is left alone by other ticks for this long. */
const RUNNING_MS = 4 * 60 * 1000;

export type RunStatus = 'sent' | 'quiet' | 'failed' | 'off' | 'already';
export interface RunResult {
  task: ReportTask;
  status: RunStatus;
  sent?: number;
  recipients?: number;
  failed?: string[];
  error?: string;
  preview?: string;
}

const tail = (phone: string) => `…${String(phone).replace(/\D/g, '').slice(-4)}`;
const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Take today's claim for a report; false when it already went, is going, or ran out of tries. */
async function claim(date: string, task: ReportTask, by: string): Promise<boolean> {
  const ref = adminDb.collection(RUNS).doc(runKey(date, task));
  return adminDb.runTransaction(async tx => {
    const d = (await tx.get(ref)).data() as { status?: string; startedAt?: string; tries?: number } | undefined;
    if (d) {
      if (d.status === 'sent' || d.status === 'quiet') return false;
      if (d.status === 'running' && Date.now() - Date.parse(d.startedAt ?? '') < RUNNING_MS) return false;
      if ((d.tries ?? 0) >= MAX_TRIES) return false;
    }
    tx.set(ref, { task, date, status: 'running', startedAt: new Date().toISOString(), by, tries: (d?.tries ?? 0) + 1 }, { merge: true });
    return true;
  });
}

/**
 * One report to every number. Scheduled (`force` off): only when notifications and this
 * report are switched on, and once a day. Forced: whatever the switches say, no claim.
 */
export async function runReport(
  task: ReportTask,
  o: { force?: boolean; by: string; now?: Date; settings?: NotifSettings | null },
): Promise<RunResult> {
  const s = o.settings !== undefined ? o.settings : await readNotifSettings();
  const phones = (s?.notifPhones ?? []).map(String).filter(Boolean);
  if (!phones.length) return { task, status: 'off', error: 'No numbers are saved in Settings → Notifications.' };
  if (task === 'ads-daily' && !STORE_META_ADS) return { task, status: 'off', error: 'This house has no Ads.' };
  if (!o.force && !s?.notifEnabled) return { task, status: 'off', error: 'Notifications are switched off.' };
  if (!o.force && !s?.[REPORT_TOGGLE[task]]) return { task, status: 'off', error: 'This report is switched off.' };

  const date = karachiNow(o.now ?? new Date()).date;
  if (!o.force && !(await claim(date, task, o.by))) return { task, status: 'already' };
  const ref = o.force ? null : adminDb.collection(RUNS).doc(runKey(date, task));
  const finish = (r: RunResult) =>
    ref?.set({ status: r.status, finishedAt: new Date().toISOString(), sent: r.sent ?? 0, recipients: r.recipients ?? 0, failed: r.failed ?? [], error: r.error ?? null }, { merge: true })
      .catch(e => console.warn(`[notifications] could not record ${task}:`, why(e)));

  let result: RunResult;
  try {
    const message = await BUILDERS[task]();
    if (!message) {
      // Nothing to report (no overdue orders, nothing given out): quiet, and done for the day.
      result = { task, status: 'quiet' };
    } else {
      const failed: string[] = [];
      let sent = 0;
      for (const phone of phones) {
        try { await sendWhatsAppMessage(phone, message); sent++; }
        catch (e) { failed.push(`${tail(phone)}: ${why(e)}`); }
      }
      // Reaching some numbers counts as sent: trying again would repeat it to the others.
      result = { task, status: sent ? 'sent' : 'failed', sent, recipients: phones.length, failed, preview: message.slice(0, 200) };
    }
  } catch (e) {
    result = { task, status: 'failed', error: why(e) };
  }
  await finish(result);
  if (result.status === 'failed') console.error(`[notifications] ${task} failed:`, result.error ?? result.failed?.join('; '));
  return result;
}

/** Everything due now (dueReports), sent in order. `dry` only says what is due. */
export async function runDueReports(o: { now?: Date; by?: string; dry?: boolean } = {}): Promise<{ due: ReportTask[]; results: RunResult[] }> {
  const now = o.now ?? new Date();
  const settings = await readNotifSettings();
  const due = dueReports(settings, now, { ads: STORE_META_ADS }).map(d => d.task);
  if (o.dry) return { due, results: [] };
  const results: RunResult[] = [];
  for (const task of due) results.push(await runReport(task, { by: o.by ?? 'tick', now, settings }));
  const acted = results.filter(r => r.status !== 'already');
  if (acted.length) console.log(`[notifications] ${acted.map(r => `${r.task}:${r.status}`).join(' ')}`);
  return { due, results };
}

export interface LastRun { date: string; status: string; at: string | null; sent: number; recipients: number; failed: string[]; error: string | null; tries: number }

/** Each report's latest scheduled run in the last eight days, for Settings. */
export async function lastRuns(now = new Date()): Promise<Partial<Record<ReportTask, LastRun>>> {
  const since = karachiNow(new Date(now.getTime() - 8 * 86_400_000)).date;
  const snap = await adminDb.collection(RUNS).where('date', '>=', since).get();
  const out: Partial<Record<ReportTask, LastRun>> = {};
  for (const doc of snap.docs) {
    const d = doc.data();
    const task = d.task as ReportTask;
    if (!REPORT_TASKS.includes(task)) continue;
    const prev = out[task];
    if (prev && prev.date >= d.date) continue;
    out[task] = {
      date: d.date, status: d.status, at: d.finishedAt ?? d.startedAt ?? null,
      sent: d.sent ?? 0, recipients: d.recipients ?? 0, failed: d.failed ?? [], error: d.error ?? null, tries: d.tries ?? 0,
    };
  }
  return out;
}
