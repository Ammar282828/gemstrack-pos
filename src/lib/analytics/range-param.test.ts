import { describe, expect, it } from 'vitest';
import { readRange, rangeQuery, rangeFor, DEFAULT_RANGE_KEY, QUICK_RANGES } from './range-param';

const now = new Date(2026, 9, 1, 15, 0); // 1 Oct 2026, local
const read = (q: string) => readRange(new URLSearchParams(q), now);
const day = (d?: Date) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

describe('Analytics\' range in the address', () => {
  it('no query is this month, and writes no query', () => {
    expect(DEFAULT_RANGE_KEY).toBe('this-month');
    expect(QUICK_RANGES[0].key).toBe('this-month');
    expect(read('').key).toBe('this-month');
    expect(day(read('').range?.from)).toBe('2026-10-1');
    expect(rangeQuery('this-month')).toBe('');
    expect(rangeQuery('last-30')).toBe('?range=last-30');
  });
  it('this month runs from the 1st to today', () => {
    const r = rangeFor('this-month', new Date(2026, 9, 12, 9, 30))!;
    expect(day(r.from)).toBe('2026-10-1');
    expect(day(r.to)).toBe('2026-10-12');
  });
  it('on the first day of a month, from and to are that day', () => {
    const r = rangeFor('this-month', new Date(2026, 10, 1, 8, 0))!;
    expect(day(r.from)).toBe('2026-11-1');
    expect(day(r.to)).toBe('2026-11-1');
  });
  it('last 30 days is still an option', () => {
    expect(read('range=last-30').key).toBe('last-30');
    expect(day(read('range=last-30').range?.from)).toBe('2026-9-2');
  });
  it('carries a quick range, a year and all time', () => {
    expect(read('range=last-90').key).toBe('last-90');
    expect(day(read('range=last-year').range?.from)).toBe('2025-1-1');
    expect(day(read('range=year-2024').range?.to)).toBe('2024-12-31');
    expect(read('range=all-time').range).toBeUndefined();
    expect(rangeQuery('last-90')).toBe('?range=last-90');
  });
  it('carries a custom range both ways', () => {
    const q = rangeQuery('custom', { from: new Date(2026, 8, 5), to: new Date(2026, 8, 20) });
    expect(q).toBe('?range=custom&from=2026-09-05&to=2026-09-20');
    const r = read(q.slice(1));
    expect(r.key).toBe('custom');
    expect(day(r.range?.from)).toBe('2026-9-5');
    expect(day(r.range?.to)).toBe('2026-9-20');
  });
  it('falls back to this month on anything it can\'t read', () => {
    expect(read('range=forever').key).toBe('this-month');
    expect(read('range=custom&from=nonsense').key).toBe('this-month');
    expect(read('range=custom').key).toBe('this-month');
  });
});
