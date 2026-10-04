"use client";

/**
 * Dashboard — the morning glance (redrawn 2026-09-27; the owner: "simple and
 * effective, don't add shortcut buttons").
 *
 * Four figures say how the shop stands: taken today, this month against last,
 * owed to you, on the bench. Then three lists, each a thing the counter needs to
 * know: what needs a decision (worst first), what is due to customers (orders
 * and repairs by the date they were promised, late ones first — not by the day
 * they were taken), and the latest sales. The 30-day line sits quietly at the
 * bottom. Nothing to press but the rows themselves; New Sale lives in the
 * sidebar. It fits one desktop screen; each list scrolls inside its own frame.
 */

import { owedToYou } from '@/lib/owed';
import React, { useMemo } from 'react';
import { BoardSkeleton } from '@/components/shared/skeletons';
import Link from 'next/link';
import { useAppStore, Order, Invoice, Repair, getInvoiceRevenueDate, repairTotal } from '@/lib/store';
import { buildWorkshopJobs, UNASSIGNED_ID, CRITICAL_DAYS } from '@/lib/workshop';
import { orderTiming, isActiveOrder, timingLabel, type OrderTiming } from '@/lib/order-timing';
import { useAppReady } from '@/hooks/use-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowRight, CalendarClock, Hammer, AlertTriangle, Receipt, CheckCircle2, Wallet, CalendarDays } from 'lucide-react';
import { format, parseISO, subDays, startOfDay, startOfMonth, subMonths, differenceInCalendarDays, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { isBusinessCost } from '@/lib/partnership';
import { upcomingOccasions, occasionWhen } from '@/lib/occasions';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { useOnlineWaiting, useSellingPausedForRates } from '@/lib/website/online-client';
import { awaitingTransfer, bookedAsSale } from '@/lib/order-stage';

/** PKR at a glance. Exact value stays available on hover. */
function compactPKR(n: number): string {
  const abs = Math.abs(n);
  // 999_500 rather than 1_000_000: rounding 999,999 to the nearest thousand
  // gives "1000k", which is worse than "1M".
  if (abs >= 999_500) return `PKR ${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (abs >= 100_000) return `PKR ${Math.round(n / 1000)}k`;
  return `PKR ${n.toLocaleString()}`;
}

/** One of the four headline figures. Large enough to read across a counter. */
const Headline: React.FC<{
  label: string; value: string; sub?: string; tone?: string; href: string; icon: React.ReactNode; exact?: string;
}> = ({ label, value, sub, tone, href, icon, exact }) => (
  <Link href={href}
    className="rounded-xl border bg-card p-3 sm:p-4 hover:border-primary/40 transition-colors group min-w-0"
    title={exact}>
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <span className="flex-shrink-0">{icon}</span>
      <span className="text-2xs sm:text-xs uppercase tracking-wide truncate">{label}</span>
      <ArrowRight className="h-3.5 w-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 hidden sm:block" />
    </div>
    <p className={cn('text-xl sm:text-2xl xl:text-3xl font-bold tabular-nums mt-1 truncate', tone)}>{value}</p>
    {sub && <p className="text-2xs sm:text-xs text-muted-foreground truncate mt-0.5">{sub}</p>}
  </Link>
);

/** A row in "Needs you" — one thing waiting on a decision. */
const TaskRow: React.FC<{
  href: string; title: string; detail: string; amount?: string; tone: 'danger' | 'warn' | 'plain';
}> = ({ href, title, detail, amount, tone }) => (
  <Link href={href} className="flex items-center gap-3 py-2.5 px-1.5 rounded-md hover:bg-muted/50 transition-colors group">
    <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0',
      tone === 'danger' ? 'bg-destructive' : tone === 'warn' ? 'bg-warning' : 'bg-muted-foreground/40')} />
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium truncate">{title}</span>
      <span className="block text-xs text-muted-foreground truncate">{detail}</span>
    </span>
    {amount && <span className="text-xs font-semibold tabular-nums flex-shrink-0">{amount}</span>}
    <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
  </Link>
);

/** A promise to a customer: an order or a repair, by when it is due. */
interface Due {
  key: string;
  href: string;
  kind: 'order' | 'repair';
  id: string;
  customer: string;
  amount: number;
  timing: OrderTiming;
}

const DueRow: React.FC<{ d: Due }> = ({ d }) => {
  const t = d.timing;
  const late = t.state === 'late';
  const today = t.state === 'today';
  const when = t.due ? (late || today ? timingLabel(t) : format(t.due, 'EEE d MMM')) : t.state === 'late' ? timingLabel(t) : 'no date';
  return (
    <Link href={d.href} className="block py-2.5 px-1.5 hover:bg-muted/50 rounded-md transition-colors">
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0 translate-y-[-1px]', late ? 'bg-destructive' : today ? 'bg-warning' : 'bg-muted-foreground/40')} />
          <span className="font-semibold text-sm truncate">{d.customer}</span>
        </span>
        <span className={cn('text-xs font-medium tabular-nums flex-shrink-0', late ? 'text-destructive' : today ? 'text-warning' : 'text-muted-foreground')}>{when}</span>
      </div>
      <div className="flex items-baseline justify-between gap-3 mt-1 pl-3.5">
        <span className="text-xs text-muted-foreground truncate">{d.kind === 'repair' ? 'Repair · ' : ''}<span className="font-mono">{d.id}</span></span>
        {d.amount > 0 && <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">PKR {d.amount.toLocaleString()}</span>}
      </div>
    </Link>
  );
};

const RecentInvoiceRow: React.FC<{ invoice: Invoice }> = ({ invoice }) => (
  <Link href={`/invoices/${invoice.id}`} className="block py-2.5 px-1.5 hover:bg-muted/50 rounded-md transition-colors">
    <div className="flex items-baseline justify-between gap-3 min-w-0">
      <span className="font-semibold text-sm truncate">{invoice.customerName || 'Walk-in'}</span>
      <span className={cn('text-sm font-semibold tabular-nums flex-shrink-0', (invoice.balanceDue || 0) > 0 && 'text-warning')}>
        {compactPKR(invoiceSaleValue(invoice))}
      </span>
    </div>
    <div className="flex items-baseline justify-between gap-3 mt-1">
      <span className="text-xs text-muted-foreground truncate">{format(parseISO(invoice.createdAt), 'EEE d MMM')}</span>
      {(invoice.balanceDue || 0) > 0 && (
        <span className="text-xs text-warning tabular-nums flex-shrink-0">
          {invoice.balanceDue >= (invoice.grandTotal || 0) ? 'unpaid' : `${compactPKR(invoice.balanceDue)} due`}
        </span>
      )}
    </div>
  </Link>
);

/** A panel that scrolls inside itself so the board keeps its height. */
const Panel: React.FC<{
  title: string; icon: React.ReactNode; href?: string; count?: number; children: React.ReactNode;
}> = ({ title, icon, href, count, children }) => (
  <Card className="flex flex-col lg:min-h-0 overflow-hidden">
    <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center gap-2 justify-between space-y-0 flex-shrink-0">
      <CardTitle className="text-sm font-semibold flex items-center gap-1.5 min-w-0">
        <span className="flex-shrink-0 text-muted-foreground">{icon}</span>
        <span className="truncate">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="flex-shrink-0 text-2xs font-normal text-muted-foreground tabular-nums">{count}</span>
        )}
      </CardTitle>
      {href && (
        <Link href={href} className="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5">All <ArrowRight className="h-3.5 w-3.5" /></Link>
      )}
    </CardHeader>
    <CardContent className="flex-1 lg:min-h-0 overflow-y-auto px-3 pb-3 pt-0">{children}</CardContent>
  </Card>
);

/** Late first, then today, then soonest, then the undated by age. */
const dueOrder = (t: OrderTiming) => (t.state === 'late' ? 0 : t.state === 'today' ? 1 : t.due ? 2 : 3);

export default function HomePage() {
  const appReady = useAppReady();
  const {
    loadProducts, orders, loadOrders,
    generatedInvoices, loadGeneratedInvoices,
    additionalRevenues, loadAdditionalRevenues,
    expenses, loadExpenses,
    karigars, loadKarigars, karigarJobs, loadKarigarJobs,
    customers, loadCustomers,
    repairs, loadRepairs,
    hisaabEntries, loadHisaab,
    settings,
  } = useAppStore(state => ({
    loadProducts: state.loadProducts,
    orders: state.orders,
    loadOrders: state.loadOrders,
    generatedInvoices: state.generatedInvoices,
    loadGeneratedInvoices: state.loadGeneratedInvoices,
    additionalRevenues: state.additionalRevenues,
    loadAdditionalRevenues: state.loadAdditionalRevenues,
    expenses: state.expenses,
    loadExpenses: state.loadExpenses,
    karigars: state.karigars,
    loadKarigars: state.loadKarigars,
    karigarJobs: state.karigarJobs,
    loadKarigarJobs: state.loadKarigarJobs,
    customers: state.customers,
    loadCustomers: state.loadCustomers,
    repairs: state.repairs,
    loadRepairs: state.loadRepairs,
    hisaabEntries: state.hisaabEntries,
    loadHisaab: state.loadHisaab,
    settings: state.settings,
  }));

  React.useEffect(() => {
    if (!appReady) return;
    loadProducts(); loadOrders(); loadGeneratedInvoices();
    loadAdditionalRevenues(); loadExpenses(); loadKarigars(); loadKarigarJobs();
    loadCustomers(); loadRepairs(); loadHisaab();
  }, [appReady, loadProducts, loadOrders, loadGeneratedInvoices,
      loadAdditionalRevenues, loadExpenses, loadKarigars, loadKarigarJobs, loadCustomers, loadRepairs, loadHisaab]);

  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const monthStart = startOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    // "last 30 days" = today plus 29 prior full days, matching Analytics.
    const last30Start = startOfDay(subDays(now, 29));
    const ordersById = new Map(orders.map(o => [o.id, o]));

    // Revenue recognised on the source order's date (getInvoiceRevenueDate), between two instants.
    const rev = (from: Date, to: Date = new Date(8.64e15)) => {
      const inWindow = (d: Date) => d >= from && d < to;
      return generatedInvoices.filter(i => i.status !== 'Refunded' && inWindow(parseISO(getInvoiceRevenueDate(i, ordersById))))
        .reduce((s, i) => s + invoiceSaleValue(i), 0)
      + orders.filter(o => bookedAsSale(o) && inWindow(parseISO(o.createdAt)))
        .reduce((s, o) => s + (o.subtotal || 0), 0)
      + additionalRevenues.filter(r => inWindow(parseISO(r.date))).reduce((s, r) => s + (r.amount || 0), 0);
    };

    const todayInvoices = generatedInvoices.filter(i =>
      i.status !== 'Refunded' && parseISO(getInvoiceRevenueDate(i, ordersById)) >= todayStart);

    // What customers owe: the one selector the customer list, Invoices and Hisaab read too (lib/owed.ts),
    // with what the hisaab holds by hand (the old khata) added.
    const owed = owedToYou(generatedInvoices, undefined, Array.isArray(hisaabEntries) ? hisaabEntries : []);
    const unpaid = [...owed.invoices].sort((a, b) => (b.balanceDue || 0) - (a.balanceDue || 0));
    const totalOutstanding = owed.total;

    const jobs = buildWorkshopJobs(orders, karigarJobs, karigars, { invoices: generatedInvoices });
    const activeJobs = jobs.filter(j => j.status !== 'completed');
    const criticalJobs = activeJobs.filter(j => j.urgency === 'critical').sort((a, b) => b.ageDays - a.ageDays);
    const unassignedJobs = activeJobs.filter(j => j.karigarId === UNASSIGNED_ID);

    // What is due to customers: open orders and repairs still in the shop, by their promise.
    const due: Due[] = [
      // An online order waiting for its transfer is owed nothing yet (lib/order-stage.ts).
      ...orders.filter(o => isActiveOrder(o) && !awaitingTransfer(o)).map((o: Order): Due => ({
        key: `o${o.id}`, href: `/orders/${o.id}`, kind: 'order', id: o.id, customer: o.customerName || 'Walk-in',
        amount: typeof o.grandTotal === 'number' ? o.grandTotal : 0, timing: orderTiming(o, now),
      })),
      ...repairs.filter(r => r.status === 'received').map((r: Repair): Due => ({
        key: `r${r.id}`, href: `/repairs?id=${encodeURIComponent(r.id)}`, kind: 'repair', id: r.id, customer: r.customerName || 'Walk-in',
        amount: repairTotal(r), timing: orderTiming({ promisedDate: r.promisedDate, createdAt: r.receivedAt, status: 'In Progress' }, now),
      })),
    ].sort((a, b) => dueOrder(a.timing) - dueOrder(b.timing)
      || (a.timing.due && b.timing.due ? a.timing.due.getTime() - b.timing.due.getTime() : 0)
      || b.timing.daysLate - a.timing.daysLate);
    const lateDue = due.filter(d => d.timing.state === 'late');
    const todayDue = due.filter(d => d.timing.state === 'today');

    // Repairs finished but not collected for a while — the customer needs a call.
    const readyWaiting = repairs.filter(r => r.status === 'ready' && r.readyAt && isValid(parseISO(r.readyAt)) && differenceInCalendarDays(now, parseISO(r.readyAt)) >= 3);

    const revenue30 = rev(last30Start);
    // net30 is a profit figure, so partner drawings stay out of it.
    const expenses30 = expenses.filter(e => parseISO(e.date) >= last30Start && isBusinessCost(e))
      .reduce((s, e) => s + (e.amount || 0), 0);

    return {
      todayRevenue: rev(todayStart),
      todayInvoiceCount: todayInvoices.length,
      monthRevenue: rev(monthStart),
      lastMonthRevenue: rev(lastMonthStart, monthStart),
      unpaid, totalOutstanding, owedInHisaab: owed.ledger,
      activeJobs, criticalJobs, unassignedJobs,
      due, lateDue, todayDue, readyWaiting,
      revenue30, expenses30, net30: revenue30 - expenses30,
      recentInvoices: [...generatedInvoices]
        .sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime())
        .slice(0, 12),
    };
  }, [orders, generatedInvoices, additionalRevenues, expenses, karigars, karigarJobs, repairs, hisaabEntries]);

  /**
   * Everything actually waiting on a decision, worst first — grouped, not
   * enumerated: one row per karigar with overdue pieces, the late promises as
   * one row (the Due list names them), the three largest unpaid then the rest
   * summed, repairs sitting ready, and the week's birthdays and anniversaries.
   */
  const onlineWaiting = useOnlineWaiting();
  const ratePause = useSellingPausedForRates();
  const tasks = useMemo(() => {
    const out: React.ComponentProps<typeof TaskRow>[] = [];

    // taheri.shop sells only at a rate set in the last 36 hours (lib/website/config.ts ratesFresh).
    if (ratePause) {
      out.push({
        href: '/settings?tab=rates', tone: 'danger',
        title: "Set today's gold rate — online selling is paused",
        detail: ratePause.ratesUpdatedAt ? `Last set ${new Date(ratePause.ratesUpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · the rate chip at the top` : 'The rate chip at the top',
      });
    }

    // An online order nobody has looked at: the customer is waiting for the bank details.
    if (onlineWaiting > 0) {
      out.push({
        href: '/orders', tone: 'danger',
        title: onlineWaiting === 1 ? 'An online order to confirm' : `${onlineWaiting} online orders to confirm`,
        detail: 'From taheri.shop · they get the bank details when you confirm',
      });
    }

    if (stats.lateDue.length) {
      const worst = stats.lateDue[0];
      out.push({
        href: worst.href, tone: 'danger',
        title: stats.lateDue.length === 1 ? `${worst.customer}’s ${worst.kind} is late` : `${stats.lateDue.length} promises past their date`,
        detail: stats.lateDue.length === 1 ? timingLabel(worst.timing) : `Longest: ${worst.customer}, ${timingLabel(worst.timing)}`,
      });
    }

    const byKarigar = new Map<string, { name: string; count: number; oldest: number }>();
    for (const j of stats.criticalJobs) {
      // Work with nobody on it gets its own row below.
      if (j.karigarId === UNASSIGNED_ID) continue;
      const key = j.karigarId || j.karigarName;
      const cur = byKarigar.get(key) || { name: j.karigarName, count: 0, oldest: 0 };
      cur.count += 1;
      cur.oldest = Math.max(cur.oldest, j.ageDays);
      byKarigar.set(key, cur);
    }
    for (const k of [...byKarigar.values()].sort((a, b) => b.oldest - a.oldest).slice(0, 4)) {
      out.push({
        href: '/workshop', tone: 'danger', title: k.name,
        detail: k.count === 1 ? `1 piece, ${k.oldest} days on the bench` : `${k.count} pieces overdue · longest ${k.oldest} days`,
      });
    }
    if (stats.unassignedJobs.length) {
      out.push({
        href: '/workshop', tone: 'danger',
        title: `${stats.unassignedJobs.length} unassigned piece${stats.unassignedJobs.length === 1 ? '' : 's'}`,
        detail: 'Nobody is making these yet',
      });
    }

    for (const inv of stats.unpaid.slice(0, 3)) {
      out.push({
        href: `/invoices/${inv.id}`, tone: 'warn',
        title: inv.customerName || 'Walk-in',
        detail: `Unpaid since ${format(parseISO(inv.createdAt), 'd MMM')}`,
        amount: compactPKR(inv.balanceDue || 0),
      });
    }
    const rest = stats.unpaid.slice(3);
    if (rest.length) {
      out.push({
        href: '/invoices', tone: 'warn',
        title: `${rest.length} more unpaid`, detail: 'Smaller balances',
        amount: compactPKR(rest.reduce((s, i) => s + (i.balanceDue || 0), 0)),
      });
    }

    for (const r of stats.readyWaiting.slice(0, 3)) {
      out.push({
        href: `/repairs?id=${encodeURIComponent(r.id)}`, tone: 'warn',
        title: `${r.customerName || 'Walk-in'}’s repair is ready`,
        detail: `Waiting to be collected since ${format(parseISO(r.readyAt!), 'd MMM')}`,
      });
    }

    for (const o of upcomingOccasions(customers).slice(0, 4)) {
      out.push({
        href: `/customers/${o.customerId}`, tone: o.inDays <= 1 ? 'warn' : 'plain',
        title: o.customerName, detail: `${o.kind === 'birthday' ? 'Birthday' : 'Anniversary'} ${occasionWhen(o.inDays)}`,
      });
    }

    return out;
  }, [stats, customers, onlineWaiting, ratePause]);

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <BoardSkeleton tiles={4} panels={3} />
      </div>
    );
  }

  const monthSub = stats.lastMonthRevenue > 0 ? `Last month ${compactPKR(stats.lastMonthRevenue)}` : format(new Date(), 'MMMM');

  return (
    <div className="container mx-auto px-3 py-4 md:px-4 space-y-4 lg:h-[calc(100dvh-6.5rem)] lg:flex lg:flex-col lg:space-y-4 lg:overflow-hidden">

      <header className="flex-shrink-0 min-w-0">
        <h1 className="text-2xl md:text-3xl font-bold text-primary truncate">{settings?.shopName || 'Dashboard'}</h1>
        <p className="text-sm text-muted-foreground">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
      </header>

      {/* Two by two until the board is wide enough for four; the labels were truncating at four across a laptop. */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3 flex-shrink-0">
        <Headline label="Taken today" href="/invoices" icon={<Wallet className="h-4 w-4" />}
          value={compactPKR(stats.todayRevenue)} exact={`PKR ${stats.todayRevenue.toLocaleString()}`}
          tone={stats.todayRevenue > 0 ? 'text-success' : undefined}
          sub={`${stats.todayInvoiceCount} invoice${stats.todayInvoiceCount === 1 ? '' : 's'} today`} />
        <Headline label="This month" href="/analytics" icon={<CalendarDays className="h-4 w-4" />}
          value={compactPKR(stats.monthRevenue)} exact={`PKR ${stats.monthRevenue.toLocaleString()}`}
          sub={monthSub} />
        <Headline label="Owed to you" href={stats.owedInHisaab > 0 ? '/hisaab' : '/invoices'} icon={<Receipt className="h-4 w-4" />}
          value={stats.totalOutstanding > 0 ? compactPKR(stats.totalOutstanding) : 'Nil'}
          exact={stats.owedInHisaab > 0
            ? `PKR ${stats.totalOutstanding.toLocaleString()} — invoices ${(stats.totalOutstanding - stats.owedInHisaab).toLocaleString()}, hisaab ${stats.owedInHisaab.toLocaleString()}`
            : `PKR ${stats.totalOutstanding.toLocaleString()}`}
          tone={stats.totalOutstanding > 0 ? 'text-destructive' : undefined}
          sub={stats.owedInHisaab > 0 ? `${stats.unpaid.length} unpaid · ${compactPKR(stats.owedInHisaab).replace(/^PKR\s*/, '')} hisaab` : `${stats.unpaid.length} unpaid`} />
        <Headline label="On the bench" href="/workshop" icon={<Hammer className="h-4 w-4" />}
          value={`${stats.activeJobs.length} piece${stats.activeJobs.length === 1 ? '' : 's'}`}
          tone={stats.criticalJobs.length > 0 ? 'text-destructive' : undefined}
          sub={stats.criticalJobs.length > 0 ? `${stats.criticalJobs.length} sitting ${CRITICAL_DAYS}+ days` : 'Nothing overdue'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:flex-1 lg:min-h-0">

        <Panel title="Needs you" count={tasks.length}
          icon={<AlertTriangle className={cn('h-4 w-4', tasks.length ? 'text-destructive' : 'text-muted-foreground')} />}>
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
              <p className="text-sm">Nothing late, unpaid or waiting.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {tasks.map((t, i) => <TaskRow key={`${t.href}-${i}`} {...t} />)}
            </div>
          )}
        </Panel>

        <Panel title="Due to customers" icon={<CalendarClock className="h-4 w-4" />} href="/orders" count={stats.due.length}>
          {stats.due.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No open orders or repairs.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {stats.due.map(d => <DueRow key={d.key} d={d} />)}
            </div>
          )}
        </Panel>

        <Panel title="Recent sales" icon={<Receipt className="h-4 w-4" />} href="/invoices">
          {stats.recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No sales yet.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {stats.recentInvoices.map(i => <RecentInvoiceRow key={i.id} invoice={i} />)}
            </div>
          )}
        </Panel>
      </div>

      <Link href="/analytics"
        className="flex-shrink-0 flex items-center gap-x-6 gap-y-1 flex-wrap rounded-lg border bg-card px-4 py-2.5 text-sm hover:border-primary/40 transition-colors group">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Last 30 days</span>
        <span className="tabular-nums">Revenue <span className="font-semibold text-success">{compactPKR(stats.revenue30)}</span></span>
        <span className="tabular-nums">Expenses <span className="font-semibold text-destructive">{compactPKR(stats.expenses30)}</span></span>
        <span className="tabular-nums">Net <span className={cn('font-semibold', stats.net30 >= 0 ? 'text-primary' : 'text-destructive')}>{compactPKR(stats.net30)}</span></span>
        <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </Link>
    </div>
  );
}
