/**
 * Dates from the books, read without ever throwing.
 *
 * date-fns' `format` throws a RangeError ("Invalid time value") on a date it cannot read, and
 * `format(parseISO(doc.createdAt), …)` sits inside a lot of row renderers: one record with a missing or
 * mangled `createdAt` (an import, an older shape, a hand-edited document) took the whole page down to the
 * error screen. `formatDate` shows a dash for that one row instead.
 */
import { format, isValid, parseISO } from 'date-fns';

/** A Date from an ISO string, millis or a Date; null when it is none of those or not a real date. */
export function toDate(value: unknown): Date | null {
  let d: Date;
  if (value instanceof Date) d = value;
  else if (typeof value === 'string') d = parseISO(value);
  else if (typeof value === 'number' && Number.isFinite(value)) d = new Date(value);
  else return null;
  return isValid(d) ? d : null;
}

/** `format(parseISO(value), pattern)` that answers `fallback` (a dash) instead of throwing. */
export function formatDate(value: unknown, pattern: string, fallback = '–'): string {
  const d = toDate(value);
  if (!d) return fallback;
  try { return format(d, pattern); } catch { return fallback; }
}
