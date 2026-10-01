/**
 * The scheduled WhatsApp reports as documents (doc.ts), from rows already read: the morning
 * checklist, the end of the day, the daily report, the weekly report, orders past their date,
 * given items not back, karigar balances. reports.ts reads Firestore and calls these; doc-pdf.ts
 * draws them. Pure, tested.
 *
 * The figures are the ones the text reports carried (sales are invoices at their sale value,
 * the drawer is Home → Today's cash), now as tables. "Today" is Karachi's day: the text reports
 * took the server's (UTC) midnight, so a sale between midnight and 5 am went to the day before.
 */

import { todaysCash, METHODS, karachiDayPeriod } from '@/lib/analytics/todays-cash';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { isBusinessCost } from '@/lib/partnership';
import { lateOrders, orderTiming, timingLabel, type OrderTiming } from '@/lib/order-timing';
import { grams, longDay, plural, pkr, rs, shortDay, clock, type AlertDoc, type Section, type Table } from './doc';

/** A Firestore document as read. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export interface KarigarBalance { name: string; cash: number; gold: number }

export interface ShopRows {
  orders: Row[];
  invoices: Row[];
  expenses: Row[];
  repairs?: Row[];
  extraRevenues?: Row[];
  given?: Row[];
  karigars?: KarigarBalance[];
}

const DAY = 86_400_000;
const who = (r: Row) => String(r.customerName || '').trim() || 'Walk-in';
const saleValue = (i: Row) => invoiceSaleValue(i as Parameters<typeof invoiceSaleValue>[0]);
const at = (iso: unknown) => { const t = new Date(String(iso ?? '')).getTime(); return Number.isNaN(t) ? NaN : t; };
const daysSince = (iso: string, now: Date) => Math.floor((now.getTime() - at(iso)) / DAY);
const isActive = (o: Row) => o.status === 'Pending' || o.status === 'In Progress';
const late = (orders: Row[], now: Date) => lateOrders(orders as Array<Row & Parameters<typeof lateOrders>[0][number]>, now);

/** Invoices made in [from, to), refunds left out. */
function salesBetween(invoices: Row[], from: number, to = Infinity) {
  const list = invoices.filter(i => i.status !== 'Refunded' && at(i.createdAt) >= from && at(i.createdAt) < to)
    .sort((a, b) => at(a.createdAt) - at(b.createdAt));
  return { list, count: list.length, value: list.reduce((s, i) => s + saleValue(i), 0) };
}

/** Orders finished from a time on, each with the invoice it became (dated by the invoice). */
function completedSince(orders: Row[], invoices: Row[], from: number, to = Infinity): { order: Row; invoice: Row }[] {
  const byId = new Map(invoices.map(i => [i.id, i]));
  const byOrder = new Map(invoices.filter(i => i.sourceOrderId).map(i => [i.sourceOrderId, i]));
  return orders.flatMap(order => {
    if (order.status !== 'Completed') return [];
    const invoice = (order.invoiceId && byId.get(order.invoiceId)) || byOrder.get(order.id);
    const t = invoice ? at(invoice.createdAt) : NaN;
    return invoice && t >= from && t < to ? [{ order, invoice }] : [];
  });
}

const salesTable = (list: Row[]): Table => ({
  columns: [{ label: 'Invoice', width: 21 }, { label: 'Customer' }, { label: 'Sale', width: 17, align: 'right' }, { label: 'Owed', width: 15, align: 'right' }],
  rows: list.map(i => [i.id, who(i), rs(saleValue(i)), Number(i.balanceDue) > 0 ? rs(i.balanceDue) : '-']),
  tones: list.map(i => (Number(i.balanceDue) > 0 ? 'flag' : undefined)),
  details: list.map(i => (i.sourceOrderId ? `from ${i.sourceOrderId}` : undefined)),
  foot: list.length > 1 ? ['', plural(list.length, 'sale'), rs(list.reduce((s, i) => s + saleValue(i), 0)), rs(list.reduce((s, i) => s + Math.max(0, Number(i.balanceDue) || 0), 0))] : undefined,
});

const ordersTable = (list: Row[], valueLabel = 'Estimate'): Table => ({
  columns: [{ label: 'Order', width: 21 }, { label: 'Customer' }, { label: valueLabel, width: 19, align: 'right' }, { label: 'Advance', width: 16, align: 'right' }],
  rows: list.map(o => [o.id, who(o), rs(o.subtotal ?? o.grandTotal), Number(o.advancePayment) > 0 ? rs(o.advancePayment) : '-']),
  details: list.map(o => o.summary || undefined),
});

const lateTable = (rows: { order: Row; timing: OrderTiming }[]): Table => ({
  columns: [{ label: 'Order', width: 21 }, { label: 'Customer' }, { label: 'Late', width: 18 }, { label: 'Balance', width: 16, align: 'right' }],
  rows: rows.map(({ order: o, timing }) => [o.id, who(o), timingLabel(timing), rs(o.grandTotal)]),
  tones: rows.map(x => (x.timing.daysLate >= 7 ? 'flag' : undefined)),
  details: rows.map(x => x.order.summary || undefined),
});

const completedTable = (rows: { order: Row; invoice: Row }[]): Table => ({
  columns: [{ label: 'Order', width: 21 }, { label: 'Invoice', width: 21 }, { label: 'Customer' }, { label: 'Sale', width: 17, align: 'right' }],
  rows: rows.map(({ order: o, invoice }) => [o.id, invoice.id, who(o), rs(saleValue(invoice))]),
});

const givenTable = (items: Row[], now: Date): Table => ({
  columns: [{ label: 'Item' }, { label: 'With', width: 24 }, { label: 'Given', width: 13 }, { label: 'Days', width: 10, align: 'right' }],
  rows: items.map(g => [g.description || g.id || 'Item', g.recipientName || '-', shortDay(g.date), String(daysSince(g.date, now))]),
  tones: items.map(g => (daysSince(g.date, now) >= 14 ? 'flag' : undefined)),
});

const karigarTable = (rows: KarigarBalance[], value: (k: KarigarBalance) => string, valueLabel: string): Table => ({
  columns: [{ label: 'Karigar' }, { label: valueLabel, width: 26, align: 'right' }],
  rows: rows.map(k => [k.name, value(k)]),
});

const ESTIMATED_NOTE = '"Old" means no promised date was recorded: counted from the day the order was taken.';
const estimatedNote = (rows: { timing: OrderTiming }[]) => (rows.some(x => x.timing.estimated) ? ESTIMATED_NOTE : undefined);
const dayLabel = (now: Date) => shortDay(now.toISOString());

// ── The morning checklist ────────────────────────────────────────────────────

export function checklistDoc(r: ShopRows, now: Date): AlertDoc {
  const active = r.orders.filter(isActive);
  const pending = active.filter(o => o.status === 'Pending').length;
  const lateRows = late(active, now);
  const lateBad = lateRows.filter(x => x.timing.daysLate >= 7).length;
  const onTrack = active
    .filter(o => !lateRows.some(x => x.order === o))
    .map(o => ({ order: o, timing: orderTiming(o as never, now) }))
    .sort((a, b) => b.timing.daysLate - a.timing.daysLate);
  const out = (r.given ?? []).filter(g => g.status === 'out');
  const outOld = out.filter(g => daysSince(g.date, now) >= 7).sort((a, b) => daysSince(b.date, now) - daysSince(a.date, now));
  const toPay = (r.karigars ?? []).filter(k => k.cash < 0).sort((a, b) => a.cash - b.cash);
  const payTotal = toPay.reduce((s, k) => s - k.cash, 0);

  return {
    kind: 'daily-checklist',
    title: 'Morning checklist',
    heading: longDay(now),
    subheading: `${plural(active.length, 'active order')} · ${lateRows.length} past their date`,
    headline: `${dayLabel(now)} · ${lateRows.length} late of ${active.length} orders`,
    figures: [
      { label: 'Active orders', value: String(active.length), note: `${pending} pending · ${active.length - pending} in progress` },
      { label: 'Past their date', value: String(lateRows.length), note: lateBad ? `${lateBad} a week or more` : 'none a week late', tone: lateRows.length ? 'flag' : undefined },
      { label: 'Given items out', value: String(out.length), note: `${outOld.length} over a week`, tone: outOld.length ? 'flag' : undefined },
      { label: 'To pay karigars', value: payTotal ? pkr(payTotal) : 'Nothing', note: toPay.length ? `to ${plural(toPay.length, 'karigar')}` : 'from Hisaab' },
    ],
    sections: [
      { title: 'Past the promised date', note: 'worst first', table: lateTable(lateRows), empty: 'Nothing is late.' },
      {
        title: 'Coming up',
        note: onTrack.length > 12 ? `the next 12 of ${onTrack.length}` : 'soonest first',
        table: {
          columns: [{ label: 'Order', width: 21 }, { label: 'Customer' }, { label: 'Due', width: 18 }, { label: 'Balance', width: 16, align: 'right' }],
          rows: onTrack.slice(0, 12).map(({ order: o, timing }) => [o.id, who(o), timingLabel(timing) || `${daysSince(o.createdAt, now)} days old`, rs(o.grandTotal)]),
          details: onTrack.slice(0, 12).map(x => x.order.summary || undefined),
        },
        empty: 'No other active orders.',
      },
      ...(outOld.length ? [{ title: 'Given out over a week', table: givenTable(outOld, now) } as Section] : []),
      ...(toPay.length ? [{ title: 'To pay karigars', note: 'from Hisaab', table: karigarTable(toPay, k => rs(-k.cash), 'PKR') } as Section] : []),
    ],
    footnote: estimatedNote(lateRows),
    at: now,
  };
}

// ── The day: end of day and the daily report share their rows ─────────────────

function theDay(r: ShopRows, now: Date) {
  const { period } = karachiDayPeriod(now);
  const from = period.from!.getTime(), to = period.to!.getTime() + 1;
  const cash = todaysCash({
    invoices: r.invoices as never, orders: r.orders as never, expenses: r.expenses as never,
    repairs: (r.repairs ?? []) as never, extraRevenues: (r.extraRevenues ?? []) as never, now,
  });
  const sold = salesBetween(r.invoices, from, to);
  const taken = r.orders.filter(o => at(o.createdAt) >= from && at(o.createdAt) < to).sort((a, b) => at(a.createdAt) - at(b.createdAt));
  const completed = completedSince(r.orders, r.invoices, from, to);
  const active = r.orders.filter(isActive);
  const lateRows = late(active, now);
  const outstanding = r.invoices.filter(i => i.status !== 'Refunded' && Number(i.balanceDue) > 0);
  return { cash, sold, taken, completed, active, lateRows, outstanding };
}

const SOURCE_WORD: Record<string, string> = { invoice: 'payment', advance: 'advance', repair: 'repair', extra: 'other income' };

function moneyInSection(cash: ReturnType<typeof todaysCash>): Section {
  return {
    title: 'Money in, by how it was paid',
    note: 'the drawer, as Home shows it',
    pairs: [
      ...METHODS.filter(m => cash.byMethod[m]).map(m => ({ label: m === 'Not recorded' ? 'How paid not recorded' : m, value: rs(cash.byMethod[m]) })),
      { label: 'Money in', value: pkr(cash.totalIn), strong: true },
      ...(cash.exchange ? [{ label: 'Exchange taken (not cash)', value: rs(cash.exchange), tone: 'muted' as const }] : []),
      { label: 'Paid out (expenses)', value: cash.expenses ? `- ${rs(cash.expenses)}` : '0' },
      { label: 'Net cash', value: pkr(cash.netCash), strong: true, tone: cash.netCash < 0 ? 'flag' as const : undefined },
    ],
    empty: 'No money in or out today.',
  };
}

function paymentsSection(cash: ReturnType<typeof todaysCash>): Section {
  const lines = [...cash.lines].sort((a, b) => at(a.at) - at(b.at));
  return {
    title: 'Every payment today',
    table: {
      columns: [{ label: 'Time', width: 14 }, { label: 'For', width: 21 }, { label: 'Who' }, { label: 'How', width: 15 }, { label: 'Amount', width: 16, align: 'right' }],
      rows: lines.map(l => [clock(l.at), l.ref, l.who, l.method === 'Not recorded' ? '-' : l.method === 'Bank Transfer' ? 'Bank' : l.method, rs(l.amount)]),
      details: lines.map(l => (l.source === 'invoice' ? undefined : SOURCE_WORD[l.source])),
      foot: lines.length > 1 ? ['', '', plural(lines.length, 'payment'), '', rs(lines.reduce((s, l) => s + l.amount, 0))] : undefined,
    },
    empty: 'No payments today.',
  };
}

const expensesSection = (cash: ReturnType<typeof todaysCash>): Section => ({
  title: 'Paid out today',
  table: {
    columns: [{ label: 'What' }, { label: 'Category', width: 26 }, { label: 'Amount', width: 17, align: 'right' }],
    rows: cash.expenseLines.map(e => [e.description || '-', e.category || '-', rs(e.amount)]),
    foot: cash.expenseLines.length > 1 ? ['', '', rs(cash.expenses)] : undefined,
  },
  empty: 'Nothing paid out.',
});

export function endOfDayDoc(r: ShopRows, now: Date): AlertDoc {
  const d = theDay(r, now);
  return {
    kind: 'end-of-day',
    title: 'End of day',
    heading: longDay(now),
    subheading: `${plural(d.sold.count, 'sale')} · ${plural(d.taken.length, 'new order')} · ${d.completed.length} completed`,
    headline: `${dayLabel(now)} · sales ${pkr(d.sold.value)} · in ${pkr(d.cash.totalIn)}`,
    figures: [
      { label: 'Sales', value: pkr(d.sold.value), note: plural(d.sold.count, 'invoice') },
      { label: 'Money in', value: pkr(d.cash.totalIn), note: d.cash.exchange ? `and ${rs(d.cash.exchange)} exchange` : undefined },
      { label: 'Paid out', value: pkr(d.cash.expenses) },
      { label: 'New orders', value: String(d.taken.length), note: d.taken.length ? `est. ${rs(d.taken.reduce((s, o) => s + (Number(o.subtotal) || 0), 0))}` : undefined },
    ],
    sections: [
      { title: 'Sales today', table: salesTable(d.sold.list), empty: 'No sales today.' },
      { title: 'Orders taken today', table: ordersTable(d.taken), empty: 'No new orders.' },
      ...(d.completed.length ? [{ title: 'Completed today', table: completedTable(d.completed) } as Section] : []),
      expensesSection(d.cash),
      {
        title: 'Still open',
        pairs: [
          { label: 'Active orders', value: String(d.active.length) },
          { label: 'Past their date', value: String(d.lateRows.length), tone: d.lateRows.length ? 'flag' : undefined },
        ],
      },
    ],
    at: now,
  };
}

export function dailyReportDoc(r: ShopRows, now: Date): AlertDoc {
  const d = theDay(r, now);
  const owedTotal = d.outstanding.reduce((s, i) => s + (Number(i.balanceDue) || 0), 0);
  return {
    kind: 'daily-report',
    title: 'Daily report',
    heading: longDay(now),
    subheading: `${plural(d.sold.count, 'sale')} · ${plural(d.cash.lines.length, 'payment')} · ${plural(d.taken.length, 'new order')}`,
    headline: `${dayLabel(now)} · sales ${pkr(d.sold.value)} · net cash ${pkr(d.cash.netCash)}`,
    figures: [
      { label: 'Sales', value: pkr(d.sold.value), note: plural(d.sold.count, 'invoice') },
      { label: 'Money in', value: pkr(d.cash.totalIn), note: plural(d.cash.lines.length, 'payment') },
      { label: 'Paid out', value: pkr(d.cash.expenses), note: plural(d.cash.expenseLines.length, 'expense') },
      { label: 'Net cash', value: pkr(d.cash.netCash), note: 'the drawer', tone: d.cash.netCash < 0 ? 'flag' : undefined },
    ],
    sections: [
      moneyInSection(d.cash),
      paymentsSection(d.cash),
      { title: 'Sales today', table: salesTable(d.sold.list), empty: 'No sales today.' },
      { title: 'Orders taken today', table: ordersTable(d.taken), empty: 'No new orders.' },
      ...(d.completed.length ? [{ title: 'Completed today', table: completedTable(d.completed) } as Section] : []),
      expensesSection(d.cash),
      {
        title: 'Owed and open',
        pairs: [
          { label: `Unpaid invoices · ${d.outstanding.length}`, value: pkr(owedTotal), tone: owedTotal ? 'flag' : undefined },
          { label: 'Active orders', value: String(d.active.length) },
          { label: 'Past their date', value: String(d.lateRows.length), tone: d.lateRows.length ? 'flag' : undefined },
        ],
      },
    ],
    at: now,
  };
}

// ── The week ─────────────────────────────────────────────────────────────────

export function weeklyDoc(r: ShopRows, now: Date): AlertDoc {
  const { period } = karachiDayPeriod(now);
  const end = period.to!.getTime() + 1;
  const start = end - 7 * DAY;
  const sold = salesBetween(r.invoices, start, end);
  const taken = r.orders.filter(o => at(o.createdAt) >= start && at(o.createdAt) < end);
  const done = completedSince(r.orders, r.invoices, start, end);
  const cancelled = r.orders.filter(o => (o.status === 'Cancelled' || o.status === 'Refunded') && at(o.createdAt) >= start);
  const active = r.orders.filter(isActive);
  const lateRows = late(active, now);
  const lateBad = lateRows.filter(x => x.timing.daysLate >= 7).length;
  // Business costs only: a partner's draw is not a cost of the week's trade.
  const exp = r.expenses.filter(e => { const t = at(e.date || e.createdAt); return t >= start && t < end && isBusinessCost(e as never); });
  const expTotal = exp.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const byCat = new Map<string, number>();
  exp.forEach(e => byCat.set(String(e.category || 'Other'), (byCat.get(String(e.category || 'Other')) ?? 0) + (Number(e.amount) || 0)));
  const net = sold.value - expTotal;
  const days = Array.from({ length: 7 }, (_, i) => start + i * DAY);
  const karigars = r.karigars ?? [];
  const toPay = karigars.filter(k => k.cash < 0);
  const goldWith = karigars.filter(k => k.gold > 0);
  const out = (r.given ?? []).filter(g => g.status === 'out').sort((a, b) => daysSince(b.date, now) - daysSince(a.date, now));
  const span = `${shortDay(new Date(start).toISOString())} to ${shortDay(new Date(end - 1).toISOString())}`;

  return {
    kind: 'weekly-report',
    title: 'Weekly report',
    heading: span,
    subheading: `the seven days to ${longDay(new Date(end - 1))}`,
    headline: `${span} · sales ${pkr(sold.value)}`,
    figures: [
      { label: 'Sales', value: pkr(sold.value), note: plural(sold.count, 'invoice') },
      { label: 'Expenses', value: pkr(expTotal), note: 'business costs' },
      { label: 'Sales less expenses', value: pkr(net), note: 'before metal and making', tone: net < 0 ? 'flag' : undefined },
      { label: 'New orders', value: String(taken.length), note: `est. ${rs(taken.reduce((s, o) => s + (Number(o.subtotal) || 0), 0))}` },
    ],
    sections: [
      {
        title: 'Day by day',
        table: {
          columns: [{ label: 'Day' }, { label: 'Sales', width: 14, align: 'right' }, { label: 'Value', width: 22, align: 'right' }, { label: 'Orders', width: 14, align: 'right' }],
          rows: days.map(t => {
            const s = salesBetween(r.invoices, t, t + DAY);
            const o = r.orders.filter(x => at(x.createdAt) >= t && at(x.createdAt) < t + DAY).length;
            return [new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(t + DAY / 2)), String(s.count), rs(s.value), String(o)];
          }),
          foot: ['Week', String(sold.count), rs(sold.value), String(taken.length)],
        },
      },
      { title: 'Sales', table: salesTable(sold.list), empty: 'No sales this week.' },
      ...(done.length ? [{ title: 'Orders completed', table: completedTable(done) } as Section] : []),
      {
        title: 'Expenses by category',
        pairs: [
          ...[...byCat.entries()].sort(([, a], [, b]) => b - a).map(([c, v]) => ({ label: c, value: rs(v) })),
          ...(byCat.size ? [{ label: 'Expenses', value: pkr(expTotal), strong: true }] : []),
        ],
        empty: 'No expenses this week.',
      },
      {
        title: 'Orders',
        pairs: [
          { label: 'Taken this week', value: String(taken.length) },
          { label: 'Completed this week', value: String(done.length) },
          { label: 'Cancelled or refunded', value: String(cancelled.length) },
          { label: 'Active now', value: String(active.length), strong: true },
          { label: 'On track', value: String(active.length - lateRows.length) },
          { label: 'Past their date', value: String(lateRows.length - lateBad), tone: lateRows.length - lateBad ? 'flag' : undefined },
          { label: 'A week or more late', value: String(lateBad), tone: lateBad ? 'flag' : undefined },
        ],
      },
      ...(lateRows.length ? [{ title: 'Past the promised date', table: lateTable(lateRows) } as Section] : []),
      ...(toPay.length || goldWith.length ? [{
        title: 'Karigars (Hisaab)',
        pairs: [
          ...(toPay.length ? [{ label: `To pay · ${toPay.length}`, value: pkr(toPay.reduce((s, k) => s - k.cash, 0)) }] : []),
          ...(goldWith.length ? [{ label: `Gold with them · ${goldWith.length}`, value: grams(goldWith.reduce((s, k) => s + k.gold, 0)) }] : []),
        ],
      } as Section] : []),
      ...(out.length ? [{ title: 'Given items still out', table: givenTable(out.slice(0, 15), now), note: out.length > 15 ? `15 of ${out.length}, longest out first` : undefined } as Section] : []),
    ],
    footnote: estimatedNote(lateRows),
    at: now,
  };
}

// ── The three checks: quiet (null) when there is nothing to say ─────────────

export function overdueDoc(orders: Row[], now: Date): AlertDoc | null {
  const rows = late(orders, now);
  if (!rows.length) return null;
  const bad = rows.filter(x => x.timing.daysLate >= 7);
  const owed = rows.reduce((s, x) => s + (Number(x.order.grandTotal) || 0), 0);
  return {
    kind: 'overdue-orders',
    title: 'Orders past their date',
    heading: plural(rows.length, 'order'),
    subheading: `past the date the customer was promised · ${longDay(now)}`,
    headline: `${dayLabel(now)} · ${plural(rows.length, 'order')} late · ${bad.length} a week or more`,
    figures: [
      { label: 'A week or more', value: String(bad.length), tone: bad.length ? 'flag' : undefined },
      { label: 'Just late', value: String(rows.length - bad.length) },
      { label: 'Balance on them', value: pkr(owed) },
    ],
    sections: [{ title: 'Worst first', table: lateTable(rows) }],
    footnote: estimatedNote(rows),
    at: now,
  };
}

export function givenDoc(given: Row[], now: Date): AlertDoc | null {
  const out = given.filter(g => g.status === 'out');
  const old = out.filter(g => daysSince(g.date, now) >= 7).sort((a, b) => daysSince(b.date, now) - daysSince(a.date, now));
  if (!old.length) return null;
  return {
    kind: 'given-items',
    title: 'Given items not back',
    heading: plural(old.length, 'item'),
    subheading: `out a week or more · ${out.length} out in all`,
    headline: `${dayLabel(now)} · ${plural(old.length, 'item')} out a week or more`,
    figures: [
      { label: 'Two weeks or more', value: String(old.filter(g => daysSince(g.date, now) >= 14).length), tone: 'flag' },
      { label: 'One to two weeks', value: String(old.filter(g => daysSince(g.date, now) < 14).length) },
    ],
    sections: [{ title: 'Longest out first', table: givenTable(old, now) }],
    at: now,
  };
}

export function karigarDoc(karigars: KarigarBalance[], now: Date): AlertDoc | null {
  if (!karigars.length) return null;
  const toPay = karigars.filter(k => k.cash < 0).sort((x, y) => x.cash - y.cash);
  const toGet = karigars.filter(k => k.cash > 0).sort((x, y) => y.cash - x.cash);
  const goldOut = karigars.filter(k => k.gold > 0).sort((x, y) => y.gold - x.gold);
  const goldIn = karigars.filter(k => k.gold < 0).sort((x, y) => x.gold - y.gold);
  const sum = (l: KarigarBalance[], f: (k: KarigarBalance) => number) => l.reduce((s, k) => s + f(k), 0);
  const payTotal = sum(toPay, k => -k.cash);
  return {
    kind: 'karigar-payments',
    title: 'Karigar balances',
    heading: longDay(now),
    subheading: "from Hisaab, as each karigar's page shows it",
    headline: `${dayLabel(now)} · ${payTotal ? `to pay ${pkr(payTotal)}` : `gold with them ${grams(sum(goldOut, k => k.gold))}`}`,
    figures: [
      { label: 'To pay', value: pkr(payTotal), note: `to ${plural(toPay.length, 'karigar')}`, tone: payTotal ? 'flag' : undefined },
      { label: 'To receive', value: pkr(sum(toGet, k => k.cash)), note: `from ${toGet.length}` },
      { label: 'Gold with them', value: grams(sum(goldOut, k => k.gold)), note: `${goldOut.length} karigars` },
      { label: 'Gold owed to them', value: grams(sum(goldIn, k => k.gold)), note: `${goldIn.length} karigars` },
    ],
    sections: [
      ...(toPay.length ? [{ title: 'To pay', table: karigarTable(toPay, k => rs(-k.cash), 'PKR') }] : []),
      ...(toGet.length ? [{ title: 'To receive', table: karigarTable(toGet, k => rs(k.cash), 'PKR') }] : []),
      ...(goldOut.length ? [{ title: 'Gold with karigars', table: karigarTable(goldOut, k => grams(k.gold), 'Gold') }] : []),
      ...(goldIn.length ? [{ title: 'Gold owed to karigars', table: karigarTable(goldIn, k => grams(k.gold), 'Gold') }] : []),
    ],
    at: now,
  };
}
