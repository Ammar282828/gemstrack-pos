import { describe, expect, it, vi } from 'vitest';

describe('stripSpend', () => {
  it('removes spend, budgets, costs, ROAS and sales at any depth, and keeps reach, clicks and results', async () => {
    const { stripSpend } = await import('./spend');
    const row = {
      impressions: 10, reach: 8, clicks: 2, ctr: 1.5, frequency: 1.2, spend: 900, cpm: 5, cpc: 2, values: { omni_purchase: 5000 },
      actions: { link_click: 2 },
    };
    const out = stripSpend({
      account: { name: 'A', currency: 'PKR', amountSpent: 10, balance: 5, spendCap: 100, minDailyBudget: 300, funding: 'Visa' },
      campaigns: [{ id: '1', dailyBudget: 1000, lifetimeBudget: null, metrics: row, previous: row, adsets: [{ daily_budget: '1', metrics: row }] }],
      paid: { now: [{ platform: 'instagram', metrics: row }] },
      cost_per_action_type: [{ value: '4' }], cost_per_result: 3,
      followers: 1200,
    });
    const text = JSON.stringify(out);
    for (const k of ['spend', 'cpm', 'cpc', 'values', 'amountSpent', 'balance', 'spendCap', 'minDailyBudget', 'funding', 'dailyBudget', 'lifetimeBudget', 'daily_budget', 'paid', 'cost_per_action_type', 'cost_per_result']) {
      expect(text, k).not.toContain(`"${k}"`);
    }
    expect(out.campaigns[0].metrics).toEqual({ impressions: 10, reach: 8, clicks: 2, ctr: 1.5, frequency: 1.2, actions: { link_click: 2 } });
    expect(out.followers).toBe(1200);
    expect(out.account.name).toBe('A');
  });

  it('does not touch what it was given', async () => {
    const { stripSpend } = await import('./spend');
    const input = { spend: 1, reach: 2 };
    stripSpend(input);
    expect(input).toEqual({ spend: 1, reach: 2 });
  });
});

describe('who gets no spend', () => {
  it('is only the staff member also on the marketing list', async () => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_STORE_OWNER_EMAILS', 'owner@example.com');
    vi.stubEnv('NEXT_PUBLIC_STORE_STAFF_EMAILS', 'both@example.com');
    vi.stubEnv('NEXT_PUBLIC_STORE_MARKETING_EMAILS', 'ads@example.com,both@example.com');
    const { withoutSpend, adsJson, spendBlocked, configBlocked } = await import('./spend');
    expect(withoutSpend('both@example.com')).toBe(true);
    expect(withoutSpend('ads@example.com')).toBe(false);
    expect(withoutSpend('owner@example.com')).toBe(false);
    expect(withoutSpend('counter')).toBe(false);
    expect(await adsJson('both@example.com', { spend: 1, reach: 2 }).json()).toEqual({ reach: 2 });
    expect(await adsJson('ads@example.com', { spend: 1, reach: 2 }).json()).toEqual({ spend: 1, reach: 2 });
    expect(spendBlocked('both@example.com')?.status).toBe(403);
    expect(spendBlocked('ads@example.com')).toBeNull();
    expect(configBlocked('both@example.com')?.status).toBe(403);
    expect(configBlocked('owner@example.com')).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('capNewAd', () => {
  it('saves her ad paused at the smallest budget, with no bid control, hours or dates', async () => {
    const { capNewAd, DEFAULT_PAUSED_BUDGET } = await import('./spend');
    const plan = {
      budget: { kind: 'total' as const, amount: 90000, start: '2026-11-06T00:00:00Z', end: '2026-12-01T00:00:00Z' },
      launch: 'live' as const, bidding: { kind: 'cost_cap' as const, amount: 5 }, hours: { days: [1], from: 60, to: 120 },
    };
    expect(capNewAd(plan, 300)).toEqual({ budget: { kind: 'daily', amount: 300, start: null, end: null }, launch: 'paused', bidding: { kind: 'lowest' }, hours: null });
    expect(capNewAd(plan, null).budget.amount).toBe(DEFAULT_PAUSED_BUDGET);
    expect(plan.launch).toBe('live');
  });
});
