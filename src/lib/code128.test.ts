import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, code128Modules, code128Values, code128Widths } from './code128';

describe('code128', () => {
  it('weights the check symbol by position (PJJ123C: 54 in Code A on Wikipedia, so 55 in Code B, one more for the start)', () => {
    const v = code128Values('PJJ123C');
    expect(v[0]).toBe(104);
    expect(v[v.length - 2]).toBe(55);
    expect(v[v.length - 1]).toBe(106);
  });
  it('packs an even run of digits two to a symbol (Code C)', () => {
    expect(code128Values('779412')).toEqual([105, 77, 94, 12, (105 + 77 * 1 + 94 * 2 + 12 * 3) % 103, 106]);
  });
  it('carries an odd run of digits in Code B', () => {
    expect(code128Values('12345')[0]).toBe(104);
  });
  it('every symbol is 11 modules, the stop 13, bars and spaces alternating', () => {
    const text = '779412345678';
    const w = code128Widths(text);
    expect(code128Modules(text)).toBe(11 * (code128Values(text).length - 1) + 13);
    expect(w.length).toBe(6 * (code128Values(text).length - 1) + 7);
    expect(w.every(x => x >= 1 && x <= 4)).toBe(true);
  });
  it('the table is whole: 107 distinct symbols, 11 modules each with even bars (13 for the stop)', () => {
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
    CODE128_PATTERNS.forEach((p, v) => {
      const w = p.split('').map(Number);
      expect(w.reduce((a, b) => a + b, 0)).toBe(v === 106 ? 13 : 11);
      if (v < 106) expect((w[0] + w[2] + w[4]) % 2).toBe(0);
    });
    expect(CODE128_PATTERNS.slice(103, 107)).toEqual(['211412', '211214', '211232', '2331112']);
  });
  it('refuses what Code B cannot carry', () => {
    expect(() => code128Values('')).toThrow();
    expect(() => code128Values('é')).toThrow();
  });
});
