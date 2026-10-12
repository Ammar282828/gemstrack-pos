/**
 * The Orders hub's "Due" view: the open orders by how soon they were promised.
 * A port of the app's OrdersLogic.dueBucket / dueGroups (apps/iphone/App/Screens/Orders): same
 * buckets, same thresholds, same order. Pure, so the page and its tests read one rule.
 */

import { parseISO } from 'date-fns';
import { orderTiming, URGENT_WINDOW_DAYS, type OrderTiming } from '@/lib/order-timing';
import type { Order } from '@/lib/store';

/** The Due view's sections, in the order they are chased (the app's OrdersDueBucket). */
export const DUE_BUCKETS = [
  { key: 'late', title: 'Late', hint: 'past the day promised' },
  { key: 'today', title: 'Today', hint: 'promised for today' },
  { key: 'week', title: 'This week', hint: `in the next ${URGENT_WINDOW_DAYS} days: start them now` },
  { key: 'later', title: 'Later', hint: 'more than a week away' },
  { key: 'undated', title: 'No date', hint: 'no day promised: oldest first' },
] as const;
export type DueBucket = typeof DUE_BUCKETS[number]['key'];

/** An order with no day promised is undated here, whatever the age rule calls it (the app's dueBucket). */
export function dueBucketOf(t: OrderTiming): DueBucket {
  if (!t.due) return 'undated';
  if (t.state === 'late') return 'late';
  if (t.state === 'today') return 'today';
  if (t.state === 'upcoming') return -t.daysLate <= URGENT_WINDOW_DAYS ? 'week' : 'later';
  return 'undated';
}

/** Still to be handed over: not invoiced, not cancelled or refunded (the app's isOpen). */
export const isOpenOrder = (o: Pick<Order, 'invoiceId' | 'status'>) =>
  !o.invoiceId && o.status !== 'Cancelled' && o.status !== 'Refunded';

type Dueable = Pick<Order, 'id' | 'promisedDate' | 'createdAt' | 'status' | 'invoiceId'>;

/**
 * The open orders in their buckets (empty buckets left out). In each, the soonest promise first (so the
 * latest of the late), and the undated oldest first, as they have waited longest; ties by when the order
 * was taken, then by id (the app's dueGroups).
 */
export function dueGroups<T extends Dueable>(orders: readonly T[], now: Date): { bucket: DueBucket; orders: T[] }[] {
  const members = new Map<DueBucket, { order: T; due: number | null; taken: number }[]>();
  for (const o of orders) {
    if (!isOpenOrder(o)) continue;
    const t = orderTiming(o, now);
    const b = dueBucketOf(t);
    const taken = o.createdAt ? parseISO(o.createdAt).getTime() : 0;
    const list = members.get(b) ?? [];
    list.push({ order: o, due: t.due ? t.due.getTime() : null, taken: Number.isNaN(taken) ? 0 : taken });
    members.set(b, list);
  }
  const out: { bucket: DueBucket; orders: T[] }[] = [];
  for (const b of DUE_BUCKETS) {
    const rows = members.get(b.key);
    if (!rows?.length) continue;
    rows.sort((x, y) =>
      (x.due != null && y.due != null && x.due !== y.due) ? x.due - y.due
        : x.taken !== y.taken ? x.taken - y.taken
        : x.order.id < y.order.id ? -1 : x.order.id > y.order.id ? 1 : 0);
    out.push({ bucket: b.key, orders: rows.map(r => r.order) });
  }
  return out;
}
