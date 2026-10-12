"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useLingering } from '@/hooks/use-lingering';
import { ListSkeleton } from '@/components/shared/skeletons';
import { FilterBar } from '@/components/shared/filter-bar';
import Link from 'next/link';
import { useAppStore, Order, ORDER_STATUSES, OrderStatus } from '@/lib/store';
import { getOrderPaymentStatus, type PaymentStatus as OrderPaymentStatus } from '@/lib/order-payment';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  PlusCircle, ClipboardList, Loader2, CalendarCheck, Printer, Hammer, CheckCircle2, CreditCard, MinusCircle, CircleDashed,
  MoreHorizontal, Phone, MessageCircle, ExternalLink, SlidersHorizontal, RefreshCw,
} from 'lucide-react';
import QRCode from 'qrcode.react';
import { generateOrderSlipPDF } from '@/lib/order-slip-pdf';
import { STORE_CONFIG, storeLinksUrl } from '@/lib/store-config';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { DUE_BUCKETS, dueGroups } from '@/lib/orders-due';
import { GRADUATIONS, bucketOf, type Graduation } from '@/lib/date-grouping';
import { orderTiming } from '@/lib/order-timing';
import { isWalkInName } from '@/lib/walk-in';
import { lacCrore } from '@/lib/money';
import { PromiseLine } from '@/components/shared/promise-line';
import { useRouter } from 'next/navigation';
import { TakenByPicker } from '@/components/shared/taken-by-picker';
import { useMe, useMineFilter } from '@/hooks/use-me';
import { PageShell } from '@/components/shared/page-shell';
import { NextStep } from '@/components/order/next-step';
import { RecordAdvanceDialog } from '@/components/order/order-dialogs';
import { OnlineBadge, OnlineInbox } from '@/components/order/online-inbox';
import { STAGES, STAGE_ORDER, stageOf, type OrderStage } from '@/lib/order-stage';
import {
  ChipRow, FilterChip, EmptyState, LedgerHeading, MineTag, Monogram, Pill, RowAmount, SearchField, Segmented, SwipeRow,
  contactHrefs, toneClasses, type SwipeAction, type Tone,
} from '@/components/ledger';

type PaymentStatus = OrderPaymentStatus;
const getPaymentStatus = getOrderPaymentStatus;

/** The app's tones for an order's status: nothing here picks a colour but the tone. */
const STATUS_TONE: Record<string, Tone> = {
  Pending: 'owed',
  'In Progress': 'working',
  Completed: 'settled',
  Cancelled: 'quiet',
  Refunded: 'quiet',
};
const statusTone = (s: string): Tone => STATUS_TONE[s] ?? 'quiet';

const PAYMENT_TONE: Record<PaymentStatus, Tone> = { Paid: 'settled', Partial: 'owed', Unpaid: 'late' };

/** Where the order stands, as the app's card says it: a word, an icon, a tone. */
const STAGE_LOOK: Record<OrderStage, { tone: Tone; Icon: React.ComponentType<{ className?: string }> }> = {
  transfer: { tone: 'owed', Icon: CreditCard },
  ready: { tone: 'settled', Icon: CheckCircle2 },
  karigar: { tone: 'working', Icon: Hammer },
  new: { tone: 'quiet', Icon: CircleDashed },
  payment: { tone: 'owed', Icon: CreditCard },
  done: { tone: 'settled', Icon: CheckCircle2 },
  closed: { tone: 'quiet', Icon: MinusCircle },
};

const pkrLac = (n: number) => 'PKR ' + lacCrore(n);
const customerOf = (o: Order) => {
  const n = (o.customerName || '').trim();
  return !n || isWalkInName(n) ? 'Walk-in' : n;
};

/** The card's one line about what the order is: its summary, else its first piece, and how many more (app: cardWhat). */
function cardWhat(order: Order): string {
  const items = Array.isArray(order.items) ? order.items : [];
  const count = items.length;
  const summary = (order.summary || '').trim();
  if (summary) return summary + (count > 1 ? ` · ${count} pieces` : '');
  const first = items.map(i => (i.description || '').trim()).find(Boolean);
  if (!first) return count === 0 ? 'No pieces' : `${count} piece${count === 1 ? '' : 's'}`;
  return first + (count > 1 ? ` · +${count - 1} more` : '');
}

/**
 * Print the slip from the list, without opening the order.
 *
 * generateOrderSlipPDF pre-opens the iOS window itself, synchronously, so this
 * must be called straight from the tap with nothing awaited before it. The one
 * await inside it is the logo, which is warmed on mount and answers from cache.
 */
function usePrintSlip(order: Order) {
  const settings = useAppStore(state => state.settings);
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const print = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await generateOrderSlipPDF(order, settings);
    } catch (e) {
      console.error('[GemsTrack] order slip failed', e);
      toast({ title: 'Could not create the slip', description: e instanceof Error ? e.message : 'Something went wrong while drawing it.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  return { print, busy };
}

/** Changing an order's status from a list: Cancelled asks first. `dialog` is the confirmation, to render once. */
function useStatusChange(order: Order) {
  const { toast } = useToast();
  const updateOrderStatus = useAppStore(state => state.updateOrderStatus);
  const [busy, setBusy] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null);
  const pendingShown = useLingering(pendingStatus); // stays while the dialog closes (hooks/use-lingering.ts)

  const apply = async (newStatus: OrderStatus, title = 'Status Updated', description = `Order ${order.id} status changed to "${newStatus}".`) => {
    setBusy(true);
    try {
      await updateOrderStatus(order.id, newStatus);
      toast({ title, description });
    } catch {
      toast({ title: 'Error', description: 'Failed to update order status.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const change = (newStatus: OrderStatus) => {
    if (newStatus === 'Cancelled') setPendingStatus(newStatus);
    else void apply(newStatus);
  };
  const markReady = () => apply('Completed', `${order.id} is ready`, 'Every piece ticked. Finalize & invoice when it is collected.');

  const dialog = (
    <AlertDialog open={!!pendingStatus} onOpenChange={(open) => !open && setPendingStatus(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Status Change</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to mark order <strong>{order.id}</strong> as <strong>{pendingShown}</strong>? This action is difficult to reverse.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setPendingStatus(null)}>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (pendingStatus) void apply(pendingStatus); setPendingStatus(null); }}>Confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { busy, change, markReady, dialog };
}

/**
 * An order on a phone or tablet: the app's card (apps/iphone/App/Screens/Orders/OrderCard.swift).
 * A person leads (monogram, name, the id as a caption, You / Online), what is owed sits on the right,
 * then what it is, then where it stands and when it was promised, then the one next step. One badge at
 * most: the status badge went, the stage word says it.
 */
const OrderCard: React.FC<{ order: Order; owed: number; mine?: boolean }> = ({ order, owed, mine }) => {
  const { print, busy: printing } = usePrintSlip(order);
  const status = useStatusChange(order);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [now] = useState(() => new Date());

  const safeItems = Array.isArray(order.items) ? order.items : [];
  const totalItems = safeItems.length;
  const completedItems = safeItems.filter(item => item.isCompleted).length;
  const unassignedItems = safeItems.filter(item => !item.karigarId || item.karigarId === 'none').length;

  const stage = stageOf(order, owed);
  const look = STAGE_LOOK[stage];
  const greyed = !!order.invoiceId || stage === 'done';
  const making = stage === 'new' || stage === 'karigar' || stage === 'ready';
  const open = !order.invoiceId && order.status !== 'Cancelled' && order.status !== 'Refunded';
  const hrefs = contactHrefs(order.customerContact);

  // What the customer still owes as the list shows it: the order's own balance until it is invoiced, then the invoice's.
  const due = order.invoiceId ? owed : (typeof order.grandTotal === 'number' ? order.grandTotal : 0);
  const timing = orderTiming(order, now);

  const leading: SwipeAction[] = hrefs ? [
    { label: 'Call', icon: <Phone className="h-5 w-5" />, tone: 'settled', onSelect: () => { window.location.href = hrefs.tel; } },
    { label: 'WhatsApp', icon: <MessageCircle className="h-5 w-5" />, tone: 'credit', onSelect: () => { window.open(hrefs.whatsapp, '_blank', 'noopener,noreferrer'); } },
  ] : [];
  const trailing: SwipeAction[] = [
    ...(making ? [{ label: 'Advance', icon: <CreditCard className="h-5 w-5" />, tone: 'working' as Tone, onSelect: () => setAdvanceOpen(true) }] : []),
    ...(stage === 'karigar' ? [{ label: 'Ready', icon: <CheckCircle2 className="h-5 w-5" />, tone: 'settled' as Tone, onSelect: () => { void status.markReady(); } }] : []),
  ];

  return (
    <SwipeRow leading={leading} trailing={trailing} className="rounded-card">
      <div className={cn('space-y-3 p-4', mine && 'ring-1 ring-inset ring-primary/25 rounded-card')} data-mine={mine ? 'true' : undefined}>
        {/* The head opens the order; the step row below has its own controls. */}
        <Link href={`/orders/${order.id}`} className="block space-y-3 rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Monogram name={customerOf(order)} size={36} />
              <div className="min-w-0 space-y-1">
                <p className={cn('break-words text-ios-headline font-semibold', greyed ? 'text-muted-foreground' : 'text-foreground')}>{customerOf(order)}</p>
                <p className="text-ios-cap text-muted-foreground">{order.id}</p>
                {(mine || (order.source === 'website' && order.website)) && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {mine && <MineTag />}
                    {order.source === 'website' && order.website && <OnlineBadge onlineId={order.website.onlineId} />}
                  </div>
                )}
              </div>
            </div>
            {stage !== 'closed' && (
              <div className="shrink-0 text-right">
                {Math.abs(due) > 0.5 ? (
                  <>
                    <RowAmount amount={Math.abs(due)} tone={due < 0 ? 'credit' : undefined} />
                    <p className="text-ios-cap text-muted-foreground">{due < 0 ? 'In credit' : 'Owed'}</p>
                  </>
                ) : (
                  <Pill tone="settled">Paid</Pill>
                )}
              </div>
            )}
          </div>

          <p className="text-ios-sub text-muted-foreground">{cardWhat(order)}</p>

          <div className="flex items-start gap-3 border-t border-separator pt-3">
            <div className="min-w-0 flex-1 space-y-1">
              <p className={cn('flex items-center gap-1.5 text-ios-foot font-medium', look.tone === 'quiet' ? 'text-muted-foreground' : toneClasses(look.tone).ink)}>
                <look.Icon aria-hidden className="h-4 w-4 shrink-0" />
                <span>{stage === 'closed' ? order.status : STAGES[stage].title}</span>
              </p>
              {totalItems > 0 && !greyed && (
                <p className="text-ios-cap text-muted-foreground">
                  {unassignedItems > 0 && order.status !== 'Completed' ? `${unassignedItems} unassigned` : `${completedItems} of ${totalItems} done`}
                </p>
              )}
            </div>
            {open && timing.due && <PromiseLine order={order} className="shrink-0" />}
          </div>
        </Link>

        {/* The one thing to do next, on the card (lib/order-stage.ts). */}
        <div className="flex items-center gap-1">
          <NextStep order={order} owed={owed} size="default" className="min-w-0 flex-1 gap-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground" aria-label={`Actions for ${order.id}`}>
                {status.busy || printing ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {making && <DropdownMenuItem onSelect={() => setAdvanceOpen(true)}><CreditCard className="mr-2 h-4 w-4" />Record an advance</DropdownMenuItem>}
              {stage === 'karigar' && <DropdownMenuItem onSelect={() => { void status.markReady(); }}><CheckCircle2 className="mr-2 h-4 w-4" />Mark ready</DropdownMenuItem>}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><RefreshCw className="mr-2 h-4 w-4" />Set status</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {ORDER_STATUSES.filter(st => st !== 'Refunded').map(st => (
                    <DropdownMenuItem key={st} onSelect={() => status.change(st)}>
                      {st}{st === order.status ? ' ✓' : ''}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onSelect={() => { void print(); }}><Printer className="mr-2 h-4 w-4" />Print slip</DropdownMenuItem>
              {hrefs && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild><a href={hrefs.tel}><Phone className="mr-2 h-4 w-4" />Call</a></DropdownMenuItem>
                  <DropdownMenuItem asChild><a href={hrefs.whatsapp} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-2 h-4 w-4" />WhatsApp</a></DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><Link href={`/orders/${order.id}`}><ExternalLink className="mr-2 h-4 w-4" />Open the order</Link></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {advanceOpen && <RecordAdvanceDialog order={order} open onOpenChange={o => !o && setAdvanceOpen(false)} />}
      {status.dialog}
    </SwipeRow>
  );
};

const OrderTableRow: React.FC<{ order: Order; owed: number; mine?: boolean }> = ({ order, owed, mine }) => {
  const { print, busy } = usePrintSlip(order);
  const status = useStatusChange(order);

  const safeItems = Array.isArray(order.items) ? order.items : [];
  const completedItems = safeItems.filter(item => item.isCompleted).length;
  const totalItems = safeItems.length;
  const progressPercentage = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;
  const unassignedItems = safeItems.filter(item => !item.karigarId || item.karigarId === 'none').length;
  const grandTotal = typeof order.grandTotal === 'number' ? order.grandTotal : 0;
  const advancePayment = typeof order.advancePayment === 'number' ? order.advancePayment : 0;
  const subtotal = typeof order.subtotal === 'number' ? order.subtotal : 0;
  const greyed = !!order.invoiceId || stageOf(order, owed) === 'done';
  const tone = statusTone(order.status);
  const pay = getPaymentStatus(order);

  return (
    <>
      {/* Invoiced, paid or not, is quieter (the owner, 2026-10-06): the order's work is done and its money is the invoice's. */}
      <TableRow data-mine={mine ? 'true' : undefined} title={mine ? 'Taken by you' : undefined} className={cn(mine && 'bg-primary/[.06]')}>
        <TableCell className="font-medium align-top">
          <div className="flex items-center gap-2">
            <Link href={`/orders/${order.id}`} className="text-foreground hover:underline">
              {order.id}
            </Link>
            {mine && <MineTag />}
            {order.source === 'website' && order.website && <OnlineBadge onlineId={order.website.onlineId} />}
          </div>
          {/* Count first: it is the scannable part, and the item list is
              going to truncate whatever happens. */}
          <p className="text-ios-cap text-muted-foreground max-w-[13rem] mt-0.5 truncate font-normal" title={order.summary}>
            {totalItems > 0 && <span className="tabular-nums">{totalItems} item{totalItems === 1 ? '' : 's'}</span>}
            {totalItems > 0 && order.summary ? ' · ' : ''}
            {order.summary || (totalItems === 0 ? 'No items' : '')}
          </p>
        </TableCell>
        <TableCell className="hidden lg:table-cell align-top">
          {/* Taken on top, promised underneath: the promise is the one you chase against, so it gets the colour when it has passed. */}
          <div className="whitespace-nowrap leading-tight">
            <p className="text-ios-sub">{format(parseISO(order.createdAt), parseISO(order.createdAt).getFullYear() === new Date().getFullYear() ? 'd MMM' : 'd MMM yyyy')}</p>
            <PromiseLine order={order} icon={false} />
          </div>
        </TableCell>
        <TableCell className="align-top">
          <div className="flex min-w-0 items-center gap-2.5">
            <Monogram name={customerOf(order)} size={32} className="hidden min-[1400px]:inline-flex" />
            <div className="min-w-0 leading-tight">
              <p className={cn('text-ios-sub font-medium truncate', greyed && 'text-muted-foreground')}>{customerOf(order)}</p>
              {order.customerContact && (
                <p className="text-ios-cap text-muted-foreground tabular-nums whitespace-nowrap">{order.customerContact}</p>
              )}
              {/* Where the Financials column is hidden, the one thing it said that you chase: payment and what is left. */}
              <div className="mt-1 flex items-center gap-1.5 min-[1400px]:hidden">
                <Pill tone={PAYMENT_TONE[pay]}>{pay}</Pill>
                <span className="text-ios-cap text-muted-foreground tabular-nums whitespace-nowrap">Bal <span className="font-semibold text-foreground">{grandTotal.toLocaleString()}</span></span>
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className="hidden min-[1400px]:table-cell text-right align-top">
          <div className="flex flex-col items-end gap-0.5 leading-tight whitespace-nowrap">
            <Pill tone={PAYMENT_TONE[pay]}>{pay}</Pill>
            <div className="text-ios-cap text-muted-foreground">Bal: <span className="font-semibold text-foreground tabular-nums">{grandTotal.toLocaleString()}</span></div>
            <div className="text-ios-cap text-muted-foreground">Adv: <span className="font-semibold text-foreground tabular-nums">{advancePayment.toLocaleString()}</span></div>
            <div className="text-ios-cap text-muted-foreground border-t border-separator mt-1 pt-1">Total: <span className="font-semibold text-foreground tabular-nums">{subtotal.toLocaleString()}</span></div>
          </div>
        </TableCell>
        <TableCell className="align-top">
          {/* The trigger IS the pill. */}
          <div className="flex flex-col gap-1.5 min-w-[9.5rem]">
            {status.busy ? (
              <span className="inline-flex h-7 items-center gap-1.5 text-ios-cap text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…
              </span>
            ) : (
              <Select onValueChange={(val) => status.change(val as OrderStatus)} defaultValue={order.status}>
                <SelectTrigger
                  id={`status-update-${order.id}`}
                  aria-label={`Status: ${order.status}`}
                  className={cn(
                    'h-7 w-fit gap-1 rounded-full border-transparent px-2.5 text-ios-cap font-semibold [@media(pointer:coarse)]:!min-h-7',
                    'focus:ring-0 focus:ring-offset-0 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-80',
                    toneClasses(tone).tint, toneClasses(tone).ink,
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORDER_STATUSES.filter(st => st !== 'Refunded' || st === order.status).map(st => (
                    <SelectItem key={st} value={st} disabled={st === 'Refunded'}>{st}</SelectItem>
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
                    <span className="text-tone-late-ink whitespace-nowrap">{unassignedItems} unassigned</span>
                  )}
                </div>
                <Progress value={progressPercentage} className="h-1" />
              </div>
            )}
            <NextStep order={order} owed={owed} className="-ml-0.5" compact />
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="inline-flex items-center gap-1.5">
            <Button type="button" size="sm" variant="outline" onClick={print} disabled={busy} aria-label="Print slip" title="Print the workshop slip">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              <span className="sr-only">Print</span>
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {status.dialog}
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

type GroupBy = 'stage' | 'status' | 'due' | Graduation;

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'stage', label: 'Stage' },
  { value: 'due', label: 'Due' },
  ...GRADUATIONS.filter(g => g.id !== 'day').map(g => ({ value: g.id as GroupBy, label: g.label })),
];

const STATUS_CHIPS: (OrderStatus | 'All')[] = ['All', 'Pending', 'In Progress', 'Completed', 'Cancelled'];

export default function OrdersPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'All'>('All');
  // Starts on whoever is signed in (lib/people.ts); Anyone is one tap away.
  // Everyone's orders to start with; the signed-in person's own are highlighted, not filtered (2026-10-05).
  const [takenByFilter, setTakenByFilter] = useMineFilter('orders', { startOnMe: false });
  const me = useMe();
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | 'All'>('All');
  const [monthFilter, setMonthFilter] = useState<string>('All');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const appReady = useAppReady();
  const { orders, isOrdersLoading, loadOrders, invoices, loadGeneratedInvoices } = useAppStore(state => ({
    orders: state.orders,
    isOrdersLoading: state.isOrdersLoading,
    loadOrders: state.loadOrders,
    invoices: state.generatedInvoices,
    loadGeneratedInvoices: state.loadGeneratedInvoices,
  }));

  useEffect(() => {
    if (appReady) {
      loadOrders();
      loadGeneratedInvoices();
    }
  }, [appReady, loadOrders, loadGeneratedInvoices]);

  /** What each invoiced order's invoice still has owing: the hub's "Awaiting payment". */
  const owedOn = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of invoices) if (inv.status !== 'Refunded' && (Number(inv.balanceDue) || 0) > 0.5) m.set(inv.id, Number(inv.balanceDue));
    return m;
  }, [invoices]);
  const owedFor = (o: Order) => (o.invoiceId ? owedOn.get(o.invoiceId) ?? 0 : 0);
  const [openDone, setOpenDone] = useState<Record<string, boolean>>({});

  // Build the list of months present in the data, most recent first.
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      const k = monthKeyOf(o.createdAt);
      if (k) set.add(k);
    }
    return Array.from(set).sort().reverse();
  }, [orders]);

  /**
   * By day to start with (the owner, 2026-10-05); Stage is a tap away, and Due, the app's own cut:
   * the open orders by how soon each was promised, Late first.
   */
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  // One reading of the clock for the whole list, so the Due view does not disagree with itself.
  const [now] = useState(() => new Date());

  /** Every filter but the status: the status chips count what they would show. */
  const matchesExceptStatus = (order: Order) =>
    (!takenByFilter || order.takenBy === takenByFilter) &&
    (paymentFilter === 'All' || getPaymentStatus(order) === paymentFilter) &&
    (monthFilter === 'All' || monthKeyOf(order.createdAt) === monthFilter) &&
    (
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (order.customerName && order.customerName.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (order.customerContact && order.customerContact.includes(searchTerm)) ||
      // The customer quotes the ONL- number they were given.
      (!!order.website?.onlineId && order.website.onlineId.toLowerCase().includes(searchTerm.toLowerCase()))
    );

  const filteredOrders = useMemo(() => {
    if (!appReady) return [];
    return orders.filter(order => (statusFilter === 'All' || order.status === statusFilter) && matchesExceptStatus(order))
      .sort((a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime());
  }, [orders, searchTerm, appReady, statusFilter, paymentFilter, monthFilter, takenByFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusCounts = useMemo(() => {
    const out: Record<string, number> = { All: 0 };
    if (!appReady) return out;
    for (const o of orders) {
      if (!matchesExceptStatus(o)) continue;
      out.All += 1;
      out[o.status] = (out[o.status] ?? 0) + 1;
    }
    return out;
  }, [orders, searchTerm, appReady, paymentFilter, monthFilter, takenByFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Only the in-progress count is shown now; the tiles are gone. */
  const activeCount = useMemo(
    () => filteredOrders.filter(o => o.status === 'Pending' || o.status === 'In Progress').length,
    [filteredOrders],
  );

  const filterCount = [monthFilter, statusFilter, paymentFilter].filter(v => v !== 'All').length + (takenByFilter ? 1 : 0);
  /** The sheet's own count: the status has its chips. */
  const sheetCount = [monthFilter, paymentFilter].filter(v => v !== 'All').length + (takenByFilter ? 1 : 0);

  /** The list broken into sections, each carrying its own totals. */
  const sections = useMemo(() => {
    const out: { key: string; title: string; hint: string; late?: boolean; rows: Order[] }[] = [];
    const push = (key: string, title: string, hint: string, rows: Order[], late?: boolean) => {
      if (rows.length) out.push({ key, title, hint, rows, late });
    };

    if (groupBy === 'stage') {
      for (const st of STAGE_ORDER) {
        push(st, STAGES[st].title, STAGES[st].hint, filteredOrders.filter(o => stageOf(o, owedFor(o)) === st));
      }
    } else if (groupBy === 'due') {
      // The open orders by their promise; in each section the soonest promise first (so the latest of the
      // late), and the undated oldest first, as they have waited longest (the app's dueGroups).
      const groups = new Map(dueGroups(filteredOrders, now).map(g => [g.bucket, g.orders]));
      for (const b of DUE_BUCKETS) push(`due-${b.key}`, b.title, b.hint, groups.get(b.key) ?? [], b.key === 'late');
    } else if (groupBy === 'status') {
      // Ordered the way work moves, so the list reads as a pipeline.
      for (const st of ORDER_STATUSES) {
        push(st, st, st === 'Pending' ? 'not started' : '', filteredOrders.filter(o => o.status === st));
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
    }));
  }, [filteredOrders, groupBy, owedOn, now]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Done and closed orders fold away under the hub; they are history, not work. */
  const folds = (key: string) => groupBy === 'stage' && (key === 'done' || key === 'closed') && !openDone[key];

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  const filtering = !!searchTerm || statusFilter !== 'All' || paymentFilter !== 'All' || monthFilter !== 'All' || !!takenByFilter;
  const groupControl = (
    <Segmented<GroupBy> label="Show by" value={groupBy} options={GROUP_OPTIONS} onChange={setGroupBy} className="w-full lg:w-auto" />
  );

  const monthSelect = (cls?: string) => (
    <Select value={monthFilter} onValueChange={setMonthFilter}>
      <SelectTrigger className={cls} aria-label="Month"><SelectValue placeholder="Month" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="All">All time</SelectItem>
        {monthOptions.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const paymentSelect = (cls?: string) => (
    <Select value={paymentFilter} onValueChange={v => setPaymentFilter(v as typeof paymentFilter)}>
      <SelectTrigger className={cls} aria-label="Payment"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="All">Any payment</SelectItem>
        {(['Paid', 'Partial', 'Unpaid'] as const).map(ps => <SelectItem key={ps} value={ps}>{ps}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const nothingOpen = groupBy === 'due' && filteredOrders.length > 0 && sections.length === 0;

  return (
    <PageShell
      subtitle={<>
        {filteredOrders.length === orders.length
          ? `${orders.length} order${orders.length === 1 ? '' : 's'}`
          : `${filteredOrders.length} of ${orders.length} orders`}
        {activeCount > 0 && ` · ${activeCount} in progress`}
      </>}
      action={
        <Button asChild size="sm" className="flex-shrink-0">
          <Link href="/orders/add"><PlusCircle className="w-4 h-4 mr-2" />New order</Link>
        </Button>
      }
    >

      {/* Phone and tablet: the app's controls. Search, Show by, status chips with counts, and the rest of the filters in a sheet. */}
      <div className="space-y-3 lg:hidden">
        <SearchField value={searchTerm} onChange={setSearchTerm} placeholder="Search orders and customers" />
        {groupControl}
        <ChipRow label="Status">
          {STATUS_CHIPS.filter(st => st === 'All' || (statusCounts[st] ?? 0) > 0 || statusFilter === st).map(st => (
            <FilterChip
              key={st}
              title={st === 'All' ? 'All' : st}
              count={statusCounts[st] ?? 0}
              chosen={statusFilter === st}
              onClick={() => setStatusFilter(st)}
            />
          ))}
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label={sheetCount ? `Filters, ${sheetCount} on` : 'Filters'}
            className={cn(
              'inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-[13px] text-ios-sub font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              sheetCount ? 'bg-primary/[.12] text-primary' : 'border border-muted-foreground/[.18] bg-card text-foreground',
            )}
          >
            <SlidersHorizontal aria-hidden className="h-4 w-4" />Filters{sheetCount ? <span className="tabular-nums">{sheetCount}</span> : null}
          </button>
        </ChipRow>
      </div>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="bottom" className="max-h-[92dvh] space-y-4 overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:hidden">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription className="sr-only">Month, who took the order, and payment.</SheetDescription>
          </SheetHeader>
          <div className="space-y-1.5">
            <p className="px-1 text-2xs font-semibold uppercase tracking-[.6px] text-muted-foreground">Month</p>
            {monthSelect('w-full')}
          </div>
          <div className="space-y-1.5">
            <p className="px-1 text-2xs font-semibold uppercase tracking-[.6px] text-muted-foreground">Taken by</p>
            <TakenByPicker value={takenByFilter} onChange={setTakenByFilter} allowAny anyLabel="Anyone" aria-label="Taken by" className="w-full" />
          </div>
          <div className="space-y-1.5">
            <p className="px-1 text-2xs font-semibold uppercase tracking-[.6px] text-muted-foreground">Payment</p>
            {paymentSelect('w-full')}
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              type="button" variant="outline" className="flex-1" disabled={sheetCount === 0}
              onClick={() => { setMonthFilter('All'); setPaymentFilter('All'); setTakenByFilter(undefined); }}
            >
              Reset
            </Button>
            <Button type="button" className="flex-1" onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Desktop: the inline controls. */}
      <div className="hidden lg:block">
        <FilterBar
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search by order, customer or phone"
          activeCount={filterCount}
          footer={<div className="flex"><div className="w-full max-w-md">{groupControl}</div></div>}
        >
          {monthSelect('w-full sm:w-[150px]')}

          <TakenByPicker value={takenByFilter} onChange={setTakenByFilter} allowAny anyLabel="Anyone" aria-label="Taken by" className="w-full sm:w-[140px]" />

          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as typeof statusFilter)}>
            <SelectTrigger className="w-full sm:w-[145px]" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">Any status</SelectItem>
              {ORDER_STATUSES.map(st => <SelectItem key={st} value={st}>{st}</SelectItem>)}
            </SelectContent>
          </Select>

          {paymentSelect('w-full sm:w-[150px]')}
        </FilterBar>
      </div>

      {/* Online orders waiting to be confirmed: not orders yet, so above the list (online-inbox.tsx). */}
      <OnlineInbox />

      {isOrdersLoading ? (
        <ListSkeleton rows={5} />
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="No orders found"
          description={filtering ? 'Try adjusting the search or filters.' : 'Create a custom order to begin.'}
        />
      ) : nothingOpen ? (
        <EmptyState
          icon={<CalendarCheck />}
          title="Nothing to chase"
          description="Every order here is invoiced or closed. Day and Stage show them all."
        />
      ) : (
        <div className="space-y-4">
          {/* Cards below lg (the app's list); one table from lg, not one per group. Grouping by day put
              79 separate <Table> elements on this page for 124 orders: 79 scroll containers and 79
              repeated column headers. The group heading is a row inside the single table. */}
          <div className="space-y-5 cv-list lg:hidden">
            {sections.map(s => (
              // Skipped while off screen (globals.css .cv-list); a card is ~200px tall on a phone.
              <section key={s.key} aria-label={s.title} style={{ '--cv-size': `${52 + s.rows.length * 212}px` } as React.CSSProperties}>
                <div className="space-y-0.5 pb-2">
                  <LedgerHeading title={s.title} count={s.rows.length} trailing={pkrLac(s.value)} tone={s.late ? 'late' : 'quiet'} />
                  {s.hint && <p className="truncate px-1 text-ios-cap text-muted-foreground">{s.hint}</p>}
                </div>
                {folds(s.key)
                  ? (
                    <button
                      type="button"
                      className="flex min-h-11 w-full items-center rounded-card bg-card px-4 text-left text-ios-sub text-muted-foreground"
                      onClick={() => setOpenDone(d => ({ ...d, [s.key]: true }))}
                    >
                      Show {s.rows.length} order{s.rows.length === 1 ? '' : 's'}
                    </button>
                  )
                  : (
                    <div className="space-y-3 md:grid md:grid-cols-2 md:gap-3 md:space-y-0">
                      {s.rows.map(order => (
                        <div key={order.id} className="overflow-hidden rounded-card bg-card">
                          <OrderCard order={order} owed={owedFor(order)} mine={!!me && order.takenBy === me} />
                        </div>
                      ))}
                    </div>
                  )}
              </section>
            ))}
          </div>

          <Card className="hidden lg:block">
            <CardContent className="p-0 scroll-shadow-x overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead className="hidden lg:table-cell">Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden min-[1400px]:table-cell text-right">Financials (PKR)</TableHead>
                    <TableHead>Status &amp; progress</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections.map(s => (
                    <React.Fragment key={s.key}>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        <TableCell colSpan={6} className="py-2">
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="flex items-baseline gap-2 min-w-0">
                              <span className={cn('font-serif text-ios-headline font-semibold truncate', s.late ? 'text-tone-late-ink' : 'text-foreground')}>{s.title}</span>
                              {s.hint && <span className="text-ios-cap text-muted-foreground flex-shrink-0">{s.hint}</span>}
                            </div>
                            <div className="flex items-baseline gap-2 flex-shrink-0">
                              <span className="text-ios-cap text-muted-foreground tabular-nums">{s.rows.length}</span>
                              <span className="text-ios-sub font-medium tabular-nums text-muted-foreground">{pkrLac(s.value)}</span>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                      {folds(s.key)
                        ? <TableRow><TableCell colSpan={6} className="py-1.5"><button type="button" className="text-ios-sub text-muted-foreground hover:text-foreground" onClick={() => setOpenDone(d => ({ ...d, [s.key]: true }))}>Show {s.rows.length}</button></TableCell></TableRow>
                        : s.rows.map(order => <OrderTableRow key={order.id} order={order} owed={owedFor(order)} mine={!!me && order.takenBy === me} />)}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* The slip's footer reads its QR off this canvas -- same as the invoices page. */}
      <div style={{ display: 'none' }} aria-hidden>
        <QRCode id="links-qr-code" value={storeLinksUrl() || STORE_CONFIG.appUrl} size={128} />
      </div>
    </PageShell>
  );
}
