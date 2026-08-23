
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { ListSkeleton } from '@/components/shared/skeletons';
import { FilterBar } from '@/components/shared/filter-bar';
import Link from 'next/link';
import { useAppStore, Order, ORDER_STATUSES, OrderStatus, OrderItem } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, PlusCircle, Eye, ClipboardList, Loader2, MessageSquareQuote, CheckCircle2, Circle, User, Phone, Calendar, DollarSign, CreditCard  } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn, settledRowClass, shopifyRowClass } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { GRADUATIONS, bucketOf, type Graduation } from '@/lib/date-grouping';

type PaymentStatus = 'Paid' | 'Partial' | 'Unpaid';

const getPaymentStatus = (order: Order): PaymentStatus => {
  const grandTotal = typeof order.grandTotal === 'number' ? order.grandTotal : 0;
  const advancePayment = typeof order.advancePayment === 'number' ? order.advancePayment : 0;
  const advanceInExchangeValue = typeof order.advanceInExchangeValue === 'number' ? order.advanceInExchangeValue : 0;
  const totalAdvance = advancePayment + advanceInExchangeValue;
  if (grandTotal <= 0) return 'Paid';
  if (totalAdvance >= grandTotal) return 'Paid';
  if (totalAdvance > 0) return 'Partial';
  return 'Unpaid';
};

const getPaymentBadgeClass = (status: PaymentStatus) => {
  switch (status) {
    case 'Paid': return 'bg-success text-success-foreground';
    case 'Partial': return 'bg-orange-500/80 text-orange-50';
    case 'Unpaid': return 'bg-destructive text-destructive-foreground';
  }
};

const getStatusBadgeVariant = (status: OrderStatus) => {
    switch (status) {
      case 'Pending':
        return 'bg-warning text-warning-foreground';
      case 'In Progress':
        return 'bg-blue-500/80 text-blue-50';
      case 'Completed':
        return 'bg-success text-success-foreground';
      case 'Cancelled':
        return 'bg-destructive text-destructive-foreground';
      case 'Refunded':
        return 'bg-purple-500/80 text-purple-50';
      default:
        return 'secondary';
    }
  };

/** No order originates on Shopify — this marks one mirrored out as a draft. */
const isOnShopify = (order: Order): boolean =>
  !!(order.shopifyDraftOrderId || order.shopifyOrderId);

const OrderRow: React.FC<{ order: Order }> = ({ order }) => {
  const { toast } = useToast();
  const updateOrderStatus = useAppStore(state => state.updateOrderStatus);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const safeItems = Array.isArray(order.items) ? order.items : [];
  const completedItems = safeItems.filter(item => item.isCompleted).length;
  const totalItems = safeItems.length;
  const progressPercentage = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
  const unassignedItems = safeItems.filter(item => !item.karigarId || item.karigarId === 'none').length;
  
  const grandTotal = typeof order.grandTotal === 'number' ? order.grandTotal : 0;
  const subtotal = typeof order.subtotal === 'number' ? order.subtotal : 0;
  const advancePayment = typeof order.advancePayment === 'number' ? order.advancePayment : 0;

  return (
    <Card className={cn('mb-4 md:hidden', order.status === 'Completed' && settledRowClass,
      isOnShopify(order) && shopifyRowClass)}>
        <CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-start">
                <Link href={`/orders/${order.id}`} className="font-bold text-primary hover:underline text-lg">
                    {order.id}
                </Link>
                <div className="flex items-center gap-1.5">
                  <Badge className={cn("border-transparent", getPaymentBadgeClass(getPaymentStatus(order)))}>{getPaymentStatus(order)}</Badge>
                  <Badge className={cn("border-transparent", getStatusBadgeVariant(order.status))}>{order.status}</Badge>
                </div>
            </div>
            
            {order.summary && (
              <p className="text-sm italic text-muted-foreground flex items-start gap-2">
                  <MessageSquareQuote className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{order.summary}</span>
              </p>
            )}

            <div className="text-sm text-foreground space-y-2 pt-2">
                <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground"/> 
                    <span>{order.customerName || 'Walk-in Customer'} {order.customerContact && `(${order.customerContact})`}</span>
                </div>
                 <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-muted-foreground"/> 
                    <span>{format(parseISO(order.createdAt), 'MMM dd, yyyy')}</span>
                </div>
                 <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-muted-foreground"/> 
                    <span>Balance Due: <span className="font-bold text-primary">PKR {grandTotal.toLocaleString()}</span></span>
                </div>
            </div>

            <div className="pt-1">
                 {totalItems > 0 && <span className="text-xs text-muted-foreground">{completedItems} of {totalItems} items completed</span>}
                 {unassignedItems > 0 && order.status !== 'Completed' && (
                   <Badge variant="outline" className="ml-2 text-2xs text-destructive border-destructive/40 bg-destructive/5">
                     {unassignedItems} unassigned
                   </Badge>
                 )}
                 <Progress value={progressPercentage} className="h-1.5 mt-1" />
            </div>

        </CardContent>
        <CardFooter className="p-2 border-t bg-muted/30">
            <Button asChild size="sm" variant="ghost" className="w-full justify-center">
                <Link href={`/orders/${order.id}`}>
                <Eye className="w-4 h-4 mr-2" /> View Details
                </Link>
            </Button>
        </CardFooter>
    </Card>
  );
};

const OrderTableRow: React.FC<{ order: Order }> = ({ order }) => {
    const { toast } = useToast();
    const updateOrderStatus = useAppStore(state => state.updateOrderStatus);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);

    const DESTRUCTIVE_STATUSES: OrderStatus[] = ['Cancelled', 'Refunded'];

    const applyStatusChange = async (newStatus: OrderStatus) => {
        setIsUpdatingStatus(true);
        try {
            await updateOrderStatus(order.id, newStatus);
            toast({ title: "Status Updated", description: `Order ${order.id} status changed to "${newStatus}".` });
        } catch (error) {
            toast({ title: "Error", description: "Failed to update order status.", variant: "destructive" });
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    const handleStatusChange = (newStatus: OrderStatus) => {
        if (DESTRUCTIVE_STATUSES.includes(newStatus)) {
            setPendingStatus(newStatus);
        } else {
            applyStatusChange(newStatus);
        }
    };

    const safeItems = Array.isArray(order.items) ? order.items : [];
    const completedItems = safeItems.filter(item => item.isCompleted).length;
    const totalItems = safeItems.length;
    const progressPercentage = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
    const unassignedItems = safeItems.filter(item => !item.karigarId || item.karigarId === 'none').length;
    const grandTotal = typeof order.grandTotal === 'number' ? order.grandTotal : 0;
    const advancePayment = typeof order.advancePayment === 'number' ? order.advancePayment : 0;
    const subtotal = typeof order.subtotal === 'number' ? order.subtotal : 0;
  
    return (
      <>
      <TableRow className={cn(order.status === 'Completed' && settledRowClass,
        isOnShopify(order) && shopifyRowClass)}>
        <TableCell className="font-medium align-top">
          <Link href={`/orders/${order.id}`} className="text-primary hover:underline">
            {order.id}
          </Link>
          {/* Count first: it is the scannable part, and the item list is
              going to truncate whatever happens. */}
          <p className="text-xs text-muted-foreground max-w-[18rem] mt-0.5 truncate" title={order.summary}>
            {totalItems > 0 && <span className="tabular-nums">{totalItems} item{totalItems === 1 ? '' : 's'}</span>}
            {totalItems > 0 && order.summary ? ' · ' : ''}
            {order.summary || (totalItems === 0 ? 'No items' : '')}
          </p>
        </TableCell>
        <TableCell className="hidden lg:table-cell align-top">
            <div className="whitespace-nowrap leading-tight">
                <p className="text-sm">{format(parseISO(order.createdAt), 'd MMM yyyy')}</p>
                <p className="text-xs text-muted-foreground">{format(parseISO(order.createdAt), 'EEEE')}</p>
            </div>
        </TableCell>
        <TableCell className="align-top">
          <div className="min-w-0 leading-tight">
            <p className="text-sm truncate">{order.customerName || 'Walk-in'}</p>
            {order.customerContact && (
              <p className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{order.customerContact}</p>
            )}
          </div>
        </TableCell>
         <TableCell className="hidden xl:table-cell text-right align-top">
          <div className="flex flex-col items-end gap-0.5 leading-tight whitespace-nowrap">
              <Badge className={cn("border-transparent text-xs", getPaymentBadgeClass(getPaymentStatus(order)))}>{getPaymentStatus(order)}</Badge>
              <div className="text-xs text-muted-foreground">Bal: <span className="font-semibold text-foreground">{grandTotal.toLocaleString()}</span></div>
              <div className="text-xs text-muted-foreground">Adv: <span className="font-semibold text-foreground">{advancePayment.toLocaleString()}</span></div>
              <div className="text-xs text-muted-foreground border-t mt-1 pt-1">Total: <span className="font-bold text-foreground">{subtotal.toLocaleString()}</span></div>
          </div>
        </TableCell>
        <TableCell className="align-top">
           {/* The trigger IS the pill. It used to be a bordered select box
               wrapping a coloured badge, which read as two controls stacked on
               each other, and the count, the bar and the badge each took their
               own line — three rows of chrome for one status. */}
           <div className="flex flex-col gap-1.5 w-[9.5rem]">
              {isUpdatingStatus ? (
                  <span className="inline-flex h-7 items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…
                  </span>
              ) : (
                  <Select onValueChange={(val) => handleStatusChange(val as OrderStatus)} defaultValue={order.status}>
                      <SelectTrigger
                        id={`status-update-${order.id}`}
                        aria-label={`Status: ${order.status}`}
                        className={cn(
                          'h-7 w-fit gap-1 rounded-full border-transparent px-2.5 text-xs font-medium',
                          'focus:ring-0 focus:ring-offset-0 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-80',
                          getStatusBadgeVariant(order.status),
                        )}
                      >
                          <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                          {ORDER_STATUSES.map(status => (
                              <SelectItem key={status} value={status}>{status}</SelectItem>
                          ))}
                      </SelectContent>
                  </Select>
              )}

              {totalItems > 0 && (
                <div className="space-y-1">
                  {/* Count and warning share a line; the bar sits under both. */}
                  <div className="flex items-baseline justify-between gap-2 text-2xs">
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                      {completedItems} of {totalItems} done
                    </span>
                    {unassignedItems > 0 && order.status !== 'Completed' && (
                      <span className="text-destructive whitespace-nowrap">{unassignedItems} unassigned</span>
                    )}
                  </div>
                  <Progress value={progressPercentage} className="h-1" />
                </div>
              )}
          </div>
        </TableCell>
        <TableCell className="text-right">
          <Button asChild size="sm" variant="outline">
              <Link href={`/orders/${order.id}`}>
                <Eye className="w-4 h-4" />
                <span className="sr-only md:not-sr-only md:ml-2">View</span>
              </Link>
            </Button>
        </TableCell>
      </TableRow>
      <AlertDialog open={!!pendingStatus} onOpenChange={(open) => !open && setPendingStatus(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Status Change</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to mark order <strong>{order.id}</strong> as <strong>{pendingStatus}</strong>? This action is difficult to reverse.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingStatus(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (pendingStatus) applyStatusChange(pendingStatus); setPendingStatus(null); }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </>
    );
  };

function monthKeyOf(iso: string | undefined): string {
  return (iso || '').slice(0, 7); // "YYYY-MM"
}
function monthLabel(key: string): string {
  if (!key) return '—';
  const d = new Date(key + '-01T00:00:00');
  return isNaN(d.getTime()) ? key : d.toLocaleString('default', { month: 'long', year: 'numeric' });
}

export default function OrdersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>('All');
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | 'All'>('All');
  const [monthFilter, setMonthFilter] = useState<string>('All');

  const appReady = useAppReady();
  const { orders, isOrdersLoading, loadOrders } = useAppStore(state => ({
    orders: state.orders,
    isOrdersLoading: state.isOrdersLoading,
    loadOrders: state.loadOrders,
  }));

  useEffect(() => {
    if (appReady) {
      loadOrders();
    }
  }, [appReady, loadOrders]);

  // Build the list of months present in the data, most recent first.
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      const k = monthKeyOf(o.createdAt);
      if (k) set.add(k);
    }
    return Array.from(set).sort().reverse();
  }, [orders]);

  // Shown on the collapsed mobile Filters button so an active filter is never
  // hidden from view.

  /** Day by default, matching Expenses and Billing. */
  const [groupBy, setGroupBy] = useState<'status' | Graduation>('day');

  const filteredOrders = useMemo(() => {
    if (!appReady) return [];
    return orders.filter(order =>
        (statusFilter === 'All' || order.status === statusFilter) &&
        (paymentFilter === 'All' || getPaymentStatus(order) === paymentFilter) &&
        (monthFilter === 'All' || monthKeyOf(order.createdAt) === monthFilter) &&
        (
            order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (order.customerName && order.customerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (order.customerContact && order.customerContact.includes(searchTerm))
        )
    ).sort((a,b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());
  }, [orders, searchTerm, appReady, statusFilter, paymentFilter, monthFilter]);

  /** Only the in-progress count is shown now; the tiles are gone. */
  const activeCount = useMemo(
    () => filteredOrders.filter(o => o.status === 'Pending' || o.status === 'In Progress').length,
    [filteredOrders],
  );

  /** The list broken into sections, each carrying its own totals. */
  const sections = useMemo(() => {
    const out: { key: string; title: string; hint: string; danger?: boolean; rows: Order[] }[] = [];
    const push = (key: string, title: string, hint: string, rows: Order[], danger?: boolean) => {
      if (rows.length) out.push({ key, title, hint, rows, danger });
    };

    if (groupBy === 'status') {
      // Ordered the way work moves, so the list reads as a pipeline.
      for (const st of ORDER_STATUSES) {
        push(st, st, st === 'Pending' ? 'not started' : '', filteredOrders.filter(o => o.status === st),
             st === 'Pending');
      }
      push('other', 'Everything else', '',
        filteredOrders.filter(o => !(ORDER_STATUSES as readonly string[]).includes(o.status)));
    } else {
      const index = new Map<string, number>();
      for (const o of filteredOrders) {
        if (!o.createdAt) continue;
        const b = bucketOf(parseISO(o.createdAt), groupBy);
        let i = index.get(b.key);
        if (i === undefined) {
          i = out.length; index.set(b.key, i);
          out.push({ key: b.key, title: b.label, hint: b.sub, rows: [] });
        }
        out[i].rows.push(o);
      }
    }

    return out.map(s => ({
      ...s,
      value: s.rows.reduce((n, o) => n + (o.subtotal || 0), 0),
      due: s.rows.reduce((n, o) => n + Math.max(0, o.grandTotal || 0), 0),
    }));
  }, [filteredOrders, groupBy]);

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  const pkr = (n: number) => 'PKR ' + Math.round(n).toLocaleString();

  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2.5">
            <ClipboardList className="w-7 h-7 flex-shrink-0"/>Orders
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filteredOrders.length === orders.length
              ? `${orders.length} order${orders.length === 1 ? '' : 's'}`
              : `${filteredOrders.length} of ${orders.length} orders`}
            {activeCount > 0 && ` · ${activeCount} in progress`}
          </p>
        </div>
        <Button asChild size="sm" className="flex-shrink-0">
          <Link href="/orders/add"><PlusCircle className="w-4 h-4 mr-2" />New order</Link>
        </Button>
      </header>

      
      <FilterBar
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search by order ID, customer, or contact…"
        actions={
          <div className="inline-flex rounded-md border overflow-hidden flex-shrink-0" role="group" aria-label="Group by">
            {([['status', 'Status'], ...GRADUATIONS.map(g => [g.id, g.label] as const)] as const).map(([id, label]) => (
              <button
                key={id} type="button" onClick={() => setGroupBy(id as 'status' | Graduation)}
                aria-pressed={groupBy === id}
                className={cn('px-2.5 text-xs h-9 transition-colors whitespace-nowrap',
                  groupBy === id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent')}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="w-full sm:w-[150px]"><SelectValue placeholder="Month" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All time</SelectItem>
            {monthOptions.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-full sm:w-[145px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">Any status</SelectItem>
            {ORDER_STATUSES.map(st => <SelectItem key={st} value={st}>{st}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={paymentFilter} onValueChange={v => setPaymentFilter(v as typeof paymentFilter)}>
          <SelectTrigger className="w-full sm:w-[135px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">Any payment</SelectItem>
            {(['Paid', 'Partial', 'Unpaid'] as const).map(ps => <SelectItem key={ps} value={ps}>{ps}</SelectItem>)}
          </SelectContent>
        </Select>
      </FilterBar>

      {isOrdersLoading ? (
        <ListSkeleton rows={5} />
      ) : filteredOrders.length === 0 ? (
        <div className="text-center py-14 bg-card rounded-xl border">
          <ClipboardList className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-1">No orders found</h3>
          <p className="text-sm text-muted-foreground">
            {searchTerm || statusFilter !== 'All' || paymentFilter !== 'All' || monthFilter !== 'All'
              ? 'Try adjusting the search or filters.'
              : 'Create a custom order to begin.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sections.map(s => (
            <section key={s.key}>
              <div className="flex items-baseline justify-between gap-3 px-1 pb-1.5">
                <div className="flex items-baseline gap-2 min-w-0">
                  <h2 className={cn('text-sm font-semibold truncate', s.danger && 'text-destructive')}>{s.title}</h2>
                  {s.hint && <span className="text-2xs text-muted-foreground flex-shrink-0">{s.hint}</span>}
                </div>
                <div className="flex items-baseline gap-2 flex-shrink-0">
                  <span className="text-2xs text-muted-foreground">{s.rows.length}</span>
                  <span className="text-sm font-semibold tabular-nums">{pkr(s.value)}</span>
                </div>
              </div>

              <div className="md:hidden">
                {s.rows.map(order => <OrderRow key={order.id} order={order} />)}
              </div>

              <Card className="hidden md:block">
                <CardContent className="p-0 scroll-shadow-x overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order</TableHead>
                        <TableHead className="hidden lg:table-cell">Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead className="hidden xl:table-cell text-right">Financials (PKR)</TableHead>
                        <TableHead>Status &amp; progress</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {s.rows.map(order => <OrderTableRow key={order.id} order={order} />)}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
