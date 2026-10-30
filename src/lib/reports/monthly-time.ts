/**
 * Karachi's months and days, for the monthly report (monthly.ts) and its insights (monthly-insights.ts).
 * Months are Karachi's (UTC+5, no daylight saving), whatever the machine's clock says.
 */

import type { Invoice, Order } from '@/lib/store';

export interface MonthRef { year: number; month: number }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

export const monthKey = (m: MonthRef) => `${m.year}-${pad(m.month)}`;
export const monthLabel = (m: MonthRef) => `${MONTHS[m.month - 1]} ${m.year}`;

/** "2026-09" → { 2026, 9 }; anything else → null. */
export function parseMonth(s: unknown): MonthRef | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]);
  return month >= 1 && month <= 12 && year >= 2000 && year <= 2100 ? { year, month } : null;
}

export const addMonths = (m: MonthRef, n: number): MonthRef => {
  const i = m.year * 12 + (m.month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
};

/** The month a moment falls in, in Karachi. */
export function karachiMonth(d: Date): MonthRef {
  const k = new Date(d.getTime() + 5 * 3600_000);
  return { year: k.getUTCFullYear(), month: k.getUTCMonth() + 1 };
}

/** First and last instant of a Karachi month. */
export function monthBounds(m: MonthRef): { from: Date; to: Date } {
  const from = new Date(`${m.year}-${pad(m.month)}-01T00:00:00+05:00`);
  const next = addMonths(m, 1);
  const to = new Date(new Date(`${next.year}-${pad(next.month)}-01T00:00:00+05:00`).getTime() - 1);
  return { from, to };
}

/** A stored date as an instant. A bare "2026-09-01" is that day in Karachi, as the counter meant it. */
export function instant(iso: string | undefined | null): number {
  if (!iso) return NaN;
  const s = String(iso);
  return (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00+05:00`) : new Date(s)).getTime();
}
/** The Karachi day of a stored date, "2026-09-30" ('' when it isn't one). */
export function karachiDay(iso: string | undefined | null): string {
  const t = instant(iso);
  return Number.isNaN(t) ? '' : new Date(t + 5 * 3600_000).toISOString().slice(0, 10);
}
export const within = (iso: string | undefined | null, b: { from: Date; to: Date }) => {
  const t = instant(iso);
  return t >= b.from.getTime() && t <= b.to.getTime();
};

/** store.ts' getInvoiceRevenueDate, here so the server never imports the client store. */
export function revenueDate(inv: Pick<Invoice, 'createdAt' | 'sourceOrderId'>, ordersById: Map<string, Pick<Order, 'createdAt'>>): string {
  const order = inv.sourceOrderId ? ordersById.get(inv.sourceOrderId) : undefined;
  return order?.createdAt || inv.createdAt;
}

