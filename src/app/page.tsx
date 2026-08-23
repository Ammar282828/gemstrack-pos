"use client";

/**
 * Dashboard.
 *
 * A shop dashboard should answer "what needs me today", not just recite
 * totals. Three figures carry the money picture, one list carries the work
 * that is actually waiting on a decision, and the 30-day P&L sits quietly at
 * the bottom where it belongs. It fits one desktop screen; each list scrolls
 * inside its own frame rather than the page scrolling as a whole.
 */

import React, { useMemo } from 'react';
import { BoardSkeleton } from '@/components/shared/skeletons';
import Link from 'next/link';
import {
  useAppStore, selectCartDetails, Order, Invoice, getInvoiceRevenueDate,
} from '@/lib/store';
import { buildWorkshopJobs, UNASSIGNED_ID, CRITICAL_DAYS } from '@/lib/workshop';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ClipboardList, FileText, ArrowRight, Clock, Hammer,
  AlertTriangle, Receipt, CheckCircle2, Wallet,
} from 'lucide-react';
import { format, parseISO, subDays, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { isBusinessCost } from '@/lib/partnership';

/** PKR at a glance. Exact value stays available on hover. */
function compactPKR(n: number): string {
  const abs = Math.abs(n);
  // 999_500 rather than 1_000_000: rounding 999,999 to the nearest thousand
  // gives "1000k", which is worse than "1M".
  if (abs >= 999_500) return `PKR ${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (abs >= 100_000) return `PKR ${Math.round(n / 1000)}k`;
  return `PKR ${n.toLocaleString()}`;
}

/** One of the three headline figures. Large enough to read across a counter. */
const Headline: React.FC<{
  label: string; value: string; sub?: string; tone?: string; href: string; icon: React.ReactNode; exact?: string;
}> = ({ label, value, sub, tone, href, icon, exact }) => (
  <Link href={href}
    className="rounded-xl border bg-card p-5 hover:border-primary/40 transition-colors group min-w-0"
    title={exact}>
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <span className="text-xs uppercase tracking-wide truncate">{label}</span>
      <ArrowRight className="h-3.5 w-3.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </div>
    <p className={cn('text-2xl xl:text-3xl font-bold tabular-nums mt-1.5 truncate', tone)}>{value}</p>
    {sub && <p className="text-xs text-muted-foreground truncate mt-0.5">{sub}</p>}
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

const OngoingOrderRow: React.FC<{ order: Order }> = ({ order }) => {
  const grandTotal = typeof order.grandTotal === 'number' ? order.grandTotal : 0;
  return (
    /* Status is a dot and a quiet word, not a saturated filled pill. Twenty
       solid badges down a narrow column drowned out the orders themselves. */
    <Link href={`/orders/${order.id}`} className="block py-2.5 px-1.5 hover:bg-muted/50 rounded-md transition-colors group">
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0 translate-y-[-1px]',
            order.status === 'Pending' ? 'bg-warning' : 'bg-blue-500')} />
          <span className="font-semibold text-sm font-mono truncate">{order.id}</span>
        </span>
        <span className="text-sm font-semibold tabular-nums flex-shrink-0">
          PKR {grandTotal.toLocaleString()}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3 mt-1 pl-3.5">
        <span className="text-xs text-muted-foreground truncate">
          {order.status} · {order.customerName || 'Walk-in'}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
          {format(parseISO(order.createdAt), 'd MMM')}
        </span>
      </div>
    </Link>
  );
};

const RecentInvoiceRow: React.FC<{ invoice: Invoice }> = ({ invoice }) => (
  <Link href={`/view-invoice?invoiceId=${invoice.id}`} className="block py-2.5 px-1.5 hover:bg-muted/50 rounded-md transition-colors group">
    <div className="flex items-baseline justify-between gap-3 min-w-0">
      <span className="font-semibold text-sm truncate">{invoice.customerName || 'Walk-in'}</span>
      <span className="text-sm font-semibold tabular-nums flex-shrink-0">
        PKR {(invoice.grandTotal || 0).toLocaleString()}
      </span>
    </div>
    <div className="flex items-baseline justify-between gap-3 mt-1">
      <span className="text-xs text-muted-foreground truncate">{format(parseISO(invoice.createdAt), 'd MMM, h:mm a')}</span>
      {(invoice.balanceDue || 0) > 0 && (
        <span className="text-xs text-warning tabular-nums flex-shrink-0">
          PKR {invoice.balanceDue.toLocaleString()} due
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
    {/* Every part of this header shrinks or truncates: at a third of the
        board's width, "Ongoing Orders" was wrapping onto two lines and
        shoving the count and the All link out of alignment. */}
    <CardHeader className="pb-2 px-4 pt-4 flex flex-row items-center gap-2 justify-between space-y-0 flex-shrink-0">
      <CardTitle className="text-sm font-semibold flex items-center gap-1.5 min-w-0">
        <span className="flex-shrink-0 text-muted-foreground">{icon}</span>
        <span className="truncate">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="flex-shrink-0 text-2xs font-normal text-muted-foreground tabular-nums">{count}</span>
        )}
      </CardTitle>
      {href && (
        <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs flex-shrink-0">
          <Link href={href}>All <ArrowRight className="ml-0.5 h-3.5 w-3.5" /></Link>
        </Button>
      )}
    </CardHeader>
    <CardContent className="flex-1 lg:min-h-0 overflow-y-auto px-3 pb-3 pt-0">{children}</CardContent>
  </Card>
);

export default function HomePage() {
  const appReady = useAppReady();
  const {
    loadProducts, orders, loadOrders,
    generatedInvoices, loadGeneratedInvoices,
    additionalRevenues, loadAdditionalRevenues,
    expenses, loadExpenses,
    karigars, loadKarigars, karigarJobs, loadKarigarJobs,
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
    settings: state.settings,
  }));
  const cartItems = useAppStore(selectCartDetails);

  React.useEffect(() => {
    if (!appReady) return;
    loadProducts(); loadOrders(); loadGeneratedInvoices();
    loadAdditionalRevenues(); loadExpenses(); loadKarigars(); loadKarigarJobs();
  }, [appReady, loadProducts, loadOrders, loadGeneratedInvoices,
      loadAdditionalRevenues, loadExpenses, loadKarigars, loadKarigarJobs]);

  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    // "last 30 days" = today plus 29 prior full days, matching Analytics.
    const last30Start = startOfDay(subDays(now, 29));
    const ordersById = new Map(orders.map(o => [o.id, o]));

    const ongoingOrders = orders
      .filter(o => o.status === 'Pending' || o.status === 'In Progress')
      .sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());

    // Revenue recognised on the source order's date (getInvoiceRevenueDate).
    const rev = (from: Date) =>
      generatedInvoices.filter(i => i.status !== 'Refunded' && parseISO(getInvoiceRevenueDate(i, ordersById)) >= from)
        .reduce((s, i) => s + (i.grandTotal || 0), 0)
      + orders.filter(o => parseISO(o.createdAt) >= from && o.status !== 'Cancelled' && o.status !== 'Refunded' && !o.invoiceId)
        .reduce((s, o) => s + (o.subtotal || 0), 0)
      + additionalRevenues.filter(r => parseISO(r.date) >= from).reduce((s, r) => s + (r.amount || 0), 0);

    const todayInvoices = generatedInvoices.filter(i =>
      i.status !== 'Refunded' && parseISO(getInvoiceRevenueDate(i, ordersById)) >= todayStart);

    const unpaid = generatedInvoices
      .filter(i => i.status !== 'Refunded' && (i.balanceDue || 0) > 0)
      .sort((a, b) => (b.balanceDue || 0) - (a.balanceDue || 0));
    const totalOutstanding = unpaid.reduce((s, i) => s + Math.max(0, i.balanceDue || 0), 0);

    const jobs = buildWorkshopJobs(orders, karigarJobs, karigars, { invoices: generatedInvoices });
    const activeJobs = jobs.filter(j => j.status !== 'completed');
    const criticalJobs = activeJobs.filter(j => j.urgency === 'critical').sort((a, b) => b.ageDays - a.ageDays);
    const unassignedJobs = activeJobs.filter(j => j.karigarId === UNASSIGNED_ID);

    const revenue30 = rev(last30Start);
    // net30 is a profit figure, so partner drawings stay out of it.
    const expenses30 = expenses.filter(e => parseISO(e.date) >= last30Start && isBusinessCost(e))
      .reduce((s, e) => s + (e.amount || 0), 0);

    return {
      ongoingOrders,
      todayRevenue: rev(todayStart),
      todayInvoiceCount: todayInvoices.length,
      unpaid, totalOutstanding,
      activeJobs, criticalJobs, unassignedJobs,
      revenue30, expenses30, net30: revenue30 - expenses30,
      recentInvoices: [...generatedInvoices]
        .sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime())
        .slice(0, 12),
    };
  }, [orders, generatedInvoices, additionalRevenues, expenses, karigars, karigarJobs]);

  /** Everything actually waiting on a decision, worst first. */
  const tasks = useMemo(() => {
    const out: React.ComponentProps<typeof TaskRow>[] = [];
    for (const j of stats.criticalJobs.slice(0, 6)) {
      out.push({
        href: '/workshop', tone: 'danger',
        title: j.description,
        detail: `${j.karigarName} · ${j.ageDays} days in progress`,
      });
    }
    if (stats.unassignedJobs.length) {
      out.push({
        href: '/workshop', tone: 'danger',
        title: `${stats.unassignedJobs.length} unassigned piece${stats.unassignedJobs.length === 1 ? '' : 's'}`,
        detail: 'Not assigned to any karigar',
      });
    }
    for (const inv of stats.unpaid.slice(0, 6)) {
      out.push({
        href: `/view-invoice?invoiceId=${inv.id}`, tone: 'warn',
        title: inv.customerName || 'Walk-in',
        detail: `${inv.id} · unpaid since ${format(parseISO(inv.createdAt), 'd MMM')}`,
        amount: `PKR ${(inv.balanceDue || 0).toLocaleString()}`,
      });
    }
    return out;
  }, [stats]);

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <BoardSkeleton tiles={3} panels={3} />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-3 py-4 md:px-4 space-y-4 lg:h-[calc(100dvh-6.5rem)] lg:flex lg:flex-col lg:space-y-4 lg:overflow-hidden">

      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 flex-shrink-0">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-primary truncate">{settings?.shopName || 'Dashboard'}</h1>
          <p className="text-sm text-muted-foreground">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button asChild>
            <Link href="/cart"><Receipt className="w-4 h-4 mr-2" />Create Invoice{cartItems.length > 0 ? ` (${cartItems.length})` : ''}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/orders/add"><ClipboardList className="w-4 h-4 mr-2" />Create Order</Link>
          </Button>
        </div>
      </header>

      {/* Three figures, big enough to read at a glance. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 flex-shrink-0">
        <Headline label="Taken today" href="/analytics" icon={<Wallet className="h-4 w-4" />}
          value={compactPKR(stats.todayRevenue)} exact={`PKR ${stats.todayRevenue.toLocaleString()}`}
          tone={stats.todayRevenue > 0 ? 'text-success' : undefined}
          sub={`${stats.todayInvoiceCount} invoice${stats.todayInvoiceCount === 1 ? '' : 's'} today`} />
        <Headline label="Owed to you" href="/documents" icon={<Receipt className="h-4 w-4" />}
          value={stats.totalOutstanding > 0 ? compactPKR(stats.totalOutstanding) : 'Nil'}
          exact={`PKR ${stats.totalOutstanding.toLocaleString()}`}
          tone={stats.totalOutstanding > 0 ? 'text-destructive' : undefined}
          sub={`${stats.unpaid.length} unpaid invoice${stats.unpaid.length === 1 ? '' : 's'}`} />
        <Headline label="On the bench" href="/workshop" icon={<Hammer className="h-4 w-4" />}
          value={`${stats.activeJobs.length} piece${stats.activeJobs.length === 1 ? '' : 's'}`}
          tone={stats.criticalJobs.length > 0 ? 'text-destructive' : undefined}
          sub={stats.criticalJobs.length > 0
            ? `${stats.criticalJobs.length} sitting ${CRITICAL_DAYS}+ days`
            : 'nothing overdue'} />
      </div>

      {/* Needs you, then the two running lists. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:flex-1 lg:min-h-0">

        <Panel title="Needs you" count={tasks.length}
          icon={<AlertTriangle className={cn('h-4 w-4', tasks.length ? 'text-destructive' : 'text-muted-foreground')} />}>
          {tasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-success" />
              <p className="text-sm">Nothing overdue or unpaid.</p>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {tasks.map((t, i) => <TaskRow key={`${t.href}-${i}`} {...t} />)}
            </div>
          )}
        </Panel>

        <Panel title="Ongoing Orders" icon={<Clock className="h-4 w-4" />} href="/orders"
          count={stats.ongoingOrders.length}>
          {stats.ongoingOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No ongoing orders.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {stats.ongoingOrders.map(o => <OngoingOrderRow key={o.id} order={o} />)}
            </div>
          )}
        </Panel>

        <Panel title="Recent Invoices" icon={<FileText className="h-4 w-4" />} href="/documents">
          {stats.recentInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No invoices yet.</p>
          ) : (
            <div className="divide-y divide-border/60">
              {stats.recentInvoices.map(i => <RecentInvoiceRow key={i.id} invoice={i} />)}
            </div>
          )}
        </Panel>
      </div>

      {/* 30-day P&L as one quiet line rather than three cards. */}
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
