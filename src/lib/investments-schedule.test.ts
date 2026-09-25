import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULE, MAX_TRIES, clock, daysLabel, dueTargets, karachiNow, normalizeSchedule, statusOf, type DayState, type KarachiNow, type Schedule } from './investments-schedule';

// 2026-09-25 was a Friday.
const at = (hhmm: string, date = '2026-09-25'): KarachiNow => karachiNow(new Date(`${date}T${hhmm}:00+05:00`));
const on: Schedule = { ...DEFAULT_SCHEDULE, enabled: true, days: [0, 1, 2, 3, 4, 5, 6] };
const day = (p: Partial<DayState> = {}): DayState => ({
  date: '2026-09-25', receivedAt: '2026-09-25T06:05:00.000Z' /* 11:05 Karachi */, post: 'Gold today…', teaser: 'Gold moved…', cards: ['square', 'story'], sent: {}, ...p,
});

describe('Karachi time', () => {
  it('reads the date, minutes and weekday in Karachi, not UTC', () => {
    const n = karachiNow(new Date('2026-09-25T20:30:00Z')); // 01:30 on the 26th in Karachi
    expect(n.date).toBe('2026-09-26');
    expect(n.minutes).toBe(90);
    expect(n.weekday).toBe(6);
  });
  it('writes times and days the way the page shows them', () => {
    expect(clock('13:05')).toBe('1:05 pm');
    expect(clock('00:15')).toBe('12:15 am');
    expect(daysLabel([1, 2, 3, 4, 5, 6])).toBe('Mon–Sat');
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
    expect(daysLabel([5, 1, 3])).toBe('Mon, Wed, Fri');
  });
});

describe('the schedule as stored', () => {
  it('is off, Mon–Sat, group and teaser, when nothing was saved', () => {
    const s = normalizeSchedule(undefined);
    expect(s.enabled).toBe(false);
    expect(s.days).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s.targets.group.on).toBe(true);
    expect(s.targets.channel.on).toBe(false);
  });
  it('throws out anything malformed rather than trusting it', () => {
    const s = normalizeSchedule({ enabled: 'yes', days: [1, 9, 1, -2, 3.5], mode: 'whenever', lateUntil: '25:00', targets: { group: { on: true, at: '7pm' }, teaser: { at: 'arrival' } } });
    expect(s.enabled).toBe(false);
    expect(s.days).toEqual([1]);
    expect(s.mode).toBe('auto');
    expect(s.lateUntil).toBe('20:00');
    expect(s.targets.group.at).toBe('11:30');
    expect(s.targets.teaser.at).toBe('arrival');
  });
});

describe('what is due', () => {
  it('sends each part at its own time', () => {
    expect(dueTargets(on, day(), at('11:29'))).toEqual([]);
    expect(dueTargets(on, day(), at('11:30'))).toEqual(['group']);
    expect(dueTargets(on, day(), at('12:05'))).toEqual(['group', 'teaser']);
  });
  it('never sends when switched off, on another day, or a day not in the schedule', () => {
    expect(dueTargets({ ...on, enabled: false }, day(), at('12:05'))).toEqual([]);
    expect(dueTargets(on, day({ date: '2026-09-24' }), at('12:05'))).toEqual([]);
    expect(statusOf({ ...on, days: [1, 2, 3, 4, 6] }, day(), 'group', at('12:05')).kind).toBe('not-a-day'); // Friday off
  });
  it('sends nothing twice', () => {
    expect(dueTargets(on, day({ sent: { group: { at: 'x' } } }), at('12:05'))).toEqual(['teaser']);
  });
  it('holds a day, and waits for the OK when asked to', () => {
    expect(statusOf(on, day({ hold: true }), 'group', at('12:05')).kind).toBe('held');
    const ask: Schedule = { ...on, mode: 'approve' };
    expect(statusOf(ask, day(), 'group', at('12:05')).kind).toBe('needs-ok');
    expect(statusOf(ask, day({ approved: { at: 'x', by: 'y' } }), 'group', at('12:05')).kind).toBe('due');
  });
  it('sends "as soon as it arrives" at the next check after the post is filed', () => {
    const s: Schedule = { ...on, targets: { ...on.targets, group: { on: true, at: 'arrival' } } };
    expect(statusOf(s, day(), 'group', at('11:04')).kind).toBe('later');
    expect(statusOf(s, day(), 'group', at('11:05')).kind).toBe('due');
  });
  it('still sends a late post until the cut-off, and never after it', () => {
    expect(statusOf(on, day(), 'group', at('19:55')).kind).toBe('due');
    expect(statusOf(on, day(), 'group', at('20:01')).kind).toBe('too-late');
    // A part timed after the cut-off still gets its half hour.
    const late: Schedule = { ...on, targets: { ...on.targets, group: { on: true, at: '21:00' } } };
    expect(statusOf(late, day(), 'group', at('21:20')).kind).toBe('due');
  });
  it('skips a part that is missing what it needs', () => {
    expect(statusOf(on, day({ teaser: '  ' }), 'teaser', at('12:05'))).toEqual({ kind: 'missing', what: 'a teaser' });
    const ig: Schedule = { ...on, targets: { ...on.targets, instagram: { on: true, at: '13:00' } } };
    expect(statusOf(ig, day({ cards: ['square'] }), 'instagram', at('13:05')).kind).toBe('missing');
  });
  it('leaves a part alone while another check is sending it, and gives up after three failures', () => {
    const now = at('12:05');
    expect(statusOf(on, day({ auto: { group: { claimedAt: new Date(now.ms - 60_000).toISOString() } } }), 'group', now).kind).toBe('sending');
    expect(statusOf(on, day({ auto: { group: { claimedAt: new Date(now.ms - 11 * 60_000).toISOString() } } }), 'group', now).kind).toBe('due');
    expect(statusOf(on, day({ auto: { group: { tries: MAX_TRIES, error: 'WAHA 500' } } }), 'group', now)).toEqual({ kind: 'gave-up', error: 'WAHA 500' });
    expect(statusOf(on, day({ auto: { group: { tries: 1 } } }), 'group', now).kind).toBe('due');
  });
});
