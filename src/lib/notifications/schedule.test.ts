import { describe, expect, it } from 'vitest';
import { CATCH_UP_MIN, dueReports, isReportTask, reportSlot, reportWhen, runKey, type NotifSettings } from './schedule';

// 2026-09-28 was a Monday, 2026-09-30 a Wednesday.
const at = (hhmm: string, date = '2026-09-30') => new Date(`${date}T${hhmm}:00+05:00`);

// Both houses' settings as they stood on 2026-09-30: everything on.
const all: NotifSettings = {
  notifEnabled: true, notifPhones: ['923000000001', '923000000002'],
  notifDailyChecklist: true, notifOrderOverdue: true, notifGivenItems: true, notifEndOfDay: true,
  notifDailyReport: true, notifWeeklyReport: true, notifKarigarPayment: true, notifAdsDaily: true,
  notifDailyChecklistTime: '09:00', notifEndOfDayTime: '19:00',
};
const tasks = (s: NotifSettings | null, when: Date, ads = true) => dueReports(s, when, { ads }).map(d => d.task);

describe('when each report goes', () => {
  it('sends the checklist and both overdue checks at the checklist time', () => {
    expect(tasks(all, at('09:00'))).toEqual(['daily-checklist', 'overdue-orders', 'given-items']);
  });
  it('adds the weekly report and karigar payments on Mondays only', () => {
    expect(tasks(all, at('09:05', '2026-09-28'))).toEqual(['daily-checklist', 'overdue-orders', 'given-items', 'weekly-report', 'karigar-payments']);
    expect(tasks(all, at('09:05'))).not.toContain('weekly-report');
  });
  it('sends the ads summary at 9:30 in a house with Ads, never without', () => {
    expect(tasks(all, at('09:30'))).toContain('ads-daily');
    expect(tasks(all, at('09:30'), false)).not.toContain('ads-daily');
  });
  it('sends the end of day and the nightly report at their own times', () => {
    expect(tasks(all, at('19:00'))).toEqual(['end-of-day']);
    expect(tasks(all, at('21:00'))).toEqual(['daily-report']);
    expect(tasks({ ...all, notifDailyReportTime: '22:15' }, at('21:00'))).toEqual([]);
    expect(tasks({ ...all, notifDailyReportTime: '22:15' }, at('22:20'))).toEqual(['daily-report']);
  });
  it('follows the times set in Settings', () => {
    const s = { ...all, notifDailyChecklistTime: '10:30', notifEndOfDayTime: '20:00' };
    expect(tasks(s, at('09:00'))).toEqual([]);
    expect(tasks(s, at('10:30'))).toEqual(['daily-checklist', 'overdue-orders', 'given-items']);
    expect(tasks(s, at('20:10'))).toEqual(['end-of-day']);
  });
  it('still sends one missed by a rollout within the hour, not after', () => {
    expect(tasks(all, at('21:59'))).toEqual(['daily-report']);
    expect(CATCH_UP_MIN).toBe(60);
    expect(tasks(all, at('22:00'))).toEqual([]);
    expect(tasks(all, at('20:59'))).toEqual([]);
  });
  it('reads the clock in Karachi, whatever the server says', () => {
    // 16:00 UTC is 21:00 in Karachi.
    expect(tasks(all, new Date('2026-09-30T16:00:00Z'))).toEqual(['daily-report']);
    expect(dueReports(all, new Date('2026-09-30T16:00:00Z'))[0].key).toBe('2026-09-30_daily-report');
  });
  it('falls back to the usual times when a stored one is not a time', () => {
    expect(reportSlot('daily-checklist', { notifDailyChecklistTime: '' })).toEqual({ at: '09:00', weekday: null });
    expect(reportSlot('end-of-day', { notifEndOfDayTime: '7pm' })).toEqual({ at: '19:00', weekday: null });
    expect(reportSlot('daily-report', null)).toEqual({ at: '21:00', weekday: null });
  });
});

describe('what is never sent', () => {
  it('nothing with notifications off or no numbers', () => {
    expect(tasks({ ...all, notifEnabled: false }, at('09:00'))).toEqual([]);
    expect(tasks({ ...all, notifPhones: [] }, at('09:00'))).toEqual([]);
    expect(tasks({ ...all, notifPhones: [''] }, at('09:00'))).toEqual([]);
    expect(tasks(null, at('09:00'))).toEqual([]);
  });
  it('a report switched off', () => {
    expect(tasks({ ...all, notifGivenItems: false }, at('09:00'))).toEqual(['daily-checklist', 'overdue-orders']);
    expect(tasks({ ...all, notifDailyReport: undefined }, at('21:00'))).toEqual([]);
  });
});

describe('the words Settings shows', () => {
  it('says when', () => {
    expect(reportWhen('daily-report', all)).toBe('Daily at 9:00 pm');
    expect(reportWhen('weekly-report', all)).toBe('Mondays at 9:00 am');
    expect(reportWhen('ads-daily', all)).toBe('Daily at 9:30 am');
  });
  it('keys a day\'s claim by the Karachi date', () => {
    expect(runKey('2026-09-30', 'end-of-day')).toBe('2026-09-30_end-of-day');
    expect(isReportTask('daily-report')).toBe(true);
    expect(isReportTask('gold-daily-update')).toBe(false);
    expect(isReportTask(undefined)).toBe(false);
  });
});
