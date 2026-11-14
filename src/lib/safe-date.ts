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

/**
 * When an order was taken, for the ERP's own screens (owner, 2026-11-14: "with the date also add the time … just in the ERP
 * and the app, so that we know what time that order was taken"; never on the bill, slip or PDF): "5 Nov, 3:42 pm", the year
 * only when it is not this one. A record that holds a date and no time (an import) shows the date alone, not a made-up
 * midnight.
 */
export function takenAt(value: unknown, fallback = '–'): string {
  const d = toDate(value);
  if (!d) return fallback;
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ' yyyy';
  const hasTime = typeof value !== 'string' || /T\d{2}:\d{2}/.test(value);
  try { return format(d, hasTime ? `d MMM${year}, h:mm a` : `d MMM${year}`); } catch { return fallback; }
}

/** `format(parseISO(value), pattern)` that answers `fallback` (a dash) instead of throwing. */
export function formatDate(value: unknown, pattern: string, fallback = '–'): string {
  const d = toDate(value);
  if (!d) return fallback;
  try { return format(d, pattern); } catch { return fallback; }
}
