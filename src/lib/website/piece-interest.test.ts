import { describe, expect, it } from 'vitest';
import { statsDocId, tallyEvents, windowed } from './piece-interest';

describe('tallyEvents', () => {
  it('sums each piece, both sites\' keys', () => {
    const t = tallyEvents({ e: [
      ['view', 'mina/piece/leah'], ['dwell', 'mina/piece/leah', 8400], ['save', 'mina/piece/leah'],
      ['view', 'Rings & Bands/Bands/Band 147.webp'], ['enquire', 'Rings & Bands/Bands/Band 147.webp'],
    ] });
    expect(t.get('mina/piece/leah')).toMatchObject({ views: 1, dwellMs: 8400, dwellN: 1, saves: 1 });
    expect(t.get('Rings & Bands/Bands/Band 147.webp')).toMatchObject({ views: 1, enquiries: 1 });
  });
  it('drops junk and caps a long look', () => {
    const t = tallyEvents({ e: [['dwell', 'a', 300], ['dwell', 'a', 3_600_000], ['boom', 'a'], ['view', '../x'], ['view', 5], 'x'] });
    expect(t.get('a')).toMatchObject({ dwellMs: 600_000, dwellN: 1 });
    expect(t.size).toBe(1);
    expect(tallyEvents(null).size).toBe(0);
  });
  it('keys a document without slashes', () => expect(statsDocId('mina/piece/leah')).toBe('mina~piece~leah'));
});

describe('windowed', () => {
  const s = { piece: 'a', views: 9, dwellMs: 0, dwellN: 0, saves: 3, unsaves: 0, enquiries: 1, days: { '2026-10-20': { views: 4, saves: 1 }, '2026-10-22': { views: 2 }, '2026-09-01': { views: 3 } } };
  it('counts only the days asked for', () => expect(windowed(s, 7, '2026-10-22')).toMatchObject({ views: 6, saves: 1 }));
  it('all time is the totals', () => expect(windowed(s, 0)).toMatchObject({ views: 9, saves: 3, enquiries: 1 }));
});
