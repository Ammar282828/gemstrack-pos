import { describe, expect, it } from 'vitest';
import { inkFor, meanLuminance, DARK_INK, WHITE_INK } from './label-ink';

describe('label ink', () => {
  it('is white on a dark corner and dark on a light one', () => {
    expect(inkFor(meanLuminance(new Uint8Array([20, 60, 40, 255, 30, 70, 50, 255])))).toBe(WHITE_INK);
    expect(inkFor(meanLuminance(new Uint8Array([235, 230, 225, 255])))).toBe(DARK_INK);
  });
  it('turns at the contrast crossover, about L = 0.20', () => {
    expect(inkFor(0.19)).toBe(WHITE_INK);
    expect(inkFor(0.21)).toBe(DARK_INK);
  });
});
