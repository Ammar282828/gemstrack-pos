import { describe, expect, it } from 'vitest';
import { formatDate, toDate } from './safe-date';

describe('safe-date', () => {
  it('formats a real date like date-fns does', () => {
    expect(formatDate('2026-11-03T10:00:00', 'yyyy-MM-dd')).toBe('2026-11-03');
    expect(formatDate(new Date(2026, 0, 5), 'd MMM')).toBe('5 Jan');
  });
  it('never throws on what the books can hold', () => {
    for (const bad of [undefined, null, '', 'not a date', '2026-13-45', NaN, {}, [], true]) {
      expect(() => formatDate(bad, 'd MMM')).not.toThrow();
      expect(formatDate(bad, 'd MMM')).toBe('–');
    }
    expect(formatDate(undefined, 'd MMM', '')).toBe('');
  });
  it('toDate rejects invalid dates', () => {
    expect(toDate('2026-02-30')).toBeNull();
    expect(toDate('2026-02-10')).toBeInstanceOf(Date);
    expect(toDate(0)).toBeInstanceOf(Date);
  });
});

describe('takenAt (when an order was taken, ERP screens only)', () => {
  it('gives the time with the date', async () => {
    const { takenAt } = await import('./safe-date');
    const d = new Date(); d.setHours(15, 42, 0, 0);
    expect(takenAt(d.toISOString())).toMatch(/, 3:42 PM$/);
  });
  it('gives a date-only record its date and no made-up time', async () => {
    const { takenAt } = await import('./safe-date');
    expect(takenAt('2024-03-05')).toBe('5 Mar 2024');
  });
  it('answers a dash for nothing', async () => {
    const { takenAt } = await import('./safe-date');
    expect(takenAt(undefined)).toBe('–');
  });
});
