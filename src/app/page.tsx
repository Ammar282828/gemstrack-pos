
"use client";

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal, Order } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  PlusCircle, ShoppingCart, Trash2, ExternalLink, QrCode, Loader2, Gem, Users,
  Briefcase, ClipboardList, TrendingUp, BookUser, Settings as SettingsIcon,
  FileText, ArrowRight, TrendingDown, DollarSign, Clock, PackageSearch,
} from 'lucide-react';
import { format, parseISO, subDays } from 'date-fns';
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
const StatCard: React.FC<{ title: string; value: string; sub?: string; icon: React.ReactNode; color?: string }> = ({ title, value, sub, icon, color = 'text-primary' }) => (
  <Card>
    <CardContent className="p-5 flex items-center gap-4">
      <div className={cn("p-3 rounded-lg bg-primary/10", color === 'text-primary' ? 'bg-primary/10' : color === 'text-green-600' ? 'bg-green-500/10' : color === 'text-orange-500' ? 'bg-orange-500/10' : 'bg-primary/10')}>
        <div className={color}>{icon}</div>
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
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
    <Link href={`/orders/${order.id}`} className="flex items-center justify-between py-3 px-1 hover:bg-muted/40 rounded-md transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <Badge className={cn("border-transparent flex-shrink-0", statusColor)}>{order.status}</Badge>
        <div className="min-w-0">
          <p className="font-semibold text-sm">{order.id}</p>
          <p className="text-xs text-muted-foreground truncate">{order.customerName || 'Walk-in'}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <p className="text-sm font-semibold text-primary">PKR {grandTotal.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">{format(parseISO(order.createdAt), 'MMM d')}</p>
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </div>
    </Link>
  );
};

const QUICK_LINKS = [
  { href: '/scan', icon: <QrCode className="h-5 w-5" />, label: 'New Sale' },
  { href: '/orders/add', icon: <PlusCircle className="h-5 w-5" />, label: 'New Order' },
  { href: '/products', icon: <Gem className="h-5 w-5" />, label: 'Products' },
  { href: '/orders', icon: <ClipboardList className="h-5 w-5" />, label: 'Orders' },
  { href: '/customers', icon: <Users className="h-5 w-5" />, label: 'Customers' },
  { href: '/karigars', icon: <Briefcase className="h-5 w-5" />, label: 'Karigars' },
  { href: '/analytics', icon: <TrendingUp className="h-5 w-5" />, label: 'Analytics' },
  { href: '/hisaab', icon: <BookUser className="h-5 w-5" />, label: 'Hisaab' },
  { href: '/documents', icon: <FileText className="h-5 w-5" />, label: 'Documents' },
  { href: '/settings', icon: <SettingsIcon className="h-5 w-5" />, label: 'Settings' },
];

export default function HomePage() {
  const appReady = useAppReady();
  const { cartItems, cartSubtotal, removeFromCartAction, loadProducts, orders, loadOrders, generatedInvoices, loadGeneratedInvoices, additionalRevenues, loadAdditionalRevenues } = useAppStore(state => ({
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
  }));

  React.useEffect(() => {
    if (appReady) {
      loadProducts();
      loadOrders();
      loadGeneratedInvoices();
      loadAdditionalRevenues();
    }
  }, [appReady, loadProducts, loadOrders, loadGeneratedInvoices, loadAdditionalRevenues]);

  const { ongoingOrders, monthlyRevenue, monthlyInvoiceCount, monthlyOrderCount } = useMemo(() => {
    const now = new Date();
    const last30 = subDays(now, 30);

    const ongoing = orders
      .filter(o => o.status === 'Pending' || o.status === 'In Progress')
      .sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());

    const recentInvoices = generatedInvoices.filter(inv => parseISO(inv.createdAt) >= last30);
    const invoiceRevenue = recentInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);

    const recentOrders = orders.filter(o =>
      parseISO(o.createdAt) >= last30 &&
      o.status !== 'Cancelled' &&
      o.status !== 'Refunded' &&
      !o.invoiceId
    );
    const orderRevenue = recentOrders.reduce((sum, o) => sum + (o.grandTotal || 0), 0);

    const recentExtraRevenues = additionalRevenues.filter(r => parseISO(r.date) >= last30);
    const extraRevenue = recentExtraRevenues.reduce((sum, r) => sum + (r.amount || 0), 0);

    const revenue = invoiceRevenue + orderRevenue + extraRevenue;
    const invoiceCount = recentInvoices.length;

    return { ongoingOrders: ongoing, monthlyRevenue: revenue, monthlyInvoiceCount: invoiceCount, monthlyOrderCount: recentOrders.length };
  }, [orders, generatedInvoices, additionalRevenues]);

  if (!appReady) {
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading POS...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-4 px-4 space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-primary">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back! Here's your store overview.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left / main column */}
        <div className="lg:col-span-2 space-y-6">

          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard
              title="Revenue (Last 30 Days)"
              value={`PKR ${monthlyRevenue.toLocaleString()}`}
              sub={`${monthlyInvoiceCount} invoice${monthlyInvoiceCount !== 1 ? 's' : ''}${monthlyOrderCount > 0 ? ` · ${monthlyOrderCount} order${monthlyOrderCount !== 1 ? 's' : ''}` : ''}`}
              icon={<DollarSign className="h-5 w-5" />}
              color="text-green-600"
            />
            <StatCard
              title="Ongoing Orders"
              value={String(ongoingOrders.length)}
              sub={`${ongoingOrders.filter(o => o.status === 'Pending').length} pending · ${ongoingOrders.filter(o => o.status === 'In Progress').length} in progress`}
              icon={<Clock className="h-5 w-5" />}
              color="text-orange-500"
            />
            <StatCard
              title="Cart Items"
              value={String(cartItems.length)}
              sub={cartItems.length > 0 ? `PKR ${cartSubtotal.toLocaleString()} subtotal` : 'No active sale'}
              icon={<ShoppingCart className="h-5 w-5" />}
              color="text-primary"
            />
          </div>

          {/* Ongoing orders */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Ongoing Orders</CardTitle>
                <CardDescription>Pending and in-progress custom orders</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/orders">View all <ArrowRight className="ml-1 h-4 w-4" /></Link>
              </Button>
            </CardHeader>
            <CardContent>
              {ongoingOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <PackageSearch className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">No ongoing orders</p>
                </div>
              ) : (
                <ScrollArea className="h-[260px] pr-2">
                  <div className="divide-y">
                    {ongoingOrders.map(order => (
                      <OngoingOrderRow key={order.id} order={order} />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Quick buttons */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Quick Access</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
