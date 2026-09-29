import { describe, it, expect } from 'vitest';
import { rateBoard } from './templates';

describe('rateBoard', () => {
  it('turns per-gram rates into per-tola rows, rounded to the hundred', () => {
    const b = rateBoard({ k24: 45_000, k22: 41_250, k21: 39_375, k18: 0 }, 'Tuesday 30 September');
    expect(b.date).toBe('Tuesday 30 September');
    expect(b.rows).toEqual([
      { label: '24K', perTola: 524_900 },
      { label: '22K', perTola: 481_100 },
      { label: '21K', perTola: 459_300 },
    ]);
  });
  it('leaves out a karat the shop has not set', () => {
    expect(rateBoard({ k21: 39_375 }, '').rows.map(r => r.label)).toEqual(['21K']);
    expect(rateBoard({}, '').rows).toEqual([]);
  });
});
