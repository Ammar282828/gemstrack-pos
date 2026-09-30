import { describe, expect, it } from 'vitest';
import { readRange, rangeQuery } from './range-param';

const now = new Date(2026, 9, 1, 15, 0); // 1 Oct 2026, local
const read = (q: string) => readRange(new URLSearchParams(q), now);
const day = (d?: Date) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

describe('Analytics\' range in the address', () => {
  it('no query is the last 30 days, and writes no query', () => {
    expect(read('').key).toBe('last-30');
    expect(day(read('').range?.from)).toBe('2026-9-2');
    expect(rangeQuery('last-30')).toBe('');
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
  it('falls back to 30 days on anything it can\'t read', () => {
    expect(read('range=forever').key).toBe('last-30');
    expect(read('range=custom&from=nonsense').key).toBe('last-30');
    expect(read('range=custom').key).toBe('last-30');
  });
});
