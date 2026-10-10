import { describe, expect, it } from 'vitest';
import { postOnlyWeight, validWeight, weightForSite } from './site-weight';

const own = { source: 'attributes' as const, weightGrams: null };

describe('weightForSite', () => {
  it('keeps a typed weight for taheri.shop\'s own photograph that has none, to two places', () => {
    expect(weightForSite(own, '3.84')).toBe(3.84);
    expect(weightForSite(own, ' 12 ')).toBe(12);
    expect(weightForSite(own, '5.4567')).toBe(5.46);
  });

  it('never changes a weight the site already has', () => {
    expect(weightForSite({ ...own, weightGrams: 4.1 }, '4.2')).toBeNull();
  });

  it('keeps one for a new upload too (the site takes the drops\' keys)', () => {
    expect(weightForSite({ ...own, drop: true }, '3.84')).toBe(3.84);
  });

  it('leaves the catalogue\'s pieces alone, and anything not a weight', () => {
    expect(weightForSite({ source: 'pieces', weightGrams: null }, '3.84')).toBeNull();
    expect(weightForSite({ weightGrams: null }, '3.84')).toBeNull();
    for (const w of ['', '0', '0.0', 'abc', '3.', '-2']) expect(weightForSite(own, w)).toBeNull();
  });
});

describe('postOnlyWeight', () => {
  it('is the post\'s own only when the site has a weight and a different one is typed', () => {
    expect(postOnlyWeight(4.2, '4.2')).toBe(false);
    expect(postOnlyWeight(4.2, '4.20')).toBe(false);
    expect(postOnlyWeight(4.2, '4.35')).toBe(true);
    expect(postOnlyWeight(null, '4.35')).toBe(false);
    expect(postOnlyWeight(4.2, '')).toBe(false);
  });
});

describe('validWeight', () => {
  it('takes a positive number as typed', () => {
    expect(validWeight('3.84')).toBe(true);
    expect(validWeight('0')).toBe(false);
    expect(validWeight('3.')).toBe(false);
  });
});
