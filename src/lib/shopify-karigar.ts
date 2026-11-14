/**
 * Every Shopify order's pieces to one karigar (owner, 2026-11-14: "assign all shopify orders to uzair automatically";
 * Uzair is House of Mina's karigar). The house names him in `SHOPIFY_ORDER_KARIGAR` (apphosting.mina.yaml), by name, not
 * id: the karigar book is read when an order comes in, so a re-added karigar or a new id needs no change here.
 *
 * - A new Shopify order (lib/writes/shopify-order.ts `importShopifyAsOrder`) has him on every piece, so it starts
 *   In Progress, as an order whose pieces all have a karigar does.
 * - The open Shopify orders already in the book had their unassigned pieces given to him once (`shopifyKarigarBackfill`,
 *   run by the tick, remembered in `app_settings/shopify_karigar`), never again: a piece moved to someone else later stays.
 * - No such karigar, two of the same name, or the variable unset ("none"): nothing is assigned. Never a guess.
 */

export type KarigarRow = { id: string; name?: string | null; deletedAt?: string | null };

/** The configured name, or '' when the house has none. */
export function shopifyKarigarName(): string {
  const v = (process.env.SHOPIFY_ORDER_KARIGAR || '').trim();
  return /^(none|off|0)$/i.test(v) ? '' : v;
}

const norm = (s: string | null | undefined) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The one live karigar the name means: the same name, else the only one whose first name it is. Null when none or several. */
export function matchKarigar(rows: readonly KarigarRow[], name: string): KarigarRow | null {
  const want = norm(name);
  if (!want) return null;
  const live = rows.filter(r => !r.deletedAt && norm(r.name));
  const exact = live.filter(r => norm(r.name) === want);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const first = live.filter(r => norm(r.name).split(' ')[0] === want);
  return first.length === 1 ? first[0] : null;
}
