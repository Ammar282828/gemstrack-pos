/**
 * Every order and sale names who took it (owner, 2026-11-16: "there should not be any unassigned possibility").
 * Nothing fills the name in for the person (no auto-assign, 2026-11-16), so every screen refuses to save without one
 * and the server refuses a write that arrives without one, whichever app or version sent it.
 *
 * The one exception is an order nobody at the counter took: a Shopify web order or a taheri.shop order, made by the
 * server from the customer's own checkout. Editing one later does not force a name onto it.
 */
export const TAKEN_BY_MISSING = 'Choose who took it (Taken by).';

/** True when the name is blank. Membership of the house's list stays the screens' check: a saved name the list has dropped since is kept. */
export const takenByBlank = (name: unknown): boolean => typeof name !== 'string' || !name.trim();

/** An order the customer placed online, so no one at the counter took it. */
export function placedOnline(o: { id?: string | null; shopifyOrderId?: unknown; shopifyOrderName?: unknown; website?: unknown } | null | undefined): boolean {
  if (!o) return false;
  return !!(o.shopifyOrderName || o.website || (typeof o.id === 'string' && o.id.startsWith('SHOPIFY-')));
}

/** The refusal in words, or null when the record may be saved. */
export function takenByProblem(name: unknown, order?: Parameters<typeof placedOnline>[0]): string | null {
  if (!takenByBlank(name)) return null;
  return placedOnline(order) ? null : TAKEN_BY_MISSING;
}
