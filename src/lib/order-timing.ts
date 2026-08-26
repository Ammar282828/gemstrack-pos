/**
 * When an order is due, and whether it is late.
 *
 * Overdue used to mean `daysSince(createdAt) >= 7` — a fixed age, the same for
 * every order regardless of what was actually promised. A piece promised in
 * three weeks was flagged on day seven, and one promised in three days was not
 * flagged until day seven, by which point the customer had already rung. The
 * alert was noise in both directions.
 *
 * The rule now keys off the promised date. Orders taken before that field
 * existed keep the old age rule, so nothing silently stops being reported.
 */

import { differenceInCalendarDays, startOfDay, parseISO, isValid } from 'date-fns';
import type { Order, OrderStatus } from '@/lib/store';

/** Statuses still waiting on the bench. Cancelled and Refunded are finished. */
const ACTIVE: OrderStatus[] = ['Pending', 'In Progress'];

export const isActiveOrder = (o: Pick<Order, 'status'>) => ACTIVE.includes(o.status);

/** How long an order with no promised date may sit before it is called late. */
export const LEGACY_OVERDUE_DAYS = 7;

export type PromiseState =
  | 'none'      // no promised date, and not old enough for the fallback to fire
  | 'upcoming'  // promised, still ahead
  | 'today'     // promised for today
  | 'late';     // past its promise, or past the fallback age

export interface OrderTiming {
  /** Start of the promised day, or null when the order never had one. */
  due: Date | null;
  /** Negative before the promise, 0 on the day, positive after. */
  daysLate: number;
  state: PromiseState;
  /** True when `state` came from the age fallback rather than a real promise. */
  estimated: boolean;
}

const day = (iso: string | undefined): Date | null => {
  if (!iso) return null;
  const d = parseISO(iso);
  return isValid(d) ? startOfDay(d) : null;
};

/**
 * `now` is passed in rather than read from the clock so callers can group a
 * whole list against one instant, and so this is testable.
 */
export function orderTiming(order: Pick<Order, 'promisedDate' | 'createdAt' | 'status'>, now: Date): OrderTiming {
  const today = startOfDay(now);
  const due = day(order.promisedDate);

  if (due) {
    const daysLate = differenceInCalendarDays(today, due);
    return {
      due,
      daysLate,
      state: daysLate > 0 ? 'late' : daysLate === 0 ? 'today' : 'upcoming',
      estimated: false,
    };
  }

  // No promise on record. Fall back to the age rule so orders taken before
  // this field existed are still surfaced.
  const created = day(order.createdAt);
  const age = created ? differenceInCalendarDays(today, created) : 0;
  return {
    due: null,
    daysLate: age - LEGACY_OVERDUE_DAYS,
    state: age >= LEGACY_OVERDUE_DAYS ? 'late' : 'none',
    estimated: true,
  };
}

/** Active orders that are late, worst first. */
export function lateOrders<T extends Pick<Order, 'promisedDate' | 'createdAt' | 'status'>>(
  orders: T[],
  now: Date,
): { order: T; timing: OrderTiming }[] {
  return orders
    .filter(isActiveOrder)
    .map(order => ({ order, timing: orderTiming(order, now) }))
    .filter(x => x.timing.state === 'late')
    .sort((a, b) => b.timing.daysLate - a.timing.daysLate);
}

/** Active orders promised within the next `days`, soonest first. */
export function dueSoon<T extends Pick<Order, 'promisedDate' | 'createdAt' | 'status'>>(
  orders: T[],
  now: Date,
  days = 7,
): { order: T; timing: OrderTiming }[] {
  return orders
    .filter(isActiveOrder)
    .map(order => ({ order, timing: orderTiming(order, now) }))
    .filter(x => x.timing.due !== null && x.timing.daysLate <= 0 && -x.timing.daysLate <= days)
    .sort((a, b) => b.timing.daysLate - a.timing.daysLate);
}

/** "3 days late" / "due today" / "in 5 days". */
export function timingLabel(t: OrderTiming): string {
  if (t.state === 'today') return 'due today';
  if (t.state === 'late') {
    const n = t.due ? t.daysLate : t.daysLate + LEGACY_OVERDUE_DAYS;
    const noun = t.due ? 'late' : 'old';
    return `${n} day${n === 1 ? '' : 's'} ${noun}`;
  }
  if (t.state === 'upcoming') {
    const n = -t.daysLate;
    return `in ${n} day${n === 1 ? '' : 's'}`;
  }
  return '';
}
