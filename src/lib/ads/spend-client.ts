/**
 * The browser's half of "no spend" (lib/ads/spend.ts strips the numbers on the server): the pages read `metrics.spend`,
 * `cpm`, `values` and the account's money as numbers, so what the server left out is put back as zero to keep them from
 * breaking, and the pages hide every place those zeros would show (`useSpendHidden`). Nothing here is shown as a figure.
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A copy where every Metrics-shaped object has its money fields as 0 and every account its balances as 0. */
export function zeroSpend<T>(value: T): T {
  if (Array.isArray(value)) return value.map(zeroSpend) as unknown as T;
  if (!isObj(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = zeroSpend(v);
  if ('impressions' in out && 'actions' in out) {
    out.spend ??= 0; out.cpm ??= 0; out.cpc ??= 0; out.values ??= {};
  }
  if ('currency' in out && 'timezone' in out && 'status' in out) {
    out.amountSpent ??= 0; out.balance ??= 0; out.spendCap ??= null; out.minDailyBudget ??= null; out.funding ??= null;
  }
  if ('adsets' in out) { out.dailyBudget ??= null; out.lifetimeBudget ??= null; }
  if ('ads' in out && 'optimizationGoal' in out) { out.dailyBudget ??= null; out.lifetimeBudget ??= null; }
  return out as T;
}
