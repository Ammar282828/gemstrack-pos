/**
 * When each WhatsApp report goes out, from Settings → Notifications, in Karachi time.
 *
 * The reports used to need `node notifications-scheduler.js` running on a computer, which
 * nothing ran, so only the two with a Cloud Scheduler job of their own ever went (Mina's
 * 9 pm report, both houses' ads summary). Now the five-minute tick (`social-queue-tick`,
 * in both projects) asks this module what is due and sends it, once a day each: the
 * morning checklist with its two overdue checks, the end-of-day recap, the nightly
 * report, on Mondays the weekly report and karigar balances, and on the 1st the month
 * before as a PDF with every sale in it (lib/reports/monthly.ts). A report whose time
 * passed while the ERP was down or rolling out still goes within the hour after.
 *
 * Pure, so the page shows the same times the server keeps.
 */

import { clock, isTime, karachiNow, toMinutes } from '@/lib/investments-schedule';

export type ReportTask =
  | 'daily-checklist' | 'overdue-orders' | 'given-items'
  | 'end-of-day' | 'daily-report'
  | 'weekly-report' | 'karigar-payments'
  | 'ads-daily'
  | 'monthly-report';

/** The part of `app_settings/global` the reports read. */
export interface NotifSettings {
  notifEnabled?: boolean;
  notifPhones?: string[];
  notifDailyChecklist?: boolean;
  notifOrderOverdue?: boolean;
  notifGivenItems?: boolean;
  notifEndOfDay?: boolean;
  notifDailyReport?: boolean;
  notifWeeklyReport?: boolean;
  notifKarigarPayment?: boolean;
  notifAdsDaily?: boolean;
  notifMonthlyReport?: boolean;
  notifDailyChecklistTime?: string;
  notifEndOfDayTime?: string;
  notifDailyReportTime?: string;
}

export const DEFAULT_TIMES = { checklist: '09:00', endOfDay: '19:00', dailyReport: '21:00', ads: '09:30' } as const;

/** The switch in Settings that turns each report on. */
export const REPORT_TOGGLE: Record<ReportTask, keyof NotifSettings> = {
  'daily-checklist': 'notifDailyChecklist',
  'overdue-orders': 'notifOrderOverdue',
  'given-items': 'notifGivenItems',
  'end-of-day': 'notifEndOfDay',
  'daily-report': 'notifDailyReport',
  'weekly-report': 'notifWeeklyReport',
  'karigar-payments': 'notifKarigarPayment',
  'ads-daily': 'notifAdsDaily',
  'monthly-report': 'notifMonthlyReport',
};

/** Every report, in the order a tick sends them. */
export const REPORT_TASKS = Object.keys(REPORT_TOGGLE) as ReportTask[];

export const isReportTask = (t: unknown): t is ReportTask => typeof t === 'string' && t in REPORT_TOGGLE;

const MONDAY = 1;

/** A report's time (Karachi) and, for the weekly ones, its weekday; for the monthly one, its day of the month. */
export function reportSlot(task: ReportTask, s: NotifSettings | null | undefined): { at: string; weekday: number | null; monthDay?: number } {
  const checklist = isTime(s?.notifDailyChecklistTime) ? s!.notifDailyChecklistTime! : DEFAULT_TIMES.checklist;
  switch (task) {
    case 'daily-checklist':
    case 'overdue-orders':
    case 'given-items':
      return { at: checklist, weekday: null };
    case 'end-of-day':
      return { at: isTime(s?.notifEndOfDayTime) ? s!.notifEndOfDayTime! : DEFAULT_TIMES.endOfDay, weekday: null };
    case 'daily-report':
      return { at: isTime(s?.notifDailyReportTime) ? s!.notifDailyReportTime! : DEFAULT_TIMES.dailyReport, weekday: null };
    case 'weekly-report':
    case 'karigar-payments':
      return { at: checklist, weekday: MONDAY };
    case 'ads-daily':
      // Also the time of the `ads-daily-summary` Scheduler job; the day's claim stops a second send.
      return { at: DEFAULT_TIMES.ads, weekday: null };
    case 'monthly-report':
      return { at: checklist, weekday: null, monthDay: 1 };
  }
}

/** "Daily at 9:00 am", "Mondays at 9:00 am". */
export function reportWhen(task: ReportTask, s: NotifSettings | null | undefined): string {
  const { at, weekday, monthDay } = reportSlot(task, s);
  if (monthDay) return `The 1st of each month at ${clock(at)}, for the month before`;
  return `${weekday === MONDAY ? 'Mondays' : 'Daily'} at ${clock(at)}`;
}

/** How long after its time a missed report is still sent. */
export const CATCH_UP_MIN = 60;

export interface DueReport { task: ReportTask; date: string; key: string }

/** The claim a scheduled send takes, so each report goes once a day whoever asks. */
export const runKey = (date: string, task: ReportTask) => `${date}_${task}`;

/**
 * The reports that should be going out now: notifications on, a number to send to, the
 * report switched on, its day, and between its time and CATCH_UP_MIN after it.
 * Whether it already went is the claim's business (runKey), not this function's.
 */
export function dueReports(s: NotifSettings | null | undefined, now: Date, o: { ads?: boolean } = {}): DueReport[] {
  if (!s?.notifEnabled || !(s.notifPhones ?? []).some(Boolean)) return [];
  const k = karachiNow(now);
  return REPORT_TASKS.filter(task => {
    if (!s[REPORT_TOGGLE[task]]) return false;
    if (task === 'ads-daily' && !o.ads) return false;
    const { at, weekday, monthDay } = reportSlot(task, s);
    if (weekday !== null && k.weekday !== weekday) return false;
    if (monthDay && Number(k.date.slice(8, 10)) !== monthDay) return false;
    const from = toMinutes(at);
    return k.minutes >= from && k.minutes < from + CATCH_UP_MIN;
  }).map(task => ({ task, date: k.date, key: runKey(k.date, task) }));
}
