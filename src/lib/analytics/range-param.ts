/**
 * Analytics' date range, kept in the address (`?range=last-90`, or `?range=custom&from=…&to=…`)
 * so it carries across Overview, Sales, Products, Customers and Categories and survives a reload
 * (the audit of 2026-10-01: the sub-pages each reset to the last 30 days).
 *
 * A rolling range (last 30/90 days, this year) is worked out from `now` every time it is read, so a
 * page left open past midnight moves with the day instead of keeping yesterday's end.
 */

import { endOfYear, format, isValid, parseISO, startOfYear, subDays } from 'date-fns';

export interface Range { from: Date; to: Date }
export const QUICK_RANGES = [
  { key: 'last-30', label: 'Last 30 days', short: '30d' },
  { key: 'last-90', label: 'Last 90 days', short: '90d' },
  { key: 'this-year', label: 'This year', short: 'This yr' },
  { key: 'last-year', label: 'Last year', short: 'Last yr' },
  { key: 'all-time', label: 'All time', short: 'All' },
] as const;

export const DEFAULT_RANGE_KEY = 'last-30';

/** The range a key names, as of `now`; `undefined` for all time. */
export function rangeFor(key: string, now: Date, custom?: { from?: string | null; to?: string | null }): Range | undefined {
  switch (key) {
    case 'last-30': return { from: subDays(now, 29), to: now };
    case 'last-90': return { from: subDays(now, 89), to: now };
    case 'this-year': return { from: startOfYear(now), to: now };
    case 'last-year': { const y = new Date(now.getFullYear() - 1, 0, 1); return { from: startOfYear(y), to: endOfYear(y) }; }
    case 'all-time': return undefined;
  }
  const year = /^year-(\d{4})$/.exec(key);
  if (year) { const y = new Date(+year[1], 0, 1); return { from: startOfYear(y), to: endOfYear(y) }; }
  if (key === 'custom') {
    const from = custom?.from ? parseISO(custom.from) : null;
    const to = custom?.to ? parseISO(custom.to) : null;
    if (from && isValid(from)) return { from, to: to && isValid(to) ? to : from };
  }
  return rangeFor(DEFAULT_RANGE_KEY, now);
}

/** Read the address: the key and its range. An unknown or broken key falls back to the last 30 days. */
export function readRange(params: URLSearchParams, now = new Date()): { key: string; range: Range | undefined } {
  const raw = params.get('range') || DEFAULT_RANGE_KEY;
  const known = QUICK_RANGES.some(q => q.key === raw) || /^year-\d{4}$/.test(raw)
    || (raw === 'custom' && !!params.get('from') && isValid(parseISO(params.get('from')!)));
  const key = known ? raw : DEFAULT_RANGE_KEY;
  return { key, range: rangeFor(key, now, { from: params.get('from'), to: params.get('to') }) };
}

/** The query for a choice. The default is no query at all, so a plain /analytics is the last 30 days. */
export function rangeQuery(key: string, custom?: { from?: Date; to?: Date }): string {
  if (key === DEFAULT_RANGE_KEY) return '';
  const q = new URLSearchParams({ range: key });
  if (key === 'custom' && custom?.from) {
    q.set('from', format(custom.from, 'yyyy-MM-dd'));
    q.set('to', format(custom.to ?? custom.from, 'yyyy-MM-dd'));
  }
  return `?${q.toString()}`;
}
