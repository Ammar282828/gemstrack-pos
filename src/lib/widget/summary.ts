/**
 * The four figures the iPhone's home-screen widget shows, worked out the way the ERP's own pages
 * work them out, from the same functions: the house's rate (the rate chip), the drawer (Today's
 * cash), what is owed (the dashboard's Owed to you, hisaab included) and the orders and repairs
 * due (the dashboard's "Due to customers"). Pure: lib/widget/server.ts reads the rows.
 *
 * The widget only lays these out (apps/iphone), so what they say can change here without a build.
 */

import type { Invoice, Order, Repair, AdditionalRevenue, Expense } from '@/lib/store';
import { mainRate, ratesSetToday, whenSet, type Rates } from '@/lib/rates';
import { revenueForPeriod } from '@/lib/analytics/revenue-period';
import { karachiMonth, monthBounds } from '@/lib/reports/monthly';
import { karachiDayPeriod, todaysCash } from '@/lib/analytics/todays-cash';
import { owedToYou, type LedgerRow } from '@/lib/owed';
import { isActiveOrder, orderTiming } from '@/lib/order-timing';
import { awaitingTransfer } from '@/lib/order-stage';
import { lacCrore } from '@/lib/money';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';

export interface WidgetFigure { label: string; value: string; detail: string | null }
/** Added after the first widget; a phone that does not know them ignores them, and the widget decodes them leniently. */
export interface WidgetExtras {
  /** Revenue per day, the last seven Karachi days, oldest first; the last is today. */
  days: number[];
  /** Percent against the seven days before those; null when there was nothing to compare. */
  weekDelta: number | null;
  /** Orders still on the bench, orders and repairs due today or late, and the late ones. */
  bench: number; due: number; late: number;
  /** What needs someone: late work first, then the biggest unpaid bills. At most four. */
  needs: { title: string; detail: string; tone: 'late' | 'owed'; path: string }[];
  /** The latest three sales. */
  recent: { title: string; amount: string; when: string; path: string }[];
}
export interface WidgetSummary { house: string; updated: string; figures: WidgetFigure[]; asOf?: string; teamNote?: string; extras?: WidgetExtras }

export interface WidgetRows {
  invoices: Invoice[];
  orders: Order[];
  repairs: Repair[];
  extraRevenues: AdditionalRevenue[];
  expenses: Expense[];
  hisaab: LedgerRow[];
  teamNote?: string;
  rates: Rates & { updatedAt?: string | null };
}

const KARACHI_MS = 5 * 3_600_000;
const rs = (n: number) => `Rs ${lacCrore(n)}`;
const clock = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([ap])\.?m\.?/i, ' $1m').toLowerCase();

export function widgetSummary(r: WidgetRows, house: string, metal: 'gold' | 'silver', now = new Date()): WidgetSummary {
  const main = mainRate(metal);
  const rate = Number(r.rates[main.key]) || 0;
  const cash = todaysCash({ invoices: r.invoices, orders: r.orders, repairs: r.repairs, extraRevenues: r.extraRevenues, expenses: r.expenses, now });
  const owed = owedToYou(r.invoices, undefined, r.hisaab);

  // orderTiming reads "today" in the server's own zone (UTC); a Karachi clock lines it up with
  // the promised dates the shop types, as the dashboard on a phone in Karachi sees them.
  const karachiNow = new Date(now.getTime() + KARACHI_MS);
  const timings = [
    ...r.orders.filter((o) => isActiveOrder(o) && !awaitingTransfer(o)).map((o) => orderTiming(o, karachiNow)),
    ...r.repairs.filter((x) => x.status === 'received')
      .map((x) => orderTiming({ promisedDate: x.promisedDate, createdAt: x.receivedAt, status: 'In Progress' }, karachiNow)),
  ];
  const late = timings.filter((t) => t.state === 'late').length;
  const today = timings.filter((t) => t.state === 'today').length;

  const day = karachiDayPeriod(now).period;
  const month = monthBounds(karachiMonth(now));
  const todayRevenue = revenueForPeriod(r, day.from!, new Date(day.to!.getTime() + 1));
  const monthRevenue = revenueForPeriod(r, month.from, new Date(month.to.getTime() + 1));
  const week = (back: number) => {
    const from = new Date(day.from!.getTime() - back * 86_400_000);
    return revenueForPeriod(r, from, new Date(from.getTime() + 86_400_000));
  };
  const days = Array.from({ length: 7 }, (_, i) => Math.round(week(6 - i)));
  const thisWeek = days.reduce((a, b) => a + b, 0);
  const lastWeek = Array.from({ length: 7 }, (_, i) => week(13 - i)).reduce((a, b) => a + b, 0);

  const lateOrders = r.orders
    .filter((o) => isActiveOrder(o) && !awaitingTransfer(o))
    .map((o) => ({ o, t: orderTiming(o, karachiNow) }))
    .filter((x) => x.t.state === 'late')
    .sort((a, b) => b.t.daysLate - a.t.daysLate);
  const unpaid = r.invoices.filter((i) => i.status !== 'Refunded' && (Number(i.balanceDue) || 0) >= 1)
    .sort((a, b) => b.balanceDue - a.balanceDue);
  const needs: WidgetExtras['needs'] = [
    ...lateOrders.map(({ o, t }) => ({
      title: o.customerName || o.id, detail: `${t.daysLate} day${t.daysLate === 1 ? '' : 's'} late`, tone: 'late' as const, path: '/orders',
    })),
    ...unpaid.map((i) => ({ title: i.customerName || i.id, detail: `owes ${rs(i.balanceDue)}`, tone: 'owed' as const, path: '/invoices' })),
  ].slice(0, 4);
  const recent = [...r.invoices].filter((i) => i.status !== 'Refunded' && i.createdAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 3)
    .map((i) => ({
      title: i.customerName || i.id, amount: rs(invoiceSaleValue(i)), path: '/invoices',
      when: new Date(i.createdAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' }),
    }));
  return {
    house,
    extras: {
      days, weekDelta: lastWeek >= 1 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null,
      bench: r.orders.filter((o) => isActiveOrder(o) && !awaitingTransfer(o)).length, due: today + late, late, needs, recent,
    },
    teamNote: String(r.teamNote ?? '').trim().slice(0, 600),
    updated: clock(now),
    asOf: karachiDayPeriod(now).day,
    figures: [
      { label: 'Made today', value: rs(todayRevenue), detail: 'revenue' },
      { label: 'This month', value: rs(monthRevenue), detail: 'revenue' },
      {
        label: metal === 'silver' ? 'Silver' : `Gold ${main.label}`,
        value: rate ? `Rs ${Math.round(rate).toLocaleString('en-PK')}` : 'Not set',
        detail: rate ? (ratesSetToday(r.rates.updatedAt, now) ? `a gram · ${whenSet(r.rates.updatedAt, now)}` : 'not set today') : null,
      },
      { label: 'In the drawer', value: rs(cash.netCash), detail: cash.totalIn ? `${rs(cash.totalIn)} in today` : 'nothing in yet' },
      { label: 'Owed to you', value: rs(owed.total), detail: `${owed.invoices.length} unpaid${owed.ledger ? ' + hisaab' : ''}` },
      { label: 'Due', value: String(today + late), detail: late ? `${late} late` : today ? 'all today' : 'none due' },
    ],
  };
}
