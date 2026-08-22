
"use client";

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal, Order, Invoice, getInvoiceRevenueDate } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  PlusCircle, ShoppingCart, Trash2, ExternalLink, QrCode, Loader2, Gem, Users,
  Briefcase, ClipboardList, TrendingUp, BookUser, Settings as SettingsIcon,
  FileText, ArrowRight, DollarSign, Clock, PackageSearch, Receipt,
  TrendingDown, CreditCard,
} from 'lucide-react';
import { format, parseISO, subDays, isToday, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';

// --- Cart item ---
const CartSummaryItem: React.FC<{
  item: NonNullable<ReturnType<typeof selectCartDetails>[0]>;
  removeFromCart: (sku: string) => void;
}> = ({ item, removeFromCart }) => (
  <div className="flex justify-between items-center py-2">
    <div>
      <p className="font-medium text-sm leading-tight">{item.name}</p>
      <p className="text-xs text-muted-foreground">Qty: {item.quantity} &bull; PKR {item.totalPrice.toLocaleString()}</p>
    </div>
    <div className="flex items-center space-x-2">
      <p className="font-semibold text-sm text-primary">PKR {item.lineItemTotal.toLocaleString()}</p>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => removeFromCart(item.sku)}>
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  </div>
);

/** PKR at a glance. A seven-across strip cannot hold "PKR 1,213,450", and a
 *  truncated "PKR 1,21..." is worse than useless — it reads as a smaller
 *  number. Exact value stays available on hover. */
function compactPKR(n: number): string {
  const abs = Math.abs(n);
  // 999_500 not 1_000_000: rounding 999,999 to the nearest thousand yields
  // "1000k", which is worse than "1M".
  if (abs >= 999_500) return `PKR ${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (abs >= 100_000)   return `PKR ${Math.round(n / 1000)}k`;
  return `PKR ${n.toLocaleString()}`;
}

/** One figure in the metrics strip. Deliberately not a StatCard: seven of
 *  those with their icon chips would not fit on one row. */
const MetricTile: React.FC<{ label: string; value: string; sub?: string; tone?: string; exact?: string }> =
({ label, value, sub, tone, exact }) => (
  <div className="rounded-lg border bg-card px-3 py-2 min-w-0" title={exact}>
    <p className="text-2xs uppercase tracking-wide text-muted-foreground truncate">{label}</p>
    <p className={cn('text-sm xl:text-base font-bold leading-tight truncate tabular-nums', tone)}>{value}</p>
    {sub && <p className="text-2xs text-muted-foreground truncate">{sub}</p>}
  </div>
);

/** A titled panel that scrolls internally so the board keeps its height. */
const Panel: React.FC<{ title: string; icon: React.ReactNode; href: string; children: React.ReactNode }> =
({ title, icon, href, children }) => (
  <Card className="flex flex-col lg:min-h-0 overflow-hidden">
    <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 flex-shrink-0">
      <CardTitle className="text-base flex items-center gap-2">{icon}{title}</CardTitle>
      <Button asChild variant="ghost" size="sm" className="h-7 text-xs">
        <Link href={href}>All <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
      </Button>
    </CardHeader>
    <CardContent className="flex-1 lg:min-h-0 overflow-y-auto p-4 pt-0">{children}</CardContent>
  </Card>
);

const EmptyPanel: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="text-center py-8 text-muted-foreground">
    <div className="mx-auto mb-2 opacity-40 w-fit">{icon}</div>
    <p className="text-sm">{text}</p>
  </div>
);

// --- Ongoing order row ---
const OngoingOrderRow: React.FC<{ order: Order }> = ({ order }) => {
  const grandTotal = typeof order.grandTotal === 'number' ? order.grandTotal : 0;
  const statusColor = order.status === 'Pending'
    ? 'bg-warning text-warning-foreground'
    : 'bg-blue-500/80 text-blue-50';

  return (
    /* Two stacked lines rather than two side-by-side columns: in a third of
       the board's width the id and the amount collided. */
    <Link href={`/orders/${order.id}`} className="block py-2 px-1 hover:bg-muted/40 rounded-md transition-colors group">
      <div className="flex items-center gap-2 min-w-0">
        <Badge className={cn("border-transparent flex-shrink-0 text-2xs px-1.5", statusColor)}>{order.status}</Badge>
        <span className="font-semibold text-sm font-mono truncate">{order.id}</span>
        <ArrowRight className="w-3.5 h-3.5 ml-auto flex-shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-0.5 pl-0.5">
        <span className="text-xs text-muted-foreground truncate">{order.customerName || 'Walk-in'}</span>
        <span className="text-xs flex-shrink-0 tabular-nums">
          <span className="font-semibold text-primary">PKR {grandTotal.toLocaleString()}</span>
          <span className="text-muted-foreground"> · {format(parseISO(order.createdAt), 'MMM d')}</span>
        </span>
      </div>
    </Link>
  );
};

// --- Recent invoice row ---
const RecentInvoiceRow: React.FC<{ invoice: Invoice }> = ({ invoice }) => (
  <Link href={`/view-invoice?invoiceId=${invoice.id}`} className="block py-2 px-1 hover:bg-muted/40 rounded-md transition-colors group">
    <div className="flex items-center gap-2 min-w-0">
      <span className="font-semibold text-sm truncate">{invoice.customerName || 'Walk-in'}</span>
      <ArrowRight className="w-3.5 h-3.5 ml-auto flex-shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
    </div>
    <div className="flex items-baseline justify-between gap-2 mt-0.5">
      <span className="text-xs text-muted-foreground truncate">{format(parseISO(invoice.createdAt), 'MMM d, h:mm a')}</span>
      <span className="text-xs flex-shrink-0 tabular-nums font-semibold text-primary">
        PKR {(invoice.grandTotal || 0).toLocaleString()}
      </span>
    </div>
    {(invoice.balanceDue || 0) > 0 && (
      <p className="text-2xs text-warning text-right tabular-nums">Due PKR {invoice.balanceDue.toLocaleString()}</p>
    )}
  </Link>
);

const QUICK_LINKS = [
  { href: '/scan', icon: <QrCode className="h-5 w-5" />, label: 'New Sale' },
  { href: '/orders/add', icon: <PlusCircle className="h-5 w-5" />, label: 'New Order' },
  { href: '/products', icon: <Gem className="h-5 w-5" />, label: 'Products' },
  { href: '/orders', icon: <ClipboardList className="h-5 w-5" />, label: 'Orders' },
  { href: '/customers', icon: <Users className="h-5 w-5" />, label: 'Customers' },
  { href: '/karigars', icon: <Briefcase className="h-5 w-5" />, label: 'Karigars' },
  { href: '/expenses', icon: <CreditCard className="h-5 w-5" />, label: 'Expenses' },
  { href: '/analytics', icon: <TrendingUp className="h-5 w-5" />, label: 'Analytics' },
  { href: '/hisaab', icon: <BookUser className="h-5 w-5" />, label: 'Hisaab' },
  { href: '/settings', icon: <SettingsIcon className="h-5 w-5" />, label: 'Settings' },
];

export default function HomePage() {
  const appReady = useAppReady();
  const {
    cartItems, cartSubtotal, removeFromCartAction,
    loadProducts, orders, loadOrders,
    generatedInvoices, loadGeneratedInvoices,
    additionalRevenues, loadAdditionalRevenues,
    expenses, loadExpenses,
    settings,
  } = useAppStore(state => ({
    cartItems: selectCartDetails(state),
    cartSubtotal: selectCartSubtotal(state),
    removeFromCartAction: state.removeFromCart,
    loadProducts: state.loadProducts,
    orders: state.orders,
    loadOrders: state.loadOrders,
    generatedInvoices: state.generatedInvoices,
    loadGeneratedInvoices: state.loadGeneratedInvoices,
    additionalRevenues: state.additionalRevenues,
    loadAdditionalRevenues: state.loadAdditionalRevenues,
    expenses: state.expenses,
    loadExpenses: state.loadExpenses,
    settings: state.settings,
  }));

  React.useEffect(() => {
    if (appReady) {
      loadProducts();
      loadOrders();
      loadGeneratedInvoices();
      loadAdditionalRevenues();
      loadExpenses();
    }
  }, [appReady, loadProducts, loadOrders, loadGeneratedInvoices, loadAdditionalRevenues, loadExpenses]);

  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    // Use startOfDay(subDays(29)) so "last 30 days" = today + 29 prior full days,
    // matching exactly what the Analytics page shows with its default date range.
    const last30Start = startOfDay(subDays(now, 29));

    // Recognize each invoice on its source ORDER's date (see getInvoiceRevenueDate),
    // so an old order invoiced recently doesn't inflate this window's revenue.
    const ordersById = new Map(orders.map(o => [o.id, o]));

    // Ongoing
    const ongoingOrders = orders
      .filter(o => o.status === 'Pending' || o.status === 'In Progress')
      .sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());

    // Today invoices
    const todayInvoices = generatedInvoices.filter(inv => inv.status !== 'Refunded' && parseISO(getInvoiceRevenueDate(inv, ordersById)) >= todayStart);
    const todayInvoiceRevenue = todayInvoices.reduce((s, inv) => s + (inv.grandTotal || 0), 0);

    // Today uninvoiced orders
    const todayOrderRevenue = orders
      .filter(o => parseISO(o.createdAt) >= todayStart && o.status !== 'Cancelled' && o.status !== 'Refunded' && !o.invoiceId)
      .reduce((s, o) => s + (o.subtotal || 0), 0);

    // Today extra revenue
    const todayExtraRevenue = additionalRevenues
      .filter(r => parseISO(r.date) >= todayStart)
      .reduce((s, r) => s + (r.amount || 0), 0);

    const todayRevenue = todayInvoiceRevenue + todayOrderRevenue + todayExtraRevenue;

    // 30-day
    const recentInvoices = generatedInvoices.filter(inv => inv.status !== 'Refunded' && parseISO(getInvoiceRevenueDate(inv, ordersById)) >= last30Start);
    const invoiceRevenue30 = recentInvoices.reduce((s, inv) => s + (inv.grandTotal || 0), 0);
    const freeOrders30 = orders.filter(o =>
      parseISO(o.createdAt) >= last30Start &&
      o.status !== 'Cancelled' &&
      o.status !== 'Refunded' &&
      !o.invoiceId
    );
    const orderRevenue30 = freeOrders30.reduce((s, o) => s + (o.subtotal || 0), 0);
    const extraRevenue30 = additionalRevenues.filter(r => parseISO(r.date) >= last30Start).reduce((s, r) => s + (r.amount || 0), 0);
    const revenue30 = invoiceRevenue30 + orderRevenue30 + extraRevenue30;

    // 30-day expenses
    const expenses30 = expenses.filter(e => parseISO(e.date) >= last30Start).reduce((s, e) => s + (e.amount || 0), 0);

    // Total outstanding balance due
    const totalOutstanding = generatedInvoices
      .filter(inv => inv.status !== 'Refunded')
      .reduce((s, inv) => s + Math.max(0, inv.balanceDue || 0), 0);

    // Recent invoices (last 8)
    const recentInvoicesSorted = [...generatedInvoices]
      .sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime())
      .slice(0, 8);

    return {
      ongoingOrders,
      todayRevenue,
      todayInvoiceCount: todayInvoices.length,
      revenue30,
      expenses30,
      net30: revenue30 - expenses30,
      totalOutstanding,
      recentInvoices: recentInvoicesSorted,
    };
  }, [orders, generatedInvoices, additionalRevenues, expenses]);

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading POS...</p>
      </div>
    );
  }

  const goldRate21k = settings?.goldRatePerGram21k || 0;
  const goldRate22k = settings?.goldRatePerGram22k || 0;
  const goldRate24k = settings?.goldRatePerGram24k || 0;
  const goldRate18k = settings?.goldRatePerGram18k || 0;

  return (
    /* Desktop is a fixed-height board: the page itself never scrolls, each
       panel scrolls inside its own frame. Below lg it falls back to the normal
       stacked, scrolling layout — a phone has no height to spare. */
    <div className="container mx-auto py-4 px-3 md:px-4 md:py-5 space-y-4 lg:h-[calc(100dvh-6.5rem)] lg:flex lg:flex-col lg:space-y-3 lg:overflow-hidden">

      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 flex-shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold text-primary truncate">{settings?.shopName || 'Dashboard'}</h1>
          <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Button asChild size="sm">
            <Link href="/scan"><QrCode className="w-4 h-4 mr-2" />New Sale</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/orders/add"><PlusCircle className="w-4 h-4 mr-2" />New Order</Link>
          </Button>
        </div>
      </header>

      {/* One metrics strip. Today and the 30-day figures used to be two
          sections with a heading and a separator each; together they cost
          about a third of the screen to show seven numbers. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 flex-shrink-0">
        <MetricTile label="Today" value={compactPKR(stats.todayRevenue)} exact={`PKR ${stats.todayRevenue.toLocaleString()}`}
          sub={`${stats.todayInvoiceCount} invoice${stats.todayInvoiceCount !== 1 ? 's' : ''}`}
          tone="text-success" />
        <MetricTile label="Ongoing" value={String(stats.ongoingOrders.length)}
          sub={`${stats.ongoingOrders.filter(o => o.status === 'Pending').length} pending`} />
        <MetricTile label="Outstanding"
          value={stats.totalOutstanding > 0 ? compactPKR(stats.totalOutstanding) : 'Nil'}
          exact={`PKR ${stats.totalOutstanding.toLocaleString()}`}
          sub="unpaid" tone={stats.totalOutstanding > 0 ? 'text-destructive' : undefined} />
        <MetricTile label="Cart" value={String(cartItems.length)}
          sub={cartItems.length > 0 ? compactPKR(cartSubtotal) : 'empty'} />
        <MetricTile label="Revenue 30d" value={compactPKR(stats.revenue30)} exact={`PKR ${stats.revenue30.toLocaleString()}`} tone="text-success" />
        <MetricTile label="Expenses 30d" value={compactPKR(stats.expenses30)} exact={`PKR ${stats.expenses30.toLocaleString()}`} tone="text-destructive" />
        <MetricTile label="Net 30d" value={compactPKR(stats.net30)} exact={`PKR ${stats.net30.toLocaleString()}`}
          tone={stats.net30 >= 0 ? 'text-primary' : 'text-destructive'} />
      </div>

      {/* Three panels side by side, filling whatever height is left. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:flex-1 lg:min-h-0">

        <Panel title="Ongoing Orders" icon={<Clock className="h-4 w-4" />} href="/orders">
          {stats.ongoingOrders.length === 0 ? (
            <EmptyPanel icon={<PackageSearch className="h-8 w-8" />} text="No ongoing orders" />
          ) : (
            <div className="divide-y">
              {stats.ongoingOrders.map(order => <OngoingOrderRow key={order.id} order={order} />)}
            </div>
          )}
        </Panel>

        <Panel title="Recent Invoices" icon={<Receipt className="h-4 w-4" />} href="/documents">
          {stats.recentInvoices.length === 0 ? (
            <EmptyPanel icon={<FileText className="h-8 w-8" />} text="No invoices yet" />
          ) : (
            <div className="divide-y">
              {stats.recentInvoices.map(inv => <RecentInvoiceRow key={inv.id} invoice={inv} />)}
            </div>
          )}
        </Panel>

        {/* Current sale keeps its footer pinned below the scrolling item list. */}
        <Card className="flex flex-col lg:min-h-0 overflow-hidden">
          <CardHeader className="pb-2 flex-shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-primary" />Current Sale
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 lg:min-h-0 overflow-y-auto p-4 pt-0">
            {cartItems.length === 0
              ? <p className="text-muted-foreground text-center py-6 text-sm">Scan or add products to start a sale.</p>
              : (
                <div className="space-y-1">
                  {cartItems.map(item => item && (
                    <CartSummaryItem key={item.sku} item={item} removeFromCart={removeFromCartAction} />
                  ))}
                </div>
              )}
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-2 pt-3 flex-shrink-0 border-t">
            {cartItems.length > 0 && (
              <div className="flex justify-between items-center font-semibold">
                <span>Subtotal</span>
                <span className="text-primary">PKR {cartSubtotal.toLocaleString()}</span>
              </div>
            )}
            <Button asChild className="w-full" disabled={cartItems.length === 0}>
              <Link href="/cart">Checkout <ExternalLink className="w-4 h-4 ml-2" /></Link>
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Quick access as a single slim strip rather than a card of tiles. */}
      <div className="flex-shrink-0 flex gap-1.5 overflow-x-auto lg:overflow-visible lg:flex-wrap pb-1 lg:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {QUICK_LINKS.map(({ href, icon, label }) => (
          <Button key={href} asChild variant="outline" size="sm"
            className="flex-shrink-0 h-9 gap-1.5 text-xs">
            <Link href={href}>{icon}<span className="hidden sm:inline">{label}</span></Link>
          </Button>
        ))}
      </div>
    </div>
  );
}
