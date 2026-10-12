import { describe, expect, it } from 'vitest';
import { GRAMS_PER_TOLA } from '@/lib/units';
import { findTolaWeights, fromGrams, GRAMS_PER_MASHA, GRAMS_PER_RATTI, parseMoney, toGrams } from './units';

describe('tola, masha, ratti', () => {
  it('uses the repo\'s tola and 12 masha / 8 ratti', () => {
    expect(GRAMS_PER_MASHA).toBeCloseTo(GRAMS_PER_TOLA / 12, 9);
    expect(GRAMS_PER_RATTI).toBeCloseTo(GRAMS_PER_TOLA / 96, 9);
    expect(toGrams({ tola: 1 })).toBeCloseTo(11.664, 3);
    expect(toGrams({ tola: 2, masha: 3 })).toBeCloseTo(26.244, 3);
    expect(toGrams({ masha: 1, ratti: 8 })).toBeCloseTo(2 * 0.972, 3);
  });
  it('round-trips grams to tola, masha and ratti', () => {
    expect(fromGrams(26.244)).toEqual({ tola: 2, masha: 3, ratti: 0 });
    expect(fromGrams(0)).toEqual({ tola: 0, masha: 0, ratti: 0 });
  });
  it('finds weights written in words, in grams, with the words as written', () => {
    const [a] = findTolaWeights('Set 2 tola 3 masha only');
    expect(a.text).toBe('2 tola 3 masha');
    expect(a.grams).toBeCloseTo(26.244, 3);
    expect(findTolaWeights('adha tola')[0].grams).toBeCloseTo(5.832, 3);
    expect(findTolaWeights('dedh tola 2 ratti')[0].grams).toBeCloseTo(17.496 + 2 * GRAMS_PER_RATTI, 2);
    expect(findTolaWeights('1/2 tola')[0].grams).toBeCloseTo(5.832, 3);
    expect(findTolaWeights('5 masha')[0].grams).toBeCloseTo(4.86, 3);
    expect(findTolaWeights('12.5 gm')).toEqual([]);
  });
});

describe('money', () => {
  it.each([
    ['Rs 125,000', 125000], ['125k', 125000], ['1.2 lac', 120000], ['1.2 lakh', 120000], ['1 crore', 10000000],
    ['PKR 85,000', 85000], ['2.5 lacs', 250000], ['85000/-', 85000], ['Rs. 4.5 lac', 450000],
  ])('%s', (s, n) => expect(parseMoney(s)).toBe(n));
  it('refuses what is not an amount', () => {
    expect(parseMoney('ruby ring')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });
});
