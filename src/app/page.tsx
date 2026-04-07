
"use client";

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal, Order, Invoice } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  PlusCircle, ShoppingCart, Trash2, ExternalLink, QrCode, Loader2, Gem, Users,
  Briefcase, ClipboardList, TrendingUp, BookUser, Settings as SettingsIcon,
  FileText, ArrowRight, DollarSign, Clock, PackageSearch, Receipt,
  TrendingDown, AlertCircle, CreditCard, Zap,
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

// --- Stat card ---
const StatCard: React.FC<{ title: string; value: string; sub?: string; icon: React.ReactNode; colorClass?: string }> = ({ title, value, sub, icon, colorClass = 'bg-primary/10 text-primary' }) => (
  <Card>
    <CardContent className="p-4 flex items-center gap-3">
      <div className={cn("p-2.5 rounded-lg flex-shrink-0", colorClass)}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{title}</p>
        <p className="text-xl font-bold leading-tight truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>}
      </div>
    </CardContent>
  </Card>
);

// --- Ongoing order row ---
const OngoingOrderRow: React.FC<{ order: Order }> = ({ order }) => {
  const grandTotal = typeof order.grandTotal === 'number' ? order.grandTotal : 0;
  const statusColor = order.status === 'Pending'
    ? 'bg-yellow-500/80 text-yellow-50'
    : 'bg-blue-500/80 text-blue-50';

  return (
    <Link href={`/orders/${order.id}`} className="flex items-center justify-between py-2.5 px-1 hover:bg-muted/40 rounded-md transition-colors group">
      <div className="flex items-center gap-2 min-w-0">
        <Badge className={cn("border-transparent flex-shrink-0 text-xs", statusColor)}>{order.status}</Badge>
        <div className="min-w-0">
          <p className="font-semibold text-sm">{order.id}</p>
          <p className="text-xs text-muted-foreground truncate">{order.customerName || 'Walk-in'}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="text-right">
          <p className="text-sm font-semibold text-primary">PKR {grandTotal.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">{format(parseISO(order.createdAt), 'MMM d')}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
    </Link>
  );
};

// --- Recent invoice row ---
const RecentInvoiceRow: React.FC<{ invoice: Invoice }> = ({ invoice }) => (
  <Link href={`/view-invoice?invoiceId=${invoice.id}`} className="flex items-center justify-between py-2.5 px-1 hover:bg-muted/40 rounded-md transition-colors group">
    <div className="min-w-0">
      <p className="font-semibold text-sm">{invoice.customerName || 'Walk-in'}</p>
      <p className="text-xs text-muted-foreground">{format(parseISO(invoice.createdAt), 'MMM d, h:mm a')}</p>
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">
      <div className="text-right">
        <p className="text-sm font-semibold text-primary">PKR {(invoice.grandTotal || 0).toLocaleString()}</p>
        {(invoice.balanceDue || 0) > 0 && (
          <p className="text-xs text-orange-500">Due: PKR {invoice.balanceDue.toLocaleString()}</p>
        )}
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
    </div>
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

    // Ongoing
    const ongoingOrders = orders
      .filter(o => o.status === 'Pending' || o.status === 'In Progress')
      .sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());

    // Today invoices
    const todayInvoices = generatedInvoices.filter(inv => inv.status !== 'Refunded' && parseISO(inv.createdAt) >= todayStart);
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
    const recentInvoices = generatedInvoices.filter(inv => inv.status !== 'Refunded' && parseISO(inv.createdAt) >= last30Start);
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
    <div className="container mx-auto py-4 px-3 md:py-8 md:px-4 space-y-4 md:space-y-6">

      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-primary">{settings?.shopName || 'Dashboard'}</h1>
          <p className="text-sm text-muted-foreground">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild size="sm">
            <Link href="/scan"><QrCode className="w-4 h-4 mr-2" />New Sale</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/orders/add"><PlusCircle className="w-4 h-4 mr-2" />New Order</Link>
          </Button>
        </div>
      </header>

      <Separator />

      {/* Today snapshot */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-3">Today</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title="Today's Revenue"
          value={`PKR ${stats.todayRevenue.toLocaleString()}`}
          sub={`${stats.todayInvoiceCount} invoice${stats.todayInvoiceCount !== 1 ? 's' : ''} today`}
          icon={<Zap className="h-4 w-4" />}
          colorClass="bg-green-500/10 text-green-600"
        />
        <StatCard
          title="Ongoing Orders"
          value={String(stats.ongoingOrders.length)}
          sub={`${stats.ongoingOrders.filter(o => o.status === 'Pending').length} pending · ${stats.ongoingOrders.filter(o => o.status === 'In Progress').length} in progress`}
          icon={<Clock className="h-4 w-4" />}
          colorClass="bg-orange-500/10 text-orange-500"
        />
        <StatCard
          title="Outstanding Balance"
          value={stats.totalOutstanding > 0 ? `PKR ${stats.totalOutstanding.toLocaleString()}` : 'Nil'}
          sub="Total unpaid across invoices"
          icon={<AlertCircle className="h-4 w-4" />}
          colorClass={stats.totalOutstanding > 0 ? "bg-red-500/10 text-red-500" : "bg-primary/10 text-primary"}
        />
        <StatCard
          title="Cart Items"
          value={String(cartItems.length)}
          sub={cartItems.length > 0 ? `PKR ${cartSubtotal.toLocaleString()} subtotal` : 'No active sale'}
          icon={<ShoppingCart className="h-4 w-4" />}
          colorClass="bg-primary/10 text-primary"
        />
      </div>
      </div>

      <Separator />

      {/* 30-day P&L strip */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 mb-3">Last 30 Days</p>
        <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Revenue (30d)</p>
            <p className="text-lg font-bold text-green-600">PKR {stats.revenue30.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Expenses (30d)</p>
            <p className="text-lg font-bold text-red-500">PKR {stats.expenses30.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Net (30d)</p>
            <p className={cn("text-lg font-bold", stats.net30 >= 0 ? "text-primary" : "text-red-500")}>
              PKR {stats.net30.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6 items-start">
        {/* Left / main column */}
        <div className="lg:col-span-2 space-y-4 md:space-y-6">

          {/* Ongoing orders */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><Clock className="h-4 w-4" />Ongoing Orders</CardTitle>
                <CardDescription>Pending and in-progress custom orders</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/orders">All <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </CardHeader>
            <CardContent>
              {stats.ongoingOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <PackageSearch className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No ongoing orders</p>
                </div>
              ) : (
                <ScrollArea className="h-[220px] pr-2">
                  <div className="divide-y">
                    {stats.ongoingOrders.map(order => (
                      <OngoingOrderRow key={order.id} order={order} />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Recent invoices */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4" />Recent Invoices</CardTitle>
                <CardDescription>Latest sales</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/documents">All <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </CardHeader>
            <CardContent>
              {stats.recentInvoices.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No invoices yet</p>
                </div>
              ) : (
                <div className="divide-y">
                  {stats.recentInvoices.map(inv => (
                    <RecentInvoiceRow key={inv.id} invoice={inv} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick links */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Zap className="h-4 w-4" />Quick Access</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 sm:grid-cols-5 gap-2">
                {QUICK_LINKS.map(({ href, icon, label }) => (
                  <Button key={href} asChild variant="outline" className="flex flex-col h-16 gap-1.5">
                    <Link href={href}>
                      {icon}
                      <span className="text-xs">{label}</span>
                    </Link>
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column: cart */}
        <div className="lg:col-span-1 sticky top-8">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl flex items-center">
                <ShoppingCart className="w-5 h-5 mr-2 text-primary" />
                Current Sale
              </CardTitle>
            </CardHeader>
            <CardContent>
              {cartItems.length === 0 ? (
                <p className="text-muted-foreground text-center py-4 text-sm">Scan or add products to start a sale.</p>
              ) : (
                <ScrollArea className="h-[300px] pr-3 mb-4">
                  <div className="space-y-1">
                    {cartItems.map(item => item && (
                      <CartSummaryItem key={item.sku} item={item} removeFromCart={removeFromCartAction} />
                    ))}
                  </div>
                </ScrollArea>
              )}
              {cartItems.length > 0 && (
                <>
                  <Separator className="my-3" />
                  <div className="flex justify-between items-center font-semibold text-lg">
                    <span>Subtotal:</span>
                    <span className="text-primary">PKR {cartSubtotal.toLocaleString()}</span>
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter>
              <Button asChild size="lg" className="w-full" disabled={cartItems.length === 0}>
                <Link href="/cart">
                  View Cart & Checkout <ExternalLink className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
