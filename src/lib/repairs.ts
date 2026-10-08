/**
 * A repair ticket's words and sums (the ticket itself: store.ts `Repair`). Here, not in the store,
 * because the server writes repairs too (lib/writes/repairs.ts, for the iPhone app).
 */

import type { Repair } from '@/lib/store';

export const REPAIR_STATUSES = ['received', 'ready', 'collected', 'cancelled'] as const;
export type RepairStatus = typeof REPAIR_STATUSES[number];
export const REPAIR_STATUS_LABELS: Record<RepairStatus, string> = {
  received: 'In the shop',
  ready: 'Ready',
  collected: 'Collected',
  cancelled: 'Cancelled',
};

export const repairTotal = (r: Pick<Repair, 'pieces'>): number =>
  (r.pieces || []).reduce((s, p) => s + (Number(p.price) || 0), 0);
export const repairPaid = (r: Pick<Repair, 'payments'>): number =>
  (r.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
/** What the customer still owes on the ticket. */
export const repairBalance = (r: Pick<Repair, 'pieces' | 'payments'>): number =>
  Math.max(0, Math.round((repairTotal(r) - repairPaid(r)) * 100) / 100);
/** "Gold ring" or "Gold ring + 2 more" — a ticket in a line. */
export const repairSummary = (r: Pick<Repair, 'pieces'>): string => {
  const ps = (r.pieces || []).filter((p) => p.item);
  if (!ps.length) return 'Repair';
  return ps.length === 1 ? ps[0].item : `${ps[0].item} + ${ps.length - 1} more`;
};
