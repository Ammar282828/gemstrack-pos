/**
 * Birthdays and anniversaries coming up.
 *
 * A jeweller's whole trade is knowing a date before the customer's husband does. The book
 * already holds these dates; this is what makes them arrive in time to be worth anything.
 *
 * The window is deliberately a fortnight ahead and two days behind. Ahead, because a piece
 * may need making; behind, because a date noticed the morning after is still worth a
 * message, and hiding it at midnight is how it gets missed entirely.
 */

import type { Customer } from '@/lib/store';

export const DAYS_AHEAD = 14;
export const DAYS_BEHIND = 2;

export interface Occasion {
  customerId: string;
  customerName: string;
  kind: 'birthday' | 'anniversary';
  /** Days from today. Negative means it has just passed. */
  inDays: number;
}

/**
 * How many days until this month-and-day next comes round.
 *
 * The stored year is ignored on purpose — a birthday recurs, and comparing full dates makes
 * every one of them permanently in the past. A date already gone this year is measured
 * against next year's, so December dates do not read as 300 days overdue in January.
 */
export function daysUntilAnniversaryOf(iso: string, today: Date): number | null {
  const m = iso.match(/(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, month, day] = m;
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const thisYear = new Date(today.getFullYear(), Number(month) - 1, Number(day));
  const diff = Math.round((thisYear.getTime() - midnight.getTime()) / 86_400_000);
  if (diff >= -DAYS_BEHIND) return diff;
  const nextYear = new Date(today.getFullYear() + 1, Number(month) - 1, Number(day));
  return Math.round((nextYear.getTime() - midnight.getTime()) / 86_400_000);
}

export function upcomingOccasions(customers: Customer[], today: Date = new Date()): Occasion[] {
  const found: Occasion[] = [];
  for (const c of customers) {
    for (const [kind, date] of [
      ['birthday', c.birthday],
      ['anniversary', c.anniversary],
    ] as const) {
      if (!date) continue;
      const inDays = daysUntilAnniversaryOf(date, today);
      if (inDays === null || inDays > DAYS_AHEAD || inDays < -DAYS_BEHIND) continue;
      found.push({ customerId: c.id, customerName: c.name, kind, inDays });
    }
  }
  return found.sort((a, b) => a.inDays - b.inDays);
}

export const occasionWhen = (inDays: number): string =>
  inDays === 0 ? 'today'
    : inDays === 1 ? 'tomorrow'
    : inDays < 0 ? `${Math.abs(inDays)} day${Math.abs(inDays) === 1 ? '' : 's'} ago`
    : `in ${inDays} days`;
