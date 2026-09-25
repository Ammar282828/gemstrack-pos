import { describe, it, expect, vi, afterEach } from 'vitest';

const load = async (value?: string) => {
  vi.resetModules();
  if (value === undefined) delete process.env.NEXT_PUBLIC_STORE_EXPENSE_CATEGORIES;
  else process.env.NEXT_PUBLIC_STORE_EXPENSE_CATEGORIES = value;
  return (await import('./expense-categories')).EXPENSE_CATEGORIES;
};

afterEach(() => { delete process.env.NEXT_PUBLIC_STORE_EXPENSE_CATEGORIES; });

describe('EXPENSE_CATEGORIES', () => {
  it("is Taheri's list when nothing is set, partner categories and Other at the end", async () => {
    const list = await load();
    expect(list.slice(0, 3)).toEqual(['Rent', 'Salaries', 'Utilities']);
    expect(list.slice(-3)).toEqual(['Partner Drawings', 'Partner Salary', 'Other']);
  });
  it("is the house's own list when set, and still keeps the names partnership.ts reads", async () => {
    const list = await load('Stock & Karigars, Ad Spend,Other,Partner Salary');
    expect(list).toEqual(['Stock & Karigars', 'Ad Spend', 'Partner Drawings', 'Partner Salary', 'Other']);
  });
  it('an empty value falls back to the default', async () => {
    expect((await load(''))[0]).toBe('Rent');
  });
});
