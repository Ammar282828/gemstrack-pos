/**
 * Who still owes the shop, one row per bill (the owner, 2026-11-14: "create a separate page to see people who still owe
 * money in invoices or completed orders. allow to sort by who took the order").
 *
 * Two kinds of row:
 *  - an invoice not refunded whose balance is still due (lib/owed.ts `isOwing`, the same rule as every other "owed" figure);
 *  - an order marked Completed that has not been invoiced yet and still has a balance (`grandTotal` is the balance after
 *    its advances). An invoiced order's debt is its invoice's, so it is never counted twice.
 *
 * Pure: the page (app/collect) hands it the store's invoices and orders.
 */

import type { Invoice, Order } from '@/lib/store';
import { isOwing } from '@/lib/owed';
import { owesMoney } from '@/lib/money';
import { orderFullTotal } from '@/lib/order-payment';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';

export interface CollectRow {
  kind: 'invoice' | 'order';
  id: string;
  href: string;
  customerName: string;
  customerId?: string;
  phone?: string;
  /** When the bill was written (the invoice's, or the order's, date). */
  date: string;
  /** The bill's full amount, and what is still to come. */
  total: number;
  due: number;
  /** Who took it at the counter; '' when nobody was recorded. */
  takenBy: string;
}

export const NOBODY = '';

export function collectRows(invoices: readonly Invoice[], orders: readonly Order[]): CollectRow[] {
  const rows: CollectRow[] = [];
  for (const inv of invoices) {
    if (!isOwing(inv)) continue;
    rows.push({
      kind: 'invoice', id: inv.id, href: `/invoices/${inv.id}`,
      customerName: inv.customerName || 'Walk-in', customerId: inv.customerId || undefined, phone: inv.customerContact || undefined,
      date: inv.createdAt, total: invoiceSaleValue(inv), due: Math.round(inv.balanceDue || 0), takenBy: inv.takenBy || NOBODY,
    });
  }
  for (const o of orders) {
    if (o.status !== 'Completed' || o.invoiceId || !owesMoney(o.grandTotal)) continue;
    rows.push({
      kind: 'order', id: o.id, href: `/orders/${o.id}`,
      customerName: o.customerName || 'Walk-in', customerId: o.customerId || undefined, phone: o.customerContact || undefined,
      date: o.createdAt, total: orderFullTotal(o), due: Math.round(o.grandTotal || 0), takenBy: o.takenBy || NOBODY,
    });
  }
  return rows;
}

export type CollectSort = 'oldest' | 'amount' | 'takenBy';

export function sortRows(rows: CollectRow[], by: CollectSort): CollectRow[] {
  const oldest = (a: CollectRow, b: CollectRow) => String(a.date).localeCompare(String(b.date));
  const copy = [...rows];
  if (by === 'amount') return copy.sort((a, b) => b.due - a.due || oldest(a, b));
  if (by === 'takenBy') return copy.sort((a, b) => (a.takenBy || '￿').localeCompare(b.takenBy || '￿') || oldest(a, b));
  return copy.sort(oldest);
}

/** By who took them: each person's rows' count and total due, the largest first; nobody recorded last. */
export function byTakenBy(rows: readonly CollectRow[]): { takenBy: string; count: number; due: number }[] {
  const m = new Map<string, { count: number; due: number }>();
  for (const r of rows) {
    const e = m.get(r.takenBy) ?? { count: 0, due: 0 };
    e.count++; e.due += r.due; m.set(r.takenBy, e);
  }
  return [...m.entries()].map(([takenBy, v]) => ({ takenBy, ...v }))
    .sort((a, b) => (a.takenBy === NOBODY ? 1 : 0) - (b.takenBy === NOBODY ? 1 : 0) || b.due - a.due);
}
