/**
 * Whole-rupee money: every rule, as pure functions, in this one module (owner, 2026-10-17: "there
 * should be no decimals"; "offer discount options to round the bill for any amount under 5000").
 * The iPhone and Android apps port it line for line (docs/in-progress.md); the web, the server's
 * /api/app/write ops and the shared writes (lib/writes/*) all call into it.
 *
 * ROUNDING RULE. A money amount is rounded with Math.round (half up: x.5 goes to x+1; -0 is 0) at the
 * moment it is computed, never after summing:
 *   - a piece's lines (metal = weight x rate, wastage = rounded metal x %, making, diamonds, stones,
 *     misc) are each rounded, and the piece's total is the SUM of its rounded lines (lib/pricing.ts);
 *   - a fixed price is rounded;
 *   - the subtotal is the sum of the rounded piece totals; there is no per-line discount;
 *   - the bill's discount, the exchange values, each payment/advance/refund are rounded integers;
 *   - grand total = subtotal - discount - exchange; balance = grand total - paid. All integers.
 * Weights (g), rates per gram and percentages keep their decimals; only money amounts are integers.
 * Settled: a balance under 1 rupee either way (|b| < 1) is paid, so old bills with paise are not debts.
 *
 * ROUND-OFF OFFERS. From total T (after any discount already typed), round DOWN to the nearest
 * 100, 500, 1,000, 5,000, 10,000: target = floor(T/step)*step, extra = T - target. Keep target > 0 and
 * 0 < extra < 5,000, drop duplicate targets, order by extra ascending, give at most 3.
 * SETTLE: after a payment, a remainder R with 0 < R < 5,000 may be given off by adding R to the discount.
 */

// Every money amount is an integer: worked out once, rounded where it is computed (a line's total,
// a discount, a payment), so the sums of rounded lines are what is printed. Weights, rates per gram
// and percentages keep their decimals.

/** A money amount as whole rupees (halves up; never -0; anything unreadable is 0). */
export function rupees(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? v + 0 : 0;
}

/** What a typed amount means: digits only, so "12,500.75" and "12500.75" both read 12501. */
export const wholeRupeesFromText = (s: string): number => rupees(String(s ?? '').replace(/,/g, ''));

/** Under one rupee either way is settled: a balance left from before money was whole rupees is not a debt. */
export const SETTLED_UNDER = 1;
export const isSettled = (balanceDue: unknown): boolean => Math.abs(Number(balanceDue) || 0) < SETTLED_UNDER;
export const owesMoney = (balanceDue: unknown): boolean => (Number(balanceDue) || 0) >= SETTLED_UNDER;
export const isCredit = (balanceDue: unknown): boolean => (Number(balanceDue) || 0) <= -SETTLED_UNDER;

/** 297,000 — grouped, never a decimal. */
export const rupeeText = (n: unknown): string => rupees(n).toLocaleString('en-US');

/** PKR 297,000 — the one way a bill, a message or a list shows money. */
export const pkr = (n: unknown): string => `PKR ${rupeeText(n)}`;

/** Those of `obj`'s money fields that are present, as whole rupees (to spread over a document being written). */
export function rupeesIn<K extends string>(obj: Partial<Record<K, unknown>>, keys: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') out[k] = rupees(obj[k]);
  return out;
}

/** A piece's total from its lines: each line rounded, then summed (the printed bill adds up). */
export const lineTotal = (lines: readonly unknown[]): number => lines.reduce<number>((s, l) => s + rupees(l), 0);
/** A bill's subtotal: the sum of its pieces' (already rounded) totals. */
export const totalOfLines = (totals: readonly unknown[]): number => lineTotal(totals);

/** The round numbers a bill is rounded down to. */
export const ROUND_OFF_STEPS = [100, 500, 1_000, 5_000, 10_000] as const;
/** An extra discount must be under this to be offered (and a leftover under it can be settled). */
export const ROUND_OFF_LIMIT = 5_000;
/** At most this many chips are shown. */
export const ROUND_OFF_MAX_OFFERS = 3;

export interface RoundOffOffer {
  /** The bill's whole discount once taken: the one already typed plus `extra`. */
  discount?: number;
  /** What the bill comes to once taken. */
  target: number;
  /** The extra discount that gets it there (> 0, < ROUND_OFF_LIMIT). */
  extra: number;
}

/**
 * The offers for a bill that comes to `total` (subtotal less the discount typed so far and the
 * exchange, before any round-off): round down to the nearest 100, 500, 1,000, 5,000 and 10,000,
 * keep those whose extra discount is more than 0 and under 5,000, drop duplicates, and give the
 * three that cost the least (smallest extra first). Nothing when the total is already round, is
 * under 100 (rounding down would be free), or no step qualifies.
 */
export function roundOffOffers(total: number, existingDiscount = 0): RoundOffOffer[] {
  const t = rupees(total) - rupees(existingDiscount);
  if (!(t > 0)) return [];
  const byTarget = new Map<number, RoundOffOffer>();
  for (const step of ROUND_OFF_STEPS) {
    const target = Math.floor(t / step) * step;
    const extra = t - target;
    if (target > 0 && extra > 0 && extra < ROUND_OFF_LIMIT && !byTarget.has(target)) byTarget.set(target, { target, extra, discount: rupees(existingDiscount) + extra });
  }
  return [...byTarget.values()].sort((a, b) => a.extra - b.extra).slice(0, ROUND_OFF_MAX_OFFERS);
}

/** The discount once an offer is taken: whatever was already typed, plus the extra. */
export const discountWithOffer = (discount: number, offer: RoundOffOffer): number => rupees(discount) + offer.extra;

/**
 * What is left to pay after a payment, when it is small enough to give away: the leftover (> 0, under
 * 5,000) as an extra discount, so the balance becomes 0 without a payment that was never made.
 * Null for a balance that is settled, overpaid (negative), or 5,000 and over.
 */
export function settleRemainderOffer(remaining: number): number | null {
  const r = rupees(remaining);
  return r > 0 && r < ROUND_OFF_LIMIT ? r : null;
}

/** "Round to 270,000 · −2,340" */
export const roundOffLabel = (o: RoundOffOffer): string =>
  `Round to ${o.target.toLocaleString('en-US')} · −${o.extra.toLocaleString('en-US')}`;
