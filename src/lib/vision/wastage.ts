/**
 * A slip's wastage (kasar) as the percentage the ERP prices with.
 *
 * The shop's estimates write it in grams — "6.500 net wt + 0.650 wastage = 7.150" — and older
 * parchis sometimes as a percent. Either is copied off the paper as written (the scanners never
 * convert it), and turned into a percent here, on the metal the ERP prices: the weight less any
 * stone weight the slip takes off (pricing.ts does the same subtraction). Two decimals, so 0.650
 * on 6.500 is 10, not 10.000000000000002.
 */
export interface WastageLike {
  weightG?: number | null;
  stoneWeightG?: number | null;
  wastageG?: number | null;
  wastagePercent?: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function wastagePercentOf(l: WastageLike): number | null {
  const pct = Number(l.wastagePercent);
  if (pct > 0) return round2(pct);
  const grams = Number(l.wastageG);
  const metal = (Number(l.weightG) || 0) - (Number(l.stoneWeightG) || 0);
  if (grams > 0 && metal > 0) return round2((grams / metal) * 100);
  return null;
}
