import { describe, expect, it, vi } from 'vitest';

// House of Mina's setting (apphosting.mina.yaml), set before the modules read it.
vi.stubEnv('NEXT_PUBLIC_STORE_GOODS_EXPENSE_CATEGORIES', 'Stock & Karigars,Custom Orders,Stones & Pearls,Plating & Finishing');
const { isRunningCost, netProfit, profitBeforeRunning } = await import('./net-profit');

describe('net profit takes off the running costs only', () => {
  it("leaves out the goods the margin allows for, and the partners' drawings", () => {
    expect(isRunningCost({ category: 'Rent' })).toBe(true);
    expect(isRunningCost({ category: 'Ad Spend' })).toBe(true);
    expect(isRunningCost({ category: 'Stock & Karigars' })).toBe(false);
    expect(isRunningCost({ category: ' plating & finishing ' })).toBe(false);
    expect(isRunningCost({ category: 'Partner Drawings' })).toBe(false);
    expect(isRunningCost({ category: undefined })).toBe(true);
  });
  it("Mina's month: the goods are not counted twice", () => {
    // Revenue 1.84 crore at 40% → 73.6 lac estimated; 1.89 crore paid out, of which most was stock and karigars.
    const expenses = [
      { category: 'Stock & Karigars', amount: 14_000_000 },
      { category: 'Rent', amount: 600_000 },
      { category: 'Salaries', amount: 1_200_000 },
      { category: 'Partner Drawings', amount: 3_100_000 },
    ];
    const running = expenses.filter(isRunningCost).reduce((t, e) => t + e.amount, 0);
    expect(running).toBe(1_800_000);
    expect(netProfit(7_360_000, running)).toBe(5_560_000);
  });
});

describe('profitBeforeRunning', () => {
  it('takes the recorded goods off the revenue where a house records them (Mina, 2026-11-01)', () => {
    const gross = profitBeforeRunning({ estimated: 7_352_000, revenue: 18_400_000, goods: 15_500_000 }, true);
    expect(gross).toBe(2_900_000);
    expect(netProfit(gross, 3_356_000)).toBe(-456_000);
  });
  it('keeps the estimate where a house records no goods (Taheri)', () => {
    expect(profitBeforeRunning({ estimated: 5_500_000, revenue: 55_000_000, goods: 0 }, false)).toBe(5_500_000);
  });
});
