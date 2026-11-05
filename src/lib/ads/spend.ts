/**
 * "Everything but spend" (the owner, 2026-11-05, of the staff member who also runs the marketing): she sees what the ads
 * reached, clicked and brought in counts (impressions, reach, clicks, CTR, results, followers, engagement) and never what
 * they cost or earned: spend, budgets, cost per result, ROAS, sales value, the account's balance.
 *
 * The browser gets the raw JSON, so hiding a column hides nothing. The routes pass what they return through `stripSpend`
 * for her (`adsJson`), and refuse what would spend or configure (`spendBlocked`, `configBlocked`, `capNewAd`).
 * The marketing-only account (roles.ts isMarketing) is untouched: the owner gave it ads earlier.
 */

import { NextResponse } from 'next/server';
import { spendHidden } from '@/lib/roles';
import type { AdPlan } from './plan';

/** Keys that carry money or a rate of money, as Meta spells them and as shape.ts does. */
const SPEND_KEYS = new Set([
  // Meta's insight rows
  'spend', 'cpm', 'cpc', 'cpp', 'ctr_cost', 'action_values', 'purchase_roas', 'website_purchase_roas', 'cost_per_action_type',
  'cost_per_unique_click', 'cost_per_inline_link_click', 'cost_per_result', 'cost_per_conversion',
  // Metrics (shape.ts) and what is derived from them
  'values', 'roas', 'costPerPurchase', 'costPerResult', 'sales', 'revenue',
  // Budgets, bids and the account's money
  'daily_budget', 'lifetime_budget', 'budget_remaining', 'spend_cap', 'amount_spent', 'balance', 'min_daily_budget',
  'dailyBudget', 'lifetimeBudget', 'budgetRemaining', 'spendCap', 'amountSpent', 'minDailyBudget', 'minDaily', 'budget',
  'bid_amount', 'bidAmount', 'bid_strategy', 'bidding', 'funding', 'funding_source_details',
  // The paid side of Insights (lib/social-insights): spend by platform
  'paid', 'paidSpend',
]);

/** A copy of any JSON-shaped value without the spend keys, at any depth. Arrays and primitives pass through. */
export function stripSpend<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSpend) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SPEND_KEYS.has(k) || k.startsWith('cost_per_')) continue;
      out[k] = stripSpend(v);
    }
    return out as T;
  }
  return value;
}

/** Whether the person `adsGate` let in (its return value) gets no spend. `'counter'` (open access) and owners keep everything. */
export const withoutSpend = (who: string): boolean => who !== 'counter' && spendHidden(who);

/** NextResponse.json, stripped for the caller who may not see spend. */
export function adsJson(who: string, body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(withoutSpend(who) ? stripSpend(body) : body, init);
}

const ownerSets = 'An owner sets the budget and turns it on.';

/** The refusal for a route that would spend, change a budget or switch an ad on, for her; null for everyone else. */
export function spendBlocked(who: string): NextResponse | null {
  return withoutSpend(who) ? NextResponse.json({ error: ownerSets }, { status: 403 }) : null;
}

/** The refusal for a route that configures the ad account (setup, audiences from the customer book, rules, tests, connecting). */
export function configBlocked(who: string): NextResponse | null {
  return withoutSpend(who) ? NextResponse.json({ error: 'Only an owner can change how ads are set up.' }, { status: 403 }) : null;
}

/** The budget a new ad of hers is made with when the account names no smallest one (the New ad page's first chip). */
export const DEFAULT_PAUSED_BUDGET = 500;

/**
 * Her new ad: always saved paused, at the house's smallest daily budget, with no bid control, schedule or end date;
 * an owner sets the real budget and switches it on. Pure, tested.
 */
export function capNewAd<T extends Pick<AdPlan, 'budget' | 'launch' | 'bidding' | 'hours'>>(plan: T, minDaily: number | null): T {
  return {
    ...plan,
    launch: 'paused',
    budget: { kind: 'daily', amount: minDaily && minDaily > 0 ? minDaily : DEFAULT_PAUSED_BUDGET, start: null, end: null },
    bidding: { kind: 'lowest' },
    hours: null,
  };
}
