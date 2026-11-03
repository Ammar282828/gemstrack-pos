import { parseISO } from 'date-fns';

/**
 * Newest first, each row's date read once.
 *
 * `rows.sort((a, b) => parseISO(b.at) - parseISO(a.at))` parses two dates per comparison, about
 * n log n parses (~100k for 5,000 invoices, a visible stall on a phone); this reads each row once.
 * Stable, like Array.sort; a row whose date will not parse goes last. Returns a new array.
 */
export function newestFirst<T>(rows: readonly T[], at: (row: T) => string | undefined | null): T[] {
  const keyed = rows.map((row, i) => {
    const raw = at(row);
    const t = raw ? parseISO(raw).getTime() : NaN;
    return { row, i, t: Number.isNaN(t) ? -Infinity : t };
  });
  keyed.sort((a, b) => (b.t === a.t ? a.i - b.i : b.t > a.t ? 1 : -1));
  return keyed.map(k => k.row);
}
