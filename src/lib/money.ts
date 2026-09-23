/**
 * Money the way the shop says it: lac and crore, not thousands and millions.
 *
 * Below a lac a figure stays exact (85,000). From a lac it reads as lacs
 * (4.5 lac, 12.35 lac) and from a crore as crores (1.25 crore), to two
 * decimals — the precision anyone reading a total at a glance uses. Exact
 * rupees live on the invoices; these are for reading a period at a glance.
 */

const LAC = 1e5;
const CRORE = 1e7;

const trimmed = (n: number, digits: number) =>
  Number(n.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits });

/** 85,000 · 4.5 lac · 1.25 crore — no currency. */
export function lacCrore(n: number, digits = 2): string {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  // The unit is chosen after rounding, so 99,99,999 reads "1 crore", not "100 lac".
  const round = (x: number) => Number(x.toFixed(digits));
  if (a >= CRORE || round(a / LAC) >= 100) return `${sign}${trimmed(a / CRORE, digits)} crore`;
  if (a >= LAC || Math.round(a) >= LAC) return `${sign}${trimmed(a / LAC, digits)} lac`;
  return `${sign}${Math.round(a).toLocaleString('en-US')}`;
}

/** PKR 85,000 · PKR 4.5 lac · PKR 1.25 crore. */
export const pkrLac = (n: number, digits = 2): string => `PKR ${lacCrore(n, digits)}`;

/** Chart axis ticks, where there is no room for words: 50k · 2.5L · 1.2Cr. */
export function axisLac(n: number): string {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= CRORE || Number((a / LAC).toFixed(1)) >= 100) return `${sign}${trimmed(a / CRORE, 1)}Cr`;
  if (a >= LAC || Math.round(a / 1000) >= 100) return `${sign}${trimmed(a / LAC, 1)}L`;
  if (a >= 1000) return `${sign}${Math.round(a / 1000)}k`;
  return `${sign}${Math.round(a)}`;
}
