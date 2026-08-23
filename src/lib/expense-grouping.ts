/**
 * The two date graduations the expenses page reads money at.
 *
 * `periodRange` is how far back you are looking; `bucketOf` is how coarsely
 * the rows inside that span are grouped. They are separate on purpose — "this
 * year, by month" and "this month, by day" are both things you want.
 */

import {
  endOfDay, startOfDay, startOfWeek, startOfMonth, isSameDay,
  isSameWeek, isSameMonth, subDays, subMonths, startOfYear, format,
} from 'date-fns';
import type { DateRange } from 'react-day-picker';

export const PERIODS = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: 'last-30', label: 'Last 30 days' },
  { id: 'this-year', label: 'This year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom range' },
] as const;
export type PeriodId = typeof PERIODS[number]['id'];

export const GRADUATIONS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
] as const;
export type Graduation = typeof GRADUATIONS[number]['id'];

/** `null` means no bound at all — every expense qualifies. */
export function periodRange(id: PeriodId, custom?: DateRange, now: Date = new Date()): { start: Date; end: Date } | null {
  switch (id) {
    case 'this-month': return { start: startOfMonth(now), end: endOfDay(now) };
    case 'last-month': {
      const prev = subMonths(now, 1);
      return { start: startOfMonth(prev), end: endOfDay(subDays(startOfMonth(now), 1)) };
    }
    case 'last-30': return { start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
    case 'this-year': return { start: startOfYear(now), end: endOfDay(now) };
    case 'custom':
      return custom?.from ? { start: custom.from, end: endOfDay(custom.to || now) } : null;
    default: return null;
  }
}

export function bucketOf(date: Date, by: Graduation, now: Date = new Date()): { key: string; label: string; sub: string } {
  if (by === 'month') {
    const s = startOfMonth(date);
    return { key: `m${s.getTime()}`, label: format(s, 'MMMM yyyy'), sub: isSameMonth(s, now) ? 'This month' : '' };
  }
  if (by === 'week') {
    const s = startOfWeek(date, { weekStartsOn: 1 });
    return {
      key: `w${s.getTime()}`,
      label: `Week of ${format(s, 'd MMM')}`,
      sub: isSameWeek(s, now, { weekStartsOn: 1 }) ? 'This week' : format(s, 'yyyy'),
    };
  }
  const s = startOfDay(date);
  // Compared against the passed-in `now` rather than date-fns' isToday, which
  // reads the real clock and would ignore the argument.
  const today = isSameDay(s, now);
  const yesterday = isSameDay(s, subDays(startOfDay(now), 1));
  // Naming the last two days beats reading a date back off the row.
  const label = today ? 'Today' : yesterday ? 'Yesterday' : format(s, 'EEEE d MMM');
  return {
    key: `d${s.getTime()}`,
    label,
    sub: today || yesterday ? format(s, 'd MMM yyyy') : format(s, 'yyyy'),
  };
}
