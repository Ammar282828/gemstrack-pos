/**
 * Weight, the way a Karachi jeweller talks about it.
 *
 * Everything is stored in grams. Tola is how it is quoted, remembered and argued
 * about at the counter, so anything that reports gold reports both. 11.664 g per
 * tola is the figure the trade uses here -- the vision and voice code carried the
 * five-decimal 11.6638 for parsing old slips, and both now read from this one
 * constant so the app cannot disagree with itself by a hundredth.
 */

export const GRAMS_PER_TOLA = 11.664;

export const toTola = (grams: number): number => (Number(grams) || 0) / GRAMS_PER_TOLA;

/** "12.50 g · 1.072 tola" — grams first because that is what was weighed. */
export function formatWeight(grams: number, opts: { tolaDigits?: number; gramDigits?: number } = {}): string {
  const g = Number(grams) || 0;
  const { tolaDigits = 3, gramDigits = 2 } = opts;
  return `${g.toLocaleString(undefined, { maximumFractionDigits: gramDigits })} g · ${toTola(g).toLocaleString(undefined, { maximumFractionDigits: tolaDigits })} tola`;
}
