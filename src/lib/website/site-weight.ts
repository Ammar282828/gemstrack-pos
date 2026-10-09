/**
 * A weight typed on a Posts card (src/app/posts/piece-card.tsx) that the website should keep: taheri.shop's own
 * photographs only (the counter's weights, /api/website/pieces), and only where the site has none. A weight already on
 * the site is never changed from a post: a post's weight differing from it is more likely a slip than a correction
 * (Website → Weights changes it). The catalogue's pieces (House of Mina) and new uploads not yet on the site's list
 * take no weight this way. 2026-10-09, owner: "if I add the weight to it, does it automatically also add the weight to
 * that image on the website?" — until then it didn't.
 */

/** A weight as typed ("3.84", "12") — a positive number, or nothing. */
export const validWeight = (w: string) => /^\d+(\.\d+)?$/.test(w.trim()) && Number(w) > 0;

export function weightForSite(
  p: { source?: 'attributes' | 'pieces'; drop?: boolean; weightGrams: number | null },
  typed: string,
): number | null {
  if (p.source !== 'attributes' || p.drop || p.weightGrams) return null;
  return validWeight(typed) ? Math.round(Number(typed) * 100) / 100 : null;
}
