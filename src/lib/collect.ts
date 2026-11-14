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

/**
 * Filters, several at once (the owner, 2026-11-14: "allow multi-filtering. Just keep the main filter as the person who took
 * the order"). The person is the main one; bill, age and paid narrow it. Within a group any chosen value passes (Mansoor OR
 * Murtaza); across groups all must (Mansoor's AND over 90 days). An empty group lets everything through.
 */
export type CollectKind = CollectRow['kind'];
export type CollectAge = 'under30' | '30to90' | 'over90';
export type CollectPaid = 'nothing' | 'part';

export interface CollectFilters {
  people: ReadonlySet<string>;
  kinds: ReadonlySet<CollectKind>;
  ages: ReadonlySet<CollectAge>;
  paid: ReadonlySet<CollectPaid>;
  /** A customer's name or number, or the bill's id. */
  query: string;
}

export const NO_FILTERS: CollectFilters = { people: new Set(), kinds: new Set(), ages: new Set(), paid: new Set(), query: '' };

const DAY = 86_400_000;
export function ageOf(r: CollectRow, now = Date.now()): CollectAge {
  const days = Math.floor((now - new Date(r.date).getTime()) / DAY);
  return days > 90 ? 'over90' : days >= 30 ? '30to90' : 'under30';
}
export const paidOf = (r: CollectRow): CollectPaid => (r.due >= r.total ? 'nothing' : 'part');

type Group = 'people' | 'kinds' | 'ages' | 'paid' | 'query';

/** Does a row pass every filter but `skip` (so each chip can count what choosing it would add)? */
export function passes(r: CollectRow, f: CollectFilters, skip?: Group, now = Date.now()): boolean {
  if (skip !== 'people' && f.people.size && !f.people.has(r.takenBy)) return false;
  if (skip !== 'kinds' && f.kinds.size && !f.kinds.has(r.kind)) return false;
  if (skip !== 'ages' && f.ages.size && !f.ages.has(ageOf(r, now))) return false;
  if (skip !== 'paid' && f.paid.size && !f.paid.has(paidOf(r))) return false;
  const q = f.query.trim().toLowerCase();
  if (skip !== 'query' && q) {
    const digits = q.replace(/\D/g, '');
    const hay = `${r.customerName} ${r.id}`.toLowerCase();
    if (!hay.includes(q) && !(digits.length >= 3 && (r.phone || '').replace(/\D/g, '').includes(digits))) return false;
  }
  return true;
}

export const filterRows = (rows: readonly CollectRow[], f: CollectFilters, now = Date.now()) => rows.filter(r => passes(r, f, undefined, now));

/** How many rows each value of a group would show, with the other groups' filters on. */
export function countBy<V extends string>(rows: readonly CollectRow[], f: CollectFilters, group: Exclude<Group, 'query'>, valueOf: (r: CollectRow) => V, now = Date.now()) {
  const m = new Map<V, { count: number; due: number }>();
  for (const r of rows) {
    if (!passes(r, f, group, now)) continue;
    const v = valueOf(r); const e = m.get(v) ?? { count: 0, due: 0 };
    e.count++; e.due += r.due; m.set(v, e);
  }
  return m;
}

export const filtersOn = (f: CollectFilters) => f.people.size + f.kinds.size + f.ages.size + f.paid.size + (f.query.trim() ? 1 : 0);
