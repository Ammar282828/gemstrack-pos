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
import { todaysCash } from '@/lib/analytics/todays-cash';
import { owedToYou, type LedgerRow } from '@/lib/owed';
import { isActiveOrder, orderTiming } from '@/lib/order-timing';
import { awaitingTransfer } from '@/lib/order-stage';
import { lacCrore } from '@/lib/money';

export interface WidgetFigure { label: string; value: string; detail: string | null }
export interface WidgetSummary { house: string; updated: string; figures: WidgetFigure[] }

export interface WidgetRows {
  invoices: Invoice[];
  orders: Order[];
  repairs: Repair[];
  extraRevenues: AdditionalRevenue[];
  expenses: Expense[];
  hisaab: LedgerRow[];
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

  return {
    house,
    updated: clock(now),
    figures: [
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
