import { describe, expect, it } from 'vitest';
import { newestFirst } from './sort-by-time';

describe('newestFirst', () => {
  const rows = [
    { id: 'a', at: '2026-01-01T10:00:00.000Z' },
    { id: 'b', at: '2026-03-01T10:00:00.000Z' },
    { id: 'c', at: 'not a date' },
    { id: 'd', at: '2026-03-01T10:00:00.000Z' },
    { id: 'e', at: '2026-02-01T10:00:00.000Z' },
  ];
  it('puts the newest first, ties in their original order, unreadable dates last', () => {
    expect(newestFirst(rows, r => r.at).map(r => r.id)).toEqual(['b', 'd', 'e', 'a', 'c']);
  });
  it('does not change the input', () => {
    const copy = [...rows];
    newestFirst(rows, r => r.at);
    expect(rows).toEqual(copy);
  });
});
