/**
 * "Taken today" by day: the histogram behind Home's figure (owner, 2026-11-03: "tapping Taken today should open
 * the histogram of per day with all details").
 *
 * The bars use EXACTLY Home's rule (`revenueForPeriod`, lib/analytics/revenue-period.ts), so the days of a range
 * add up to the rupee to what Home would have shown for that range:
 *   - an invoice (not refunded, gold coins split out first as Analytics does) at `invoiceSaleValue`, on its
 *     revenue date (the day of the order it came from, else its own); the unpaid part counts;
 *   - a counter order not yet invoiced (`bookedAsSale`) at its subtotal, on the day it was taken;
 *   - Extra revenue at its amount on its date (repair payments are Extra revenue with a `repairId`).
 * It is a sale value, not cash received. Coin sales are not in the bars (Home notes them beside); each day
 * carries them as `coins`, never added.
 *
 * Each entry's amount is split by what was recorded into Cash / Bank (transfer) / Card / Other (cheque, no
 * method recorded, gold taken in exchange, extra revenue) / Not paid yet; the parts sum to the entry, and an
 * entry's parts sum into its day's. A day is the device's calendar day, as Home's `startOfDay` is.
 * Pure: the web dialog draws it, the phones follow it.
 */

import { format, startOfDay, addDays } from 'date-fns';
import type { AdditionalRevenue, Invoice, InvoiceItem, Order, Repair } from '@/lib/store';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { splitAllCoinSales } from '@/lib/analytics/coins';
import { paymentExchangePart } from '@/lib/analytics/cash-in';
import { bookedAsSale } from '@/lib/order-stage';
import { revenueDate } from '@/lib/reports/monthly-time';
import { orderAdvancePayments } from '@/lib/order-payment';
import { exchangeTotal, invoiceExchanges, orderExchanges } from '@/lib/exchange';

export type TakenKind = 'invoice' | 'order' | 'repair' | 'extra';
export const TAKEN_KINDS: TakenKind[] = ['invoice', 'order', 'repair', 'extra'];

/** How an entry (or a day) was paid; always sums to the amount. */
export interface MethodSplit { cash: number; bank: number; card: number; other: number; unpaid: number }
export const METHOD_KEYS: (keyof MethodSplit)[] = ['cash', 'bank', 'card', 'other', 'unpaid'];
export const METHOD_LABEL: Record<keyof MethodSplit, string> = { cash: 'Cash', bank: 'Bank', card: 'Card', other: 'Other', unpaid: 'Not paid yet' };

export interface TakenEntry {
  kind: TakenKind;
  /** INV-…, ORD-…, REP-…, or the Extra revenue row's id. */
  id: string;
  /** Where it opens: /invoices/<id>, /orders/<id>, /repairs?id=…; none for plain Extra revenue. */
  href?: string;
  /** The instant it counts from (ISO, or a plain day). */
  at: string;
  /** Who took it (the invoice's / order's `takenBy`), when recorded. */
  who: string;
  customer: string;
  what: string;
  amount: number;
  methods: MethodSplit;
  /** "Cash", "Cash + Bank", "Not paid yet", … */
  method: string;
}

export interface TakenDay {
  /** yyyy-MM-dd, the device's day. */
  day: string;
  total: number;
  methods: MethodSplit;
  counts: Record<TakenKind, number>;
  amounts: Record<TakenKind, number>;
  /** Gold-coin sales that day: beside, never in `total`. */
  coins: number;
  /** Newest first. */
  entries: TakenEntry[];
}

export interface TakenByDay { days: TakenDay[]; total: number; methods: MethodSplit; counts: Record<TakenKind, number> }

export interface TakenInput {
  invoices: Invoice[];
  orders: Order[];
  extraRevenues: AdditionalRevenue[];
  repairs?: Repair[];
}

const zeroMethods = (): MethodSplit => ({ cash: 0, bank: 0, card: 0, other: 0, unpaid: 0 });
const zeroKinds = (): Record<TakenKind, number> => ({ invoice: 0, order: 0, repair: 0, extra: 0 });
const add = (a: MethodSplit, b: MethodSplit) => { for (const k of METHOD_KEYS) a[k] += b[k]; };

/** Home's own window test (revenue-period.ts): a plain day is Karachi's midnight. */
const within = (from: Date, to: Date) => (iso: string | undefined) => {
  if (!iso) return false;
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+05:00` : iso).getTime();
  return at >= from.getTime() && at < to.getTime();
};
const instant = (iso: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00+05:00` : iso);

export const dayKey = (d: Date): string => format(startOfDay(d), 'yyyy-MM-dd');

function bucket(method: string | undefined): 'cash' | 'bank' | 'card' | 'other' {
  if (method === 'Cash') return 'cash';
  if (method === 'Bank Transfer') return 'bank';
  if (method === 'Card') return 'card';
  return 'other';
}

/**
 * The entry's amount split by what was paid: `paid` is money received by method (a handed-back credit is negative),
 * the rest of the amount is not paid yet. Paid beyond the amount (credit) is scaled back so the parts always sum to it.
 */
export function splitByMethod(amount: number, paid: Partial<Omit<MethodSplit, 'unpaid'>>): MethodSplit {
  const m: MethodSplit = { cash: paid.cash ?? 0, bank: paid.bank ?? 0, card: paid.card ?? 0, other: paid.other ?? 0, unpaid: 0 };
  if (!(amount > 0)) return { ...zeroMethods(), unpaid: amount };
  const sum = m.cash + m.bank + m.card + m.other;
  if (sum > amount) {
    const f = amount / sum;
    m.cash *= f; m.bank *= f; m.card *= f; m.other *= f;
  } else {
    m.unpaid = amount - sum;
  }
  // Floating residue to the largest part, so the parts sum to the amount.
  const residue = amount - (m.cash + m.bank + m.card + m.other + m.unpaid);
  if (Math.abs(residue) > 1e-9) {
    const big = METHOD_KEYS.reduce((a, k) => (m[k] > m[a] ? k : a), 'unpaid' as keyof MethodSplit);
    m[big] += residue;
  }
  return m;
}

const methodLabel = (m: MethodSplit): string => {
  const names = METHOD_KEYS.filter(k => Math.abs(m[k]) > 0.5).map(k => METHOD_LABEL[k]);
  return names.length ? names.join(' + ') : 'Not paid yet';
};

const itemsOf = (inv: Invoice): InvoiceItem[] =>
  Array.isArray(inv.items) ? inv.items : Object.values((inv.items || {}) as Record<string, InvoiceItem>);

function entry(e: Omit<TakenEntry, 'method' | 'methods'> & { paid: Partial<Omit<MethodSplit, 'unpaid'>> }): TakenEntry {
  const { paid, ...rest } = e;
  const methods = splitByMethod(e.amount, paid);
  return { ...rest, methods, method: methodLabel(methods) };
}

/** Every entry Home counts in [from, to), unsorted and not yet in days. */
export function takenEntries(input: TakenInput, from: Date, to: Date): { entries: TakenEntry[]; coins: { at: string; amount: number }[] } {
  const inWindow = within(from, to);
  const ordersById = new Map(input.orders.map(o => [o.id, o]));
  const { jewellery, coins } = splitAllCoinSales(input.invoices);
  const entries: TakenEntry[] = [];

  for (const inv of jewellery) {
    if (!inv.createdAt || inv.status === 'Refunded') continue;
    const at = revenueDate(inv, ordersById);
    if (!inWindow(at)) continue;
    const paid: Partial<MethodSplit> = {};
    for (const p of Array.isArray(inv.paymentHistory) ? inv.paymentHistory : []) {
      if (!p) continue;
      const inKind = paymentExchangePart(p);
      const cash = (Number(p.amount) || 0) - inKind;
      const key = bucket(p.method);
      paid[key] = (paid[key] ?? 0) + cash;
      if (inKind) paid.other = (paid.other ?? 0) + inKind;
    }
    // Gold taken off the invoice's total (the sale value adds it back) is paid in kind.
    const exchange = exchangeTotal(invoiceExchanges(inv));
    if (exchange) paid.other = (paid.other ?? 0) + exchange;
    const names = itemsOf(inv).map(i => i?.name).filter(Boolean);
    entries.push(entry({
      kind: 'invoice', id: inv.id, href: `/invoices/${inv.id}`, at, who: inv.takenBy || '', customer: inv.customerName || 'Walk-in',
      what: names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ') || 'Sale',
      amount: invoiceSaleValue(inv), paid,
    }));
  }

  for (const o of input.orders) {
    if (!bookedAsSale(o) || !inWindow(o.createdAt)) continue;
    const paid: Partial<MethodSplit> = {};
    for (const p of orderAdvancePayments(o)) { const k = bucket(p.method); paid[k] = (paid[k] ?? 0) + (Number(p.amount) || 0); }
    const exchange = exchangeTotal(orderExchanges(o));
    if (exchange) paid.other = (paid.other ?? 0) + exchange;
    entries.push(entry({
      kind: 'order', id: o.id, href: `/orders/${o.id}`, at: o.createdAt, who: o.takenBy || '', customer: o.customerName || 'Walk-in',
      what: o.summary || 'Order', amount: Number(o.subtotal) || 0, paid,
    }));
  }

  const repairPayment = new Map<string, { repair: Repair; method?: string }>();
  for (const r of input.repairs ?? []) for (const p of r?.payments ?? []) if (p.revenueId) repairPayment.set(p.revenueId, { repair: r, method: p.method });
  for (const r of input.extraRevenues) {
    if (!r || !inWindow(r.date)) continue;
    const amount = Number(r.amount) || 0;
    const rep = r.repairId ? repairPayment.get(r.id) : undefined;
    // Money taken is paid money: a repair's by the repair's own method, other Extra revenue records none (Other).
    entries.push(entry(r.repairId
      ? { kind: 'repair', id: r.repairId, href: `/repairs?id=${encodeURIComponent(r.repairId)}`, at: r.date, who: rep?.repair.takenBy || '', customer: rep?.repair.customerName || r.description, what: 'Repair payment', amount, paid: { [bucket(rep?.method)]: amount } }
      : { kind: 'extra', id: r.id, at: r.date, who: '', customer: '', what: r.description || 'Extra revenue', amount, paid: { other: amount } }));
  }

  const coinRows = coins
    .filter(i => i.createdAt && i.status !== 'Refunded' && inWindow(revenueDate(i, ordersById)))
    .map(i => ({ at: revenueDate(i, ordersById), amount: invoiceSaleValue(i) }));
  return { entries, coins: coinRows };
}

/** Day by day over [from, to): every day in the range is there, quiet ones with zeros. */
export function takenByDay(input: TakenInput, from: Date, to: Date): TakenByDay {
  const { entries, coins } = takenEntries(input, from, to);
  const days = new Map<string, TakenDay>();
  for (let d = startOfDay(from); d.getTime() < to.getTime(); d = addDays(d, 1)) {
    const key = dayKey(d);
    days.set(key, { day: key, total: 0, methods: zeroMethods(), counts: zeroKinds(), amounts: zeroKinds(), coins: 0, entries: [] });
  }
  const dayOf = (at: string) => {
    const key = dayKey(instant(at));
    return days.get(key) ?? (days.set(key, { day: key, total: 0, methods: zeroMethods(), counts: zeroKinds(), amounts: zeroKinds(), coins: 0, entries: [] }), days.get(key)!);
  };
  for (const e of entries) {
    const d = dayOf(e.at);
    d.entries.push(e);
    d.total += e.amount;
    d.counts[e.kind] += 1;
    d.amounts[e.kind] += e.amount;
    add(d.methods, e.methods);
  }
  for (const c of coins) dayOf(c.at).coins += c.amount;
  const list = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  for (const d of list) d.entries.sort((a, b) => instant(b.at).getTime() - instant(a.at).getTime());
  const out: TakenByDay = { days: list, total: 0, methods: zeroMethods(), counts: zeroKinds() };
  for (const d of list) {
    out.total += d.total; add(out.methods, d.methods);
    for (const k of TAKEN_KINDS) out.counts[k] += d.counts[k];
  }
  return out;
}

export type TakenRange = '7d' | 'month' | '30d' | '90d';
export const TAKEN_RANGES: { id: TakenRange; label: string }[] = [
  { id: '7d', label: '7 days' }, { id: 'month', label: 'This month' }, { id: '30d', label: '30 days' }, { id: '90d', label: '90 days' },
];

/** [from, to) for a range ending today: the last N days including today, or the 1st to today. */
export function takenRange(range: TakenRange, now = new Date()): { from: Date; to: Date } {
  const today = startOfDay(now);
  const to = addDays(today, 1);
  if (range === 'month') return { from: new Date(today.getFullYear(), today.getMonth(), 1), to };
  const n = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return { from: addDays(today, 1 - n), to };
}
