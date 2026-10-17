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
import { ChevronRight, CheckCircle2, Globe, Hammer, CalendarClock, Gem, Receipt, Cake, Wrench, Coins, UserX } from 'lucide-react';
import { DateLeaf, EmptyState, FigureTile, HeroAmount, LedgerSection, Monogram, Pill, toneClasses, type Tone } from '@/components/ledger';
import { lacCrore } from '@/lib/money';
import { format, parseISO, subDays, startOfDay, startOfMonth, subMonths, differenceInCalendarDays, isValid } from 'date-fns';
import { cn } from '@/lib/utils';
import { isBusinessCost } from '@/lib/partnership';
import { upcomingOccasions, occasionWhen } from '@/lib/occasions';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { revenueForPeriod } from '@/lib/analytics/revenue-period';
import { useOnlineWaiting, useSellingPausedForRates } from '@/lib/website/online-client';
import { awaitingTransfer, bookedAsSale } from '@/lib/order-stage';
import { owesMoney } from '@/lib/money';

/** PKR at a glance, in lac and crore (lib/money.ts); the exact value stays on hover. */
function compactPKR(n: number): string {
  return `PKR ${lacCrore(n)}`;
}

/** A row's trailing disclosure: the system chevron. */
const Chevron = () => <ChevronRight aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />;

const ROW = 'flex min-h-[56px] items-center gap-3 py-3 transition-colors active:bg-muted/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40';

/** A row in "Needs you": an icon tile in the tone, a title, a caption. One thing waiting on a decision. */
const TaskRow: React.FC<{
  href: string; title: string; detail: string; amount?: string; tone: Tone; icon: React.ComponentType<{ className?: string }>;
}> = ({ href, title, detail, amount, tone, icon: Icon }) => (
  <Link href={href} className={ROW}>
    <span aria-hidden className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[30%]', toneClasses(tone).tint10, toneClasses(tone).ink)}>
      <Icon className="h-5 w-5" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-ios-sub font-semibold text-foreground">{title}</span>
      <span className="block truncate text-ios-foot text-muted-foreground">{detail}</span>
    </span>
    {amount && <span className="flex-shrink-0 text-ios-sub font-semibold tabular-nums">{amount}</span>}
    <Chevron />
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
  const tone: Tone = t.state === 'late' ? 'late' : t.state === 'today' ? 'owed' : 'quiet';
  const when = t.due ? (t.state === 'late' || t.state === 'today' ? timingLabel(t) : '') : t.state === 'late' ? timingLabel(t) : 'no date';
  return (
    <Link href={d.href} className={ROW}>
      {t.due ? (
        <DateLeaf date={t.due} tone={tone} size={44} />
      ) : (
        <span aria-hidden className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-leaf bg-muted-foreground/10 text-muted-foreground"><CalendarClock className="h-5 w-5" /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ios-sub font-semibold text-foreground">{d.customer}</span>
        <span className="block truncate text-ios-foot text-muted-foreground">
          {d.kind === 'repair' ? 'Repair · ' : ''}{d.id}
          {when && <span className={cn('font-medium', tone !== 'quiet' && toneClasses(tone).ink)}> · {when}</span>}
        </span>
      </span>
      {d.amount > 0 && <span className="flex-shrink-0 text-ios-sub font-semibold tabular-nums">{compactPKR(d.amount)}</span>}
      <Chevron />
    </Link>
  );
};

const RecentInvoiceRow: React.FC<{ invoice: Invoice }> = ({ invoice }) => {
  const owing = owesMoney(invoice.balanceDue);
  return (
    <Link href={`/invoices/${invoice.id}`} className={ROW}>
      <Monogram name={invoice.customerName || 'Walk-in'} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ios-sub font-semibold text-foreground">{invoice.customerName || 'Walk-in'}</span>
        <span className="block truncate text-ios-foot text-muted-foreground">{format(parseISO(invoice.createdAt), 'EEE d MMM')}</span>
      </span>
      <span className="flex flex-shrink-0 flex-col items-end gap-1">
        <span className="text-ios-sub font-semibold tabular-nums">{compactPKR(invoiceSaleValue(invoice))}</span>
        {owing && (
          <Pill tone="owed">{invoice.balanceDue >= (invoice.grandTotal || 0) ? 'Unpaid' : `${compactPKR(invoice.balanceDue)} due`}</Pill>
        )}
      </span>
      <Chevron />
    </Link>
  );
};

/** "Show n more" under a list that shows its first three. */
const ShowMore: React.FC<{ hidden: number; onClick: () => void }> = ({ hidden, onClick }) => (
  <button type="button" onClick={onClick} className="flex min-h-11 w-full items-center text-ios-sub font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
    Show {hidden} more
  </button>
);

/** A figure that opens its screen: the tile, made a link. */
const TileLink: React.FC<{ href: string; title?: string; children: React.ReactNode }> = ({ href, title, children }) => (
  <Link href={href} title={title} className="block min-w-0 rounded-card transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:opacity-80">{children}</Link>
);

const SHOWN = 3;

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
    const ordersById = new Map(orders.map(o => [o.id, o]));

    // Revenue recognised on the source order's date (getInvoiceRevenueDate), between two instants.
    const rev = (from: Date, to?: Date) => revenueForPeriod({ invoices: generatedInvoices, orders, extraRevenues: additionalRevenues }, from, to);

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

    const revenueMonth = rev(monthStart);
    // netMonth is a profit figure, so partner drawings stay out of it.
    const expensesMonth = expenses.filter(e => parseISO(e.date) >= monthStart && isBusinessCost(e))
      .reduce((s, e) => s + (e.amount || 0), 0);

    return {
      todayRevenue: rev(todayStart),
      todayInvoiceCount: todayInvoices.length,
      monthRevenue: rev(monthStart),
      lastMonthRevenue: rev(lastMonthStart, monthStart),
      unpaid, totalOutstanding, owedInHisaab: owed.ledger,
      activeJobs, criticalJobs, unassignedJobs,
      due, lateDue, todayDue, readyWaiting,
      revenueMonth, expensesMonth, netMonth: revenueMonth - expensesMonth,
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
        href: '/settings?tab=rates', tone: 'late', icon: Coins,
        title: "Set today's gold rate — online selling is paused",
        detail: ratePause.ratesUpdatedAt ? `Last set ${new Date(ratePause.ratesUpdatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · the rate chip at the top` : 'The rate chip at the top',
      });
    }

    // An online order nobody has looked at: the customer is waiting for the bank details.
    if (onlineWaiting > 0) {
      out.push({
        href: '/orders', tone: 'late', icon: Globe,
        title: onlineWaiting === 1 ? 'An online order to confirm' : `${onlineWaiting} online orders to confirm`,
        detail: 'From taheri.shop · they get the bank details when you confirm',
      });
    }

    if (stats.lateDue.length) {
      const worst = stats.lateDue[0];
      out.push({
        href: worst.href, tone: 'late', icon: CalendarClock,
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
        href: '/workshop', tone: 'late', icon: Hammer, title: k.name,
        detail: k.count === 1 ? `1 piece, ${k.oldest} days on the bench` : `${k.count} pieces overdue · longest ${k.oldest} days`,
      });
    }
    if (stats.unassignedJobs.length) {
      out.push({
        href: '/workshop', tone: 'late', icon: UserX,
        title: `${stats.unassignedJobs.length} unassigned piece${stats.unassignedJobs.length === 1 ? '' : 's'}`,
        detail: 'Nobody is making these yet',
      });
    }

    for (const inv of stats.unpaid.slice(0, 3)) {
      out.push({
        href: `/invoices/${inv.id}`, tone: 'owed', icon: Receipt,
        title: inv.customerName || 'Walk-in',
        detail: `Unpaid since ${format(parseISO(inv.createdAt), 'd MMM')}`,
        amount: compactPKR(inv.balanceDue || 0),
      });
    }
    const rest = stats.unpaid.slice(3);
    if (rest.length) {
      out.push({
        href: '/invoices', tone: 'owed', icon: Receipt,
        title: `${rest.length} more unpaid`, detail: 'Smaller balances',
        amount: compactPKR(rest.reduce((s, i) => s + (i.balanceDue || 0), 0)),
      });
    }

    for (const r of stats.readyWaiting.slice(0, 3)) {
      out.push({
        href: `/repairs?id=${encodeURIComponent(r.id)}`, tone: 'owed', icon: Wrench,
        title: `${r.customerName || 'Walk-in'}’s repair is ready`,
        detail: `Waiting to be collected since ${format(parseISO(r.readyAt!), 'd MMM')}`,
      });
    }

    for (const o of upcomingOccasions(customers).slice(0, 4)) {
      out.push({
        href: `/customers/${o.customerId}`, tone: o.inDays <= 1 ? 'owed' : 'quiet', icon: Cake,
        title: o.customerName, detail: `${o.kind === 'birthday' ? 'Birthday' : 'Anniversary'} ${occasionWhen(o.inDays)}`,
      });
    }

    return out;
  }, [stats, customers, onlineWaiting, ratePause]);

  const [moreNeeds, setMoreNeeds] = React.useState(false);
  const [moreDue, setMoreDue] = React.useState(false);

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <BoardSkeleton tiles={4} panels={3} />
      </div>
    );
  }

  const monthSub = stats.lastMonthRevenue > 0 ? `Last month ${compactPKR(stats.lastMonthRevenue)}` : format(new Date(), 'MMMM');
  const lastSale = stats.recentInvoices[0];
  const lastSaleToday = !!lastSale && startOfDay(parseISO(lastSale.createdAt)).getTime() === startOfDay(new Date()).getTime();
  const shownTasks = moreNeeds ? tasks : tasks.slice(0, SHOWN);
  const shownDue = moreDue ? stats.due : stats.due.slice(0, SHOWN);

  const needs = (
    <LedgerSection title="Needs you" count={tasks.length || undefined}>
      {tasks.length === 0 ? (
        <EmptyState icon={<CheckCircle2 className="text-tone-settled" />} title="All clear" description="Nothing late, unpaid or waiting." className="py-8" />
      ) : (
        <>
          {shownTasks.map((t, i) => <TaskRow key={`${t.href}-${i}`} {...t} />)}
          {tasks.length > SHOWN && !moreNeeds && <ShowMore hidden={tasks.length - SHOWN} onClick={() => setMoreNeeds(true)} />}
        </>
      )}
    </LedgerSection>
  );

  const dueList = (
    <LedgerSection
      title="Due to customers"
      count={stats.due.length || undefined}
      tone={stats.lateDue.length ? 'late' : undefined}
      trailing={<Link href="/orders" className="inline-flex items-center gap-0.5 hover:text-foreground">All<ChevronRight aria-hidden className="h-3.5 w-3.5" /></Link>}
    >
      {stats.due.length === 0 ? (
        <EmptyState icon={<CalendarClock />} title="Nothing due" description="No open orders or repairs." className="py-8" />
      ) : (
        <>
          {shownDue.map(d => <DueRow key={d.key} d={d} />)}
          {stats.due.length > SHOWN && !moreDue && <ShowMore hidden={stats.due.length - SHOWN} onClick={() => setMoreDue(true)} />}
        </>
      )}
    </LedgerSection>
  );

  const sales = (
    <LedgerSection
      title="Recent sales"
      trailing={<Link href="/invoices" className="inline-flex items-center gap-0.5 hover:text-foreground">All<ChevronRight aria-hidden className="h-3.5 w-3.5" /></Link>}
    >
      {stats.recentInvoices.length === 0 ? (
        <EmptyState icon={<Gem />} title="No sales yet" className="py-8" />
      ) : (
        stats.recentInvoices.map(i => <RecentInvoiceRow key={i.id} invoice={i} />)
      )}
    </LedgerSection>
  );

  const month = (
    <LedgerSection title="This month" collapsible defaultOpen={false}>
      <Link href="/analytics" className={cn(ROW, 'justify-between')}><span className="text-ios-sub text-muted-foreground">Revenue</span><span className="text-ios-sub font-semibold tabular-nums text-tone-settled-ink">{compactPKR(stats.revenueMonth)}</span></Link>
      <Link href="/analytics" className={cn(ROW, 'justify-between')}><span className="text-ios-sub text-muted-foreground">Expenses</span><span className="text-ios-sub font-semibold tabular-nums">{compactPKR(stats.expensesMonth)}</span></Link>
      <Link href="/analytics" className={cn(ROW, 'justify-between')}><span className="text-ios-sub text-muted-foreground">Net</span><span className={cn('text-ios-sub font-semibold tabular-nums', stats.netMonth >= 0 ? 'text-foreground' : 'text-tone-late-ink')}>{compactPKR(stats.netMonth)}</span></Link>
    </LedgerSection>
  );

  return (
    <div className="container mx-auto max-w-[1240px] space-y-5 px-4 py-5 md:py-6">

      <header className="min-w-0 space-y-0.5">
        <p className="text-ios-cap font-semibold uppercase tracking-[.8px] text-muted-foreground">{format(new Date(), 'EEEE, d MMMM')}</p>
        <h1 className="truncate text-ios-large font-bold text-foreground">{settings?.shopName || 'Dashboard'}</h1>
      </header>

      {/* The glance: what was taken today, then three figures. Wide, they sit across in one row. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <TileLink href="/invoices" title={`PKR ${stats.todayRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}>
          <div className="h-full rounded-card bg-card p-4">
            <p className="text-ios-sub text-muted-foreground">Taken today</p>
            <HeroAmount amount={stats.todayRevenue} lac tone={stats.todayRevenue > 0 ? 'settled' : undefined} className="mt-1" />
            <p className="mt-1 text-ios-foot text-muted-foreground">
              {stats.todayInvoiceCount} invoice{stats.todayInvoiceCount === 1 ? '' : 's'} today
              {lastSaleToday && lastSale && ` · last at ${format(parseISO(lastSale.createdAt), 'h:mm a').toLowerCase()}`}
            </p>
          </div>
        </TileLink>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3 lg:col-span-3">
          <TileLink href="/analytics" title={`PKR ${stats.monthRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}>
            <FigureTile className="h-full" label="This month" value={stats.monthRevenue} detail={monthSub} />
          </TileLink>
          <TileLink
            href={stats.owedInHisaab > 0 ? '/hisaab' : '/invoices'}
            title={stats.owedInHisaab > 0
              ? `PKR ${stats.totalOutstanding.toLocaleString(undefined, { maximumFractionDigits: 0 })} — invoices ${(stats.totalOutstanding - stats.owedInHisaab).toLocaleString(undefined, { maximumFractionDigits: 0 })}, hisaab ${stats.owedInHisaab.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
              : `PKR ${stats.totalOutstanding.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          >
            <FigureTile
              className="h-full" label="Owed to you" tint={stats.totalOutstanding > 0 ? 'owed' : undefined}
              value={stats.totalOutstanding > 0 ? stats.totalOutstanding : 'Nil'}
              detail={stats.owedInHisaab > 0 ? `${stats.unpaid.length} unpaid · ${lacCrore(stats.owedInHisaab)} in hisaab` : `${stats.unpaid.length} unpaid`}
            />
          </TileLink>
          <TileLink href="/workshop">
            <FigureTile
              className="h-full" label="On the bench" tint={stats.criticalJobs.length > 0 ? 'late' : undefined}
              value={`${stats.activeJobs.length} piece${stats.activeJobs.length === 1 ? '' : 's'}`}
              detail={stats.criticalJobs.length > 0 ? `${stats.criticalJobs.length} sitting ${CRITICAL_DAYS}+ days` : 'Nothing overdue'}
            />
          </TileLink>
        </div>
      </div>

      {/* Phone: one column, in the app's order. Wide: needs + due beside sales + the month. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
        <div className="space-y-5">{needs}{dueList}</div>
        <div className="space-y-5">{sales}{month}</div>
      </div>
    </div>
  );
}
