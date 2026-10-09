/**
 * Settings → Recently removed: how much history each removed customer or karigar still carries
 * (src/app/settings/recently-removed/page.tsx works it out the same way, line for line). Here so the
 * iPhone app's port (ERPCore RecentlyRemoved) has one copy to follow and its cases to pass.
 *
 * This is the number that makes "Empty" a considered act rather than a reflex — a name with 40 ledger
 * entries behind it is not a stray duplicate somebody added twice.
 */

export interface RemovedHistory { entries: number; orders: number }

/** Ledger entries per person (`entityId`) and orders per customer (`customerId`). */
export function removedHistory(
  hisaabEntries: { entityId?: string }[],
  orders: { customerId?: string }[],
): Map<string, RemovedHistory> {
  const counts = new Map<string, RemovedHistory>();
  const bump = (id: string | undefined, key: 'entries' | 'orders') => {
    if (!id) return;
    const cur = counts.get(id) ?? { entries: 0, orders: 0 };
    cur[key] += 1;
    counts.set(id, cur);
  };
  for (const e of hisaabEntries) bump(e.entityId, 'entries');
  for (const o of orders) bump(o.customerId, 'orders');
  return counts;
}

/** "3 ledger entries · 1 order"; "" when there is none. */
export function carriesText(history: RemovedHistory | undefined): string {
  return [
    history?.entries ? `${history.entries} ledger entr${history.entries === 1 ? 'y' : 'ies'}` : null,
    history?.orders ? `${history.orders} order${history.orders === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
}

/** What emptying the list takes with it: every removed person's entries, and the removed customers' orders. */
export function removedTotals(
  customerIds: string[], karigarIds: string[], history: Map<string, RemovedHistory>,
): { entries: number; orders: number } {
  const entries = [...customerIds, ...karigarIds].reduce((sum, id) => sum + (history.get(id)?.entries ?? 0), 0);
  const orders = customerIds.reduce((sum, id) => sum + (history.get(id)?.orders ?? 0), 0);
  return { entries, orders };
}
