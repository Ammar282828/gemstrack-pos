import { describe, expect, it } from 'vitest';
import { validWeight, weightForSite } from './site-weight';

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

  it('leaves the catalogue\'s pieces and new uploads alone, and anything not a weight', () => {
    expect(weightForSite({ source: 'pieces', weightGrams: null }, '3.84')).toBeNull();
    expect(weightForSite({ ...own, drop: true }, '3.84')).toBeNull();
    expect(weightForSite({ weightGrams: null }, '3.84')).toBeNull();
    for (const w of ['', '0', '0.0', 'abc', '3.', '-2']) expect(weightForSite(own, w)).toBeNull();
  });
});

describe('validWeight', () => {
  it('takes a positive number as typed', () => {
    expect(validWeight('3.84')).toBe(true);
    expect(validWeight('0')).toBe(false);
    expect(validWeight('3.')).toBe(false);
  });
});
