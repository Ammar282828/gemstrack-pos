/**
 * The website's new arrivals, as Posts → From the website opens on them.
 *
 * The site's own New Arrivals shelf when it publishes one (the Mina catalogue
 * marks each piece `newArrival`, by its own 60-day rule); otherwise everything
 * added in the last 30 days (taheri.shop's `added`, the clock its New Arrivals
 * and "Newest" sort run on) — and never fewer than the newest 24, so the shelf
 * is never empty after a quiet month.
 */

export const NEW_DAYS = 30;
export const NEW_AT_LEAST = 24;

export interface Dated { id: string; added: number | null; newArrival?: boolean; collection: string; name: string }

export function newArrivalIds(pieces: Dated[], now = Date.now()): Set<string> {
  if (pieces.some(p => p.newArrival)) return new Set(pieces.filter(p => p.newArrival).map(p => p.id));
  const dated = pieces.filter(p => p.added).sort((a, b) => b.added! - a.added!);
  const cutoff = now - NEW_DAYS * 86_400_000;
  const recent = dated.filter(p => p.added! >= cutoff);
  return new Set((recent.length >= NEW_AT_LEAST ? recent : dated.slice(0, NEW_AT_LEAST)).map(p => p.id));
}

/** Newest first; the undated after, by collection and name. */
export const byNewest = (a: Dated, b: Dated) =>
  (b.added ?? 0) - (a.added ?? 0) || a.collection.localeCompare(b.collection) || a.name.localeCompare(b.name, undefined, { numeric: true });
