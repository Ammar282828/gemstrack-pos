import { describe, expect, it } from 'vitest';
import { netMarginPercent, netProfit } from './net-profit';

describe('net profit', () => {
  it('is the estimated profit less expenses, not revenue less expenses', () => {
    // Revenue 5.51 crore, estimated profit 55.23 lac, no expenses: 10% margin, never 100%.
    const revenue = 55_100_000;
    const est = 5_523_000;
    expect(netProfit(est, 0)).toBe(est);
    expect(netMarginPercent(netProfit(est, 0), revenue)).toBeCloseTo(10.0, 1);
  });
  it('takes the expenses off the estimate and can go negative', () => {
    expect(netProfit(100_000, 30_000)).toBe(70_000);
    expect(netProfit(100_000, 150_000)).toBe(-50_000);
  });
  it('has no margin without revenue', () => {
    expect(netMarginPercent(-5_000, 0)).toBe(0);
  });
});
