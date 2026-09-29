import { describe, expect, it } from 'vitest';
import { wastagePercentOf } from './wastage';

// The two Taheri estimates of 2026-09-29, as written.
describe('wastage off a slip', () => {
  it('grams on the weight: 0.650 on 6.500 is 10%', () => {
    expect(wastagePercentOf({ weightG: 6.5, wastageG: 0.65 })).toBe(10);
    expect(wastagePercentOf({ weightG: 6.3, wastageG: 0.63 })).toBe(10);
  });
  it('grams on the metal after the stone comes off: 0.520 on 5.700 − 0.500', () => {
    expect(wastagePercentOf({ weightG: 5.7, stoneWeightG: 0.5, wastageG: 0.52 })).toBe(10);
  });
  it('a written percent wins', () => {
    expect(wastagePercentOf({ weightG: 10, wastageG: 0.5, wastagePercent: 12 })).toBe(12);
  });
  it('nothing written, or no weight to take it on, is no wastage', () => {
    expect(wastagePercentOf({ weightG: 5 })).toBeNull();
    expect(wastagePercentOf({ wastageG: 0.5 })).toBeNull();
    expect(wastagePercentOf({ weightG: 0.5, stoneWeightG: 0.5, wastageG: 0.1 })).toBeNull();
  });
});
