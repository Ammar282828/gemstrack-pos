import { describe, expect, it } from 'vitest';
import { NEW_AT_LEAST, byNewest, newArrivalIds, type Dated } from './new-arrivals';

const DAY = 86_400_000;
const now = Date.parse('2026-09-25T12:00:00Z');
const piece = (id: string, daysOld: number | null, extra: Partial<Dated> = {}): Dated =>
  ({ id, added: daysOld === null ? null : now - daysOld * DAY, collection: 'Rings', name: id, ...extra });

describe('new arrivals', () => {
  it('takes the site’s own shelf when it publishes one', () => {
    const ps = [piece('a', 1), piece('b', 200, { newArrival: true }), piece('c', 2)];
    expect([...newArrivalIds(ps, now)]).toEqual(['b']);
  });

  it('is everything from the last 30 days when there are enough', () => {
    const ps = [...Array.from({ length: 30 }, (_, i) => piece(`n${i}`, i % 29)), piece('old', 45)];
    const ids = newArrivalIds(ps, now);
    expect(ids.size).toBe(30);
    expect(ids.has('old')).toBe(false);
  });

  it('is never fewer than the newest 24 after a quiet month', () => {
    const ps = [piece('fresh', 3), ...Array.from({ length: 40 }, (_, i) => piece(`o${i}`, 40 + i)), piece('undated', null)];
    const ids = newArrivalIds(ps, now);
    expect(ids.size).toBe(NEW_AT_LEAST);
    expect(ids.has('fresh')).toBe(true);
    expect(ids.has('o0')).toBe(true);
    expect(ids.has('o39')).toBe(false);
    expect(ids.has('undated')).toBe(false);
  });

  it('is empty when the site gives no dates', () => {
    expect(newArrivalIds([piece('a', null), piece('b', null)], now).size).toBe(0);
  });

  it('sorts newest first, the undated last', () => {
    const ps = [piece('old', 90), piece('undated', null), piece('new', 1)];
    expect(ps.sort(byNewest).map(p => p.id)).toEqual(['new', 'old', 'undated']);
  });
});
