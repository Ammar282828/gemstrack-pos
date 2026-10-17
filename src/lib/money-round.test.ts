import { describe, expect, it } from 'vitest';
import { discountWithOffer, roundOffLabel, roundOffOffers, settleRemainderOffer } from './money-round';

describe('roundOffOffers', () => {
  it('offers the round-downs, smallest cost first, at most three', () => {
    expect(roundOffOffers(272_340)).toMatchObject([
      { target: 272_300, extra: 40 },
      { target: 272_000, extra: 340 },
      { target: 270_000, extra: 2_340 },
    ]);
  });

  it('takes the three cheapest when more qualify', () => {
    // 100 -> 273,600, 500 -> 273,500, 1000 -> 273,000, 5000/10000 -> 270,000
    const o = roundOffOffers(273_640);
    expect(o).toHaveLength(3);
    expect(o.map(x => x.target)).toEqual([273_600, 273_500, 273_000]);
  });

  it('dedupes steps that land on the same target', () => {
    const o = roundOffOffers(12_300); // 100 -> itself (round), 500 -> 12,000, 1000 -> 12,000, 5000/10000 -> 10,000
    expect(o.map(x => x.target)).toEqual([12_000, 10_000]);
    expect(o[0].extra).toBe(300);
  });

  it('offers nothing for a total that is already round', () => {
    expect(roundOffOffers(270_000)).toMatchObject([]);
    expect(roundOffOffers(100)).toMatchObject([]);
  });

  it('offers nothing under 100: rounding down would give the bill away', () => {
    expect(roundOffOffers(99)).toMatchObject([]);
    expect(roundOffOffers(1)).toMatchObject([]);
    expect(roundOffOffers(0)).toMatchObject([]);
  });

  it('handles a small bill with a real round target', () => {
    expect(roundOffOffers(1_234)).toMatchObject([
      { target: 1_200, extra: 34 },
      { target: 1_000, extra: 234 },
    ]);
  });

  it('draws the line at 5,000: under is a candidate, 5,000 itself never is', () => {
    // 9,999 is 4,999 over 5,000 (a candidate) but three cheaper offers come first.
    expect(roundOffOffers(9_999)).toMatchObject([
      { target: 9_900, extra: 99 }, { target: 9_500, extra: 499 }, { target: 9_000, extra: 999 },
    ]);
    // 15,000 and 5,000 are round: the next step down would cost exactly 5,000 and is not offered.
    expect(roundOffOffers(15_000)).toMatchObject([]);
    expect(roundOffOffers(5_000)).toMatchObject([]);
    expect(roundOffOffers(5_099)).toMatchObject([{ target: 5_000, extra: 99 }]);
    expect(roundOffOffers(4_999).map(x => x.target)).toEqual([4_900, 4_500, 4_000]);
  });

  it('never offers more than 4,999 off', () => {
    for (const t of [10_001, 49_999, 123_456, 999_999]) {
      for (const o of roundOffOffers(t)) {
        expect(o.extra).toBeGreaterThan(0);
        expect(o.extra).toBeLessThan(5_000);
        expect(o.target + o.extra).toBe(t);
      }
    }
  });

  it('offers nothing for a negative, empty or unreadable total', () => {
    expect(roundOffOffers(-5_250)).toMatchObject([]);
    expect(roundOffOffers(NaN)).toMatchObject([]);
    expect(roundOffOffers(undefined as unknown as number)).toMatchObject([]);
  });

  it('reads an old fractional total as whole rupees', () => {
    expect(roundOffOffers(272_340.4)).toEqual(roundOffOffers(272_340));
  });
});

describe('discountWithOffer', () => {
  it('adds the extra to a discount already typed', () => {
    // 300,000 bill, 27,660 typed -> total 272,340; the 270,000 offer adds 2,340.
    const offer = roundOffOffers(300_000 - 27_660).find(o => o.target === 270_000)!;
    expect(discountWithOffer(27_660, offer)).toBe(30_000);
    expect(300_000 - discountWithOffer(27_660, offer)).toBe(270_000);
  });
});

describe('settleRemainderOffer', () => {
  it('gives away a small remainder', () => {
    expect(settleRemainderOffer(1)).toBe(1);
    expect(settleRemainderOffer(4_999)).toBe(4_999);
    expect(settleRemainderOffer(2_340)).toBe(2_340);
  });
  it('does not at 5,000 or more', () => {
    expect(settleRemainderOffer(5_000)).toBeNull();
    expect(settleRemainderOffer(120_000)).toBeNull();
  });
  it('does not when nothing is left, or the customer overpaid', () => {
    expect(settleRemainderOffer(0)).toBeNull();
    expect(settleRemainderOffer(-300)).toBeNull();
    expect(settleRemainderOffer(0.4)).toBeNull();
    expect(settleRemainderOffer(NaN)).toBeNull();
  });
});

describe('roundOffLabel', () => {
  it('reads like the chip', () => {
    expect(roundOffLabel({ target: 270_000, extra: 2_340 })).toBe('Round to 270,000 · −2,340');
  });
});

// Plain input -> output tables, for the apps to port.
describe('tables', () => {
  const rows: [string, number, number, [number, number][]][] = [
    // name, total, existing discount, [target, extra]...
    ['round already', 270_000, 0, []],
    ['under 100', 99, 0, []],
    ['typed discount counts', 300_000, 27_660, [[272_300, 40], [272_000, 340], [270_000, 2_340]]],
    ['discount makes it round', 300_000, 30_000, []],
    ['small', 1_234, 0, [[1_200, 34], [1_000, 234]]],
  ];
  it.each(rows)('%s', (_n, total, disc, want) => {
    const got = roundOffOffers(total, disc);
    expect(got.map(o => [o.target, o.extra])).toEqual(want);
    for (const o of got) expect(o.discount).toBe(disc + o.extra);
  });
  it('isSettled / rupees', async () => {
    const m = await import('./money-round');
    expect([0.99, -0.99, 1, -1, 0].map(m.isSettled)).toEqual([true, true, false, false, true]);
    expect([2.5, 2.49, -0.4, 297000.5].map(m.rupees)).toEqual([3, 2, 0, 297001]);
    expect(m.lineTotal([10.4, 10.4, 10.4])).toBe(30);
  });
});
