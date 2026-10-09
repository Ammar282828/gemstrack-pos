

"use client";

import { authedFetch } from '@/lib/voice/authed-fetch';
import { OrderPhoto } from '@/components/order/order-photo';
import React, { useState, useEffect, useRef } from 'react';
import { ListSkeleton } from '@/components/shared/skeletons';
import { whatsAppLink } from '@/lib/whatsapp';
import { describePlating } from '@/lib/materials';
import { generateOrderSlipPDF } from '@/lib/order-slip-pdf';
import { STORE_CONFIG, storeLinksUrl, STORE_LOGO_URL } from '@/lib/store-config';
import { METAL_TYPES as metalTypeValues, describeMetal, describeDelivery } from '@/lib/materials';
import { categorySingular } from '@/lib/categories';
import { KarigarAssign, KarigarBulkAssign } from '@/components/karigar/karigar-assign';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, Order, OrderStatus, ORDER_STATUSES, KaratValue, OrderItem, Settings, Invoice, Product, MetalType, Karigar, CUSTOMER_SOURCE_LABELS, PAYMENT_TYPES } from '@/lib/store';
import { orderExchanges, describeExchangeEntry } from '@/lib/exchange';
import { getOrderPaymentStatus, orderAdvancePayments, type PaymentStatus as OrderPaymentStatus } from '@/lib/order-payment';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { WebsiteOrderPanel } from '@/components/order/website-order-panel';
import { FinalizeOrderDialog, RecordAdvanceDialog } from '@/components/order/order-dialogs';
import { MarginFigure } from '@/components/shared/shop-margin';
import { orderMargin } from '@/lib/margin';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, DollarSign, Calendar, Edit, Loader2, Diamond, Gem, MessageSquare, FileText, Weight, Percent, Printer, Briefcase, CreditCard, RotateCcw, Truck, PackageSearch, ExternalLink, Trash2, Lock, ShoppingBag, MoreHorizontal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { cn, normalizePhoneNumber } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Control, useForm, useFieldArray } from 'react-hook-form';
import 'react-phone-number-input/style.css'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import QRCode from 'qrcode.react';
import { AmountInput } from '@/components/ui/amount-input';
import { PageBack } from '@/components/shared/page-back';
import { PromiseLine } from '@/components/shared/promise-line';
import { PhoneField } from '@/components/ui/phone-field';
import { auth as firebaseAuth } from '@/lib/firebase';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { deleteErrorText } from '@/lib/delete-code';


const getStatusBadgeVariant = (status: OrderStatus) => {
    switch (status) {
      case 'Pending': return 'bg-warning text-warning-foreground';
      case 'In Progress': return 'bg-blue-500/80 text-blue-50';
      case 'Completed': return 'bg-success text-success-foreground';
      case 'Cancelled': return 'bg-destructive text-destructive-foreground';
      case 'Refunded': return 'bg-purple-500/80 text-purple-50';
      default: return 'secondary';
    }
};

type PaymentStatus = OrderPaymentStatus;
const getPaymentStatus = getOrderPaymentStatus;
const getPaymentBadgeClass = (status: PaymentStatus) => {
  switch (status) {
    case 'Paid': return 'bg-success text-success-foreground';
    case 'Partial': return 'bg-orange-500/80 text-orange-50';
    case 'Unpaid': return 'bg-destructive text-destructive-foreground';
  }
};


type PhoneForm = {
    phone: string;
};

type NotificationType = 'inProgress' | 'completed' | 'summary';

// ─── Courier ─────────────────────────────────────────────────────────────────

/**
 * Booking a courier the way the shop already does it.
 *
 * TCS is booked by fulfilling the order in Shopify: the Universal Courier app
 * watches for the fulfilment and raises the Envio consignment, then writes the
 * tracking number back onto the Shopify order. So there is nothing here that
 * talks to a courier — this performs the one action that starts the chain.
 *
 * It needs a Shopify order to fulfil. Custom orders taken in the shop do not
 * have one, and creating one would publish a private order to the storefront,
 * so the option explains itself rather than appearing broken.
 */
const ShopifyCourierOption: React.FC<{ order: Order; onDone: () => void }> = ({ order, onDone }) => {
  const { toast } = useToast();
  const updateOrder = useAppStore(s => s.updateOrder);
  const [busy, setBusy] = useState<null | 'creating' | 'fulfilling'>(null);
  const [notify, setNotify] = useState(false);
  const linked = order.shopifyOrderId;
  const delivering = !!order.delivery?.required && !!order.delivery.address?.trim();

  const authHeader = async (): Promise<Record<string, string>> => {
    try {
      const tk = await firebaseAuth?.currentUser?.getIdToken();
      return tk ? { Authorization: `Bearer ${tk}` } : {};
    } catch { return {}; }
  };

  const run = async () => {
    try {
      let shopifyOrderId = linked;

      // A custom order has no Shopify order behind it, so one is made first —
      // with custom line items, never variants, so nothing joins the product
      // catalogue.
      if (!shopifyOrderId) {
        setBusy('creating');
        const res = await fetch('/api/shopify/push/from-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ orderId: order.id }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Could not create the Shopify order');
        shopifyOrderId = json.shopifyOrderId;
        await updateOrder(order.id, {
          shopifyOrderId: json.shopifyOrderId,
          shopifyOrderNumber: json.shopifyOrderNumber,
        });
        toast({
          title: `Shopify order #${json.shopifyOrderNumber} created`,
          description: json.hasShippingAddress
            ? 'Delivery address attached.'
            : 'No delivery address on this order — add one so the courier has somewhere to send it.',
        });
      }

      setBusy('fulfilling');
      const res = await fetch('/api/shopify/fulfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ shopifyOrderId, notifyCustomer: notify }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Shopify refused the fulfilment');
      toast({ title: 'Sent for booking', description: json.message });
      onDone();
    } catch (e: unknown) {
      toast({ title: 'Could not book', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {!delivering && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
          This order has no delivery address. It can still be booked, but the courier will have
          nowhere to send it — add one on the order first.
        </div>
      )}

      <ol className="text-xs text-muted-foreground space-y-1.5">
        <li className="flex gap-2">
          <span className={cn('font-mono', linked && 'line-through opacity-60')}>1.</span>
          <span className={cn(linked && 'line-through opacity-60')}>
            {linked
              ? `Shopify order #${order.shopifyOrderNumber ?? linked} already exists`
              : 'Create a matching Shopify order — custom lines only, nothing added to your catalogue'}
          </span>
        </li>
        <li className="flex gap-2"><span className="font-mono">2.</span><span>Fulfil it in Shopify</span></li>
        <li className="flex gap-2"><span className="font-mono">3.</span><span>Universal Courier raises the Envio consignment and returns the tracking number</span></li>
      </ol>

      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <Checkbox checked={notify} onCheckedChange={v => setNotify(!!v)} />
        {/* Off by default: the email worth sending is the one with a tracking
            number, and that does not exist until Envio has booked it. */}
        Email the customer now — before there is a tracking number
      </label>

      <Button size="sm" onClick={run} disabled={!!busy} className="w-full">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
        {busy === 'creating' ? 'Creating the Shopify order…'
          : busy === 'fulfilling' ? 'Fulfilling…'
          : linked ? 'Fulfil in Shopify' : 'Create and book'}
      </Button>
    </div>
  );
};

const BookCourierDialog: React.FC<{
  order: Order;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}> = ({ order, open, onOpenChange }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="flex items-center">
          <Truck className="mr-2 h-5 w-5" /> Book courier
        </DialogTitle>
        <DialogDescription>
          Booking happens in Shopify: Universal Courier watches for the fulfilment and raises the
          Envio consignment.
        </DialogDescription>
      </DialogHeader>
      <ShopifyCourierOption order={order} onDone={() => onOpenChange(false)} />
    </DialogContent>
  </Dialog>
);

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const orderId = params.id as string;

  const isHydrated = useIsStoreHydrated();
  const order = useAppStore(state => state.orders.find(o => o.id === orderId));
  const settings = useAppStore(state => state.settings);
  const invoices = useAppStore(state => state.generatedInvoices);
  const { updateOrderStatus, updateOrderItemStatus, removeItemFromOrder, updateOrder, karigars, loadKarigars, revertOrderFromInvoice, refundOrder, loadGeneratedInvoices, loadOrders, deleteOrderAdvance, deleteOrder } = useAppStore();
  // The page loads its own orders: opened straight from a link or a reload it used to say "Order not
  // found", since only the Orders list ever started them.
  const ordersSettled = useAppStore(state => state.hasOrdersLoaded || !!state.ordersError);

  const linkedInvoice = order?.invoiceId ? invoices.find(inv => inv.id === order.invoiceId) : null;

  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isUpdatingItem, setIsUpdatingItem] = useState<number | null>(null);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);
  const [isDeletingItem, setIsDeletingItem] = useState(false);

  const [isNotificationDialogOpen, setIsNotificationDialogOpen] = useState(false);
  const [notificationType, setNotificationType] = useState<NotificationType | null>(null);
  const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = useState(false);
  // ?do=finalize: the voice assistant asked for this order to be invoiced (lib/voice/commands.ts).
  const doParam = useSearchParams().get('do');
  const finalizeAsked = useRef(false);
  useEffect(() => {
    if (doParam !== 'finalize' || finalizeAsked.current || !order) return;
    finalizeAsked.current = true;
    if (!order.invoiceId) setIsFinalizeDialogOpen(true);
  }, [doParam, order]);
  // ?do=slip: an older iPhone app's Print slip (today's fetches it from /api/app/pdf/order-slip/<id>). The
  // slip is drawn by the one builder (lib/order-slip-pdf.ts) and handed to the phone's share sheet
  // (print, Files, WhatsApp): lib/native-app.ts, savePDF.
  const slipAsked = useRef(false);
  const [isAdvanceDialogOpen, setIsAdvanceDialogOpen] = useState(false);
  const [isRevertDialogOpen, setIsRevertDialogOpen] = useState(false);
  const [isReverting, setIsReverting] = useState(false);
  const [isRevertAndEditDialogOpen, setIsRevertAndEditDialogOpen] = useState(false);
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [isBookCourierOpen, setIsBookCourierOpen] = useState(false);
  const [trackingInfo, setTrackingInfo] = useState<{ summary: string; checkpoints: { datetime: string; status: string }[] } | null>(null);
  const [isTracking, setIsTracking] = useState(false);

  useEffect(() => {
    loadOrders();
    loadKarigars();
    loadGeneratedInvoices();
  }, [loadOrders, loadKarigars, loadGeneratedInvoices]);

  const phoneForm = useForm<PhoneForm>();

  useEffect(() => {
    if(order?.customerContact) {
      phoneForm.setValue('phone', normalizePhoneNumber(order.customerContact));
    }
  }, [order, phoneForm]);

  const handleRevert = async () => {
    if (!order?.invoiceId) return;
    setIsReverting(true);
    try {
        await revertOrderFromInvoice(order.id, order.invoiceId);
        toast({ title: "Order Reverted", description: `Invoice ${order.invoiceId} has been cancelled and order is now editable.` });
        setIsRevertDialogOpen(false);
    } catch (e) {
        toast({ title: "Error", description: deleteErrorText(e, "Failed to revert order."), variant: "destructive" });
    } finally {
        setIsReverting(false);
    }
  };

  const handleRevertAndEdit = async () => {
    if (!order?.invoiceId) return;
    setIsReverting(true);
    try {
        await revertOrderFromInvoice(order.id, order.invoiceId);
        toast({ title: "Invoice Cancelled", description: `Invoice ${order.invoiceId} removed. You can now edit the order.` });
        setIsRevertAndEditDialogOpen(false);
        router.push(`/orders/${order.id}/edit`);
    } catch (e) {
        toast({ title: "Error", description: deleteErrorText(e, "Failed to cancel invoice before editing."), variant: "destructive" });
    } finally {
        setIsReverting(false);
    }
  };

  const handleTcsTrack = async () => {
    if (!order?.tcsConsignmentNo) return;
    setIsTracking(true);
    try {
      const res = await authedFetch('/api/tcs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'track', consignmentNo: order.tcsConsignmentNo }),
      });
      const data = await res.json();
      if (data.message === 'SUCCESS' || data.checkpoints) {
        setTrackingInfo({
          summary: data.shipmentsummary || 'No summary available.',
          checkpoints: (data.checkpoints || []).slice(0, 5),
        });
      } else {
        toast({ title: 'Tracking Failed', description: data.shipmentsummary || data.error || 'No data found.', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Network Error', description: 'Could not reach TCS API.', variant: 'destructive' });
    } finally {
      setIsTracking(false);
    }
  };


  const handleRefund = async () => {
    if (!order) return;
    setIsRefunding(true);
    try {
        await refundOrder(order.id);
        toast({ title: "Order Refunded", description: `Order ${order.id} has been marked as refunded and stock restored.` });
        setIsRefundDialogOpen(false);
    } catch (e) {
        toast({ title: "Not refunded", description: e instanceof Error ? e.message : "Failed to process refund.", variant: "destructive" });
    } finally {
        setIsRefunding(false);
    }
  };

  // Deletes ask for the delete code in the store (lib/delete-code.ts).
  const handleDeleteAdvance = async (index: number, amount: number) => {
    if (!order) return;
    try {
      const updated = await deleteOrderAdvance(order.id, index);
      toast({ title: 'Advance deleted', description: `PKR ${amount.toLocaleString()} taken off ${order.id}. Balance now PKR ${updated.grandTotal.toLocaleString()}.` });
    } catch (e) {
      toast({ title: 'Not deleted', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };
  const handleDeleteOrder = async () => {
    if (!order) return;
    try {
      await deleteOrder(order.id);
      toast({ title: `Order ${order.id} deleted` });
      router.push('/orders');
    } catch (e) {
      toast({ title: 'Not deleted', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  // Cancelling asks first, as it does on the list; Refunded is not offered here — "Refund order" in the
  // ⋯ menu does a refund (the invoice undone, stock back, the delete code), the pill only relabelled it.
  const [confirmStatus, setConfirmStatus] = useState<OrderStatus | null>(null);
  const handleStatusChange = async (newStatus: OrderStatus, confirmed = false) => {
    if (!order) return;
    if (newStatus === 'Cancelled' && !confirmed) { setConfirmStatus(newStatus); return; }
    setIsUpdatingStatus(true);
    try {
        await updateOrderStatus(order.id, newStatus);
        toast({ title: "Status Updated", description: `Order ${order.id} status changed to "${newStatus}".` });
        // Note: the "Notify Customer via WhatsApp" dialog no longer auto-opens on
        // In Progress/Completed. Staff can still send a message manually via the
        // "Send to Customer" button.
    } catch (error) {
        toast({ title: "Error", description: "Failed to update order status.", variant: "destructive" });
    } finally {
        setIsUpdatingStatus(false);
    }
  };

  const handleItemStatusChange = async (itemIndex: number, isCompleted: boolean) => {
    if (!order) return;
    setIsUpdatingItem(itemIndex);
    try {
        await updateOrderItemStatus(order.id, itemIndex, isCompleted);
        toast({ title: "Item Status Updated", description: `Item #${itemIndex + 1} status updated.` });
    } catch (error) {
        toast({ title: "Error", description: "Failed to update item status.", variant: "destructive" });
    } finally {
        setIsUpdatingItem(null);
    }
  };

  const handleDeleteItem = async () => {
    if (!order || itemToDelete === null) return;
    setIsDeletingItem(true);
    try {
      await removeItemFromOrder(order.id, itemToDelete);
      toast({ title: "Item Removed", description: `Item #${itemToDelete + 1} removed from order.` });
    } catch (error: any) {
      toast({ title: "Error", description: error?.message || "Failed to remove item.", variant: "destructive" });
    } finally {
      setIsDeletingItem(false);
      setItemToDelete(null);
    }
  };

  const handleSendWhatsApp = () => {
    if(!order || !notificationType) return;

    const whatsAppNumber = phoneForm.getValues('phone');
    if (!whatsAppNumber) {
      toast({ title: "No Phone Number", description: "Please enter the customer's phone number.", variant: "destructive" });
      return;
    }

    let message = `Dear ${order.customerName || 'Customer'},\n\n`;
    
    if (notificationType === 'summary') {
        message += `Here is a summary of your custom order *#${order.id}* from ${settings.shopName}.\n\n`;
        order.items.forEach((item, index) => {
            message += `*Item ${index + 1}:* ${item.description}\n`;
            if (!item.isManualPrice) {
                message += `  - Est. Weight: ${item.estimatedWeightG}g ${item.karat ? `(${item.karat})` : ''}\n`;
            }
        });
        message += `\n*Total Balance Due:* PKR ${order.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
        message += `We are working on your order and will notify you of any updates.\n\n`;
    } else {
        message += `This is an update regarding your order *#${order.id}* from ${settings.shopName}.\n\n`;
        if (notificationType === 'inProgress') {
            message += `We are happy to inform you that your order is now *In Progress*. We will notify you again once it is ready for collection.\n\n`;
        } else if (notificationType === 'completed') {
            message += `Your custom order is now *Completed* and ready for collection.\n\n`;
            message += `*Amount Due:* PKR ${order.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
        }
    }
    
    message += `Thank you for your business.`;

    // Country code and leading-zero handling live in one place; the raw
    // digit strip that used to be here produced wa.me/0300… , a dead link.
    const whatsappUrl = whatsAppLink(whatsAppNumber, message);

    window.open(whatsappUrl, '_blank');
    toast({ title: "Redirecting to WhatsApp", description: "Your message is ready to be sent." });
    setIsNotificationDialogOpen(false); // Close dialog after sending
  };
  
  const handlePrintOrderSlip = async () => {
    // Wrapped because it was not: anything that threw while drawing became an
    // unhandled rejection, and the operator got no slip and no explanation.
    try {
      await buildOrderSlip();
    } catch (e) {
      console.error('[GemsTrack] order slip failed', e);
      toast({
        title: 'Could not create the slip',
        description: e instanceof Error ? e.message : 'Something went wrong while drawing it.',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    if (doParam !== 'slip' || slipAsked.current || !order || !settings) return;
    slipAsked.current = true;
    void handlePrintOrderSlip();
    // handlePrintOrderSlip reads the order and settings it is given; asked once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doParam, order, settings]);

  // The one slip builder (lib/order-slip-pdf.ts), as the orders list and the invoices page print it:
  // this page's copy of it was folded in so the server draws the same slip for the iPhone app.
  const buildOrderSlip = async () => {
    if (!order || typeof window === 'undefined' || !settings) return;
    await generateOrderSlipPDF(order, settings);
  };


  if (!isHydrated || (!order && !ordersSettled)) {
    return (
        <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
      );
  }

  if (!order) {
    return (
      <div className="container mx-auto py-8 px-4 flex flex-col items-center justify-center min-h-[calc(100vh-10rem)] text-center">
        <h2 className="text-2xl font-semibold">Order not found</h2>
        <Link href="/orders" passHref>
          <Button variant="link" className="mt-4">Go back to orders dashboard</Button>
        </Link>
      </div>
    );
  }

  // Always derive subtotal live from items so it stays consistent with item estimates
  const subtotal = order.items.reduce((sum, item) => sum + (Number(item.totalEstimate) || 0), 0);
  const advancePayment = typeof order.advancePayment === 'number' ? order.advancePayment : 0;
  const advanceInExchangeValue = typeof order.advanceInExchangeValue === 'number' ? order.advanceInExchangeValue : 0;
  // The discount was missing here, so this figure — the big "Balance Due" on the
  // page — overstated what was owed by exactly the discount, and disagreed with
  // both the slip and the stored grandTotal. Same shape as order-form and the
  // slip: price after discount, then less anything already paid.
  const discountAmount = typeof order.discountAmount === 'number' ? order.discountAmount : 0;
  const grandTotal = subtotal - discountAmount - advancePayment - advanceInExchangeValue;
  // The advances as they will land on the invoice: the one taken with the order, then each
  // recorded after it (lib/order-payment.ts).
  const advanceLines = orderAdvancePayments(order, '').map(a => ({ ...a, notes: a.notes?.replace(/^: /, '') || (a.date === order.createdAt ? 'With the order' : '') }));

  const ratesApplied = order.ratesApplied || {};
  
  const getRateDisplay = () => {
    const goldKarats = order.items.filter(i => i.metalType === 'gold').map(i => i.karat).filter((v, i, a) => a.indexOf(v) === i);
    if (goldKarats.length === 0) return 'N/A';
    return goldKarats.map(k => {
      const rate = ratesApplied[`goldRatePerGram${k}` as keyof typeof ratesApplied];
      return `Gold (${k?.toUpperCase()}): PKR ${Number(rate || 0).toLocaleString()}/g`;
    }).join(' | ');
  }


  return (
    <>
    <div className="container mx-auto py-8 px-4 space-y-6">
      <div style={{ display: 'none' }}>
        <img id="shop-logo" src={STORE_LOGO_URL} crossOrigin="anonymous" alt="" loading="lazy" decoding="async" />
        <QRCode id="wa-qr-code" value={STORE_CONFIG.whatsappUrl} size={128} />
          <QRCode id="links-qr-code" value={storeLinksUrl()} size={128} />
        <QRCode id="insta-qr-code" value={STORE_CONFIG.instagramUrl} size={128} />
      </div>
      <Dialog open={isNotificationDialogOpen} onOpenChange={setIsNotificationDialogOpen}>
        <DialogContent>
            <DialogHeader>
            <DialogTitle className="flex items-center"><MessageSquare className="mr-2 h-5 w-5"/>Notify Customer via WhatsApp</DialogTitle>
            <DialogDescription>
                {notificationType === 'summary' 
                    ? `Would you like to send a summary of this order to the customer?` 
                    : `The order status has been updated. Would you like to send a notification?`
                }
            </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
                 <div>
                    <Label htmlFor="whatsapp-number">Customer WhatsApp Number</Label>
                    <PhoneField
                        value={phoneForm.watch('phone') || undefined}
                        onChange={v => phoneForm.setValue('phone', v || '')}
                        aria-label="WhatsApp number"
                        className="mt-1"
                    />
                </div>
            </div>
            <DialogFooter>
            <Button variant="outline" onClick={() => setIsNotificationDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => phoneForm.handleSubmit(handleSendWhatsApp)()}>
                <MessageSquare className="mr-2 h-4 w-4"/> Send Message
            </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {order && <FinalizeOrderDialog order={order} open={isFinalizeDialogOpen} onOpenChange={setIsFinalizeDialogOpen} />}
      <AlertDialog open={!!confirmStatus} onOpenChange={o => { if (!o) setConfirmStatus(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel order {order?.id}?</AlertDialogTitle>
            <AlertDialogDescription>It leaves the Workshop and its Shopify draft is cancelled. It can be set back to Pending later.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { const st = confirmStatus; setConfirmStatus(null); if (st) handleStatusChange(st, true); }}>Cancel order</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {order && <RecordAdvanceDialog order={order} open={isAdvanceDialogOpen} onOpenChange={setIsAdvanceDialogOpen} />}
      {order && <BookCourierDialog order={order} open={isBookCourierOpen} onOpenChange={setIsBookCourierOpen} />}

      <AlertDialog open={isRevertDialogOpen} onOpenChange={setIsRevertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel invoice {order?.invoiceId}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently cancel invoice <strong>{order?.invoiceId}</strong> and revert this order back to &ldquo;In Progress&rdquo; so it can be edited and re-finalized. Any hisaab entries linked to the invoice will also be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReverting}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevert} disabled={isReverting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isReverting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Cancel invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isRevertAndEditDialogOpen} onOpenChange={setIsRevertAndEditDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock the order to edit it?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revert invoice <strong>{order?.invoiceId}</strong>, removing it and its ledger entries. Revenue calculations will be updated. You can re-finalize a new invoice after editing. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReverting}>Keep Locked</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevertAndEdit} disabled={isReverting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isReverting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Edit className="mr-2 h-4 w-4" />}
              Revert Invoice & Unlock
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <AlertDialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund this order?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark order <strong>{order?.id}</strong> as <strong>Refunded</strong>.
              {order?.invoiceId
                ? <> Invoice <strong>{order.invoiceId}</strong> will be permanently deleted, all hisaab entries removed, and items returned to stock.</>
                : ' The order record will be kept but removed from revenue calculations.'
              }{' '}This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRefunding}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRefund} disabled={isRefunding} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isRefunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Yes, Refund Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PageBack fallback="/orders" label="Back to orders" />

      <Card>
              <CardHeader>
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                        <div className="min-w-0">
                          {/* The id no longer wraps mid-word, and the line that
                              said "Details of the custom order" now carries the
                              two facts you actually came for. */}
                          <CardTitle className="text-2xl whitespace-nowrap">{order.id}</CardTitle>
                          <p className="text-sm text-muted-foreground mt-1">
                            {order.customerName || 'Walk-in'}
                            {' · '}
                            {format(parseISO(order.createdAt), 'd MMM yyyy')}
                            {getRateDisplay() !== 'N/A' && <> · {getRateDisplay()}</>}
                          </p>
                          {/* Its own line rather than another item in the run
                              above: when this one has gone red it is the thing
                              you opened the order to find out. */}
                          <PromiseLine order={order} className="mt-0.5 text-sm" />
                        </div>

                        {/* Three controls, not seven. Status was being said
                            three times over — a payment pill, a status pill and
                            an "Update Status" box that showed nothing. The
                            select is the status; payment sits beside it as a
                            badge; one action leads and the rest are one click
                            away rather than all competing at once. */}
                        <div className="flex items-center gap-2 flex-wrap lg:justify-end flex-shrink-0">
                          <Badge variant="outline" className={cn('h-8 px-2.5 gap-1.5 font-medium',
                            getPaymentStatus(order) === 'Unpaid' && 'text-destructive border-destructive/40 bg-destructive/5')}>
                            <CreditCard className="w-3.5 h-3.5" />{getPaymentStatus(order)}
                          </Badge>

                          <Select value={order.status} onValueChange={(val) => handleStatusChange(val as OrderStatus)} disabled={isUpdatingStatus}>
                            <SelectTrigger
                              id="status-update"
                              aria-label={`Status: ${order.status}`}
                              className={cn('h-8 w-fit gap-1 rounded-full border-transparent px-3 text-xs font-medium',
                                'focus:ring-0 focus:ring-offset-0 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:opacity-80',
                                getStatusBadgeVariant(order.status))}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ORDER_STATUSES.filter(st => st !== 'Refunded' || st === order.status).map(status => <SelectItem key={status} value={status} disabled={status === 'Refunded'}>{status}</SelectItem>)}
                            </SelectContent>
                          </Select>

                          {order.invoiceId ? (
                            <Button asChild size="sm">
                              <Link href={`/invoices/${order.invoiceId}`}>
                                <FileText className="mr-2 h-4 w-4" />Invoice {order.invoiceId}
                              </Link>
                            </Button>
                          ) : order.status === 'Completed' || order.status === 'In Progress' ? (
                            // Collected while still marked In Progress: finalizing completes it too, no detour through the pill.
                            <Button size="sm" variant={order.status === 'Completed' ? 'default' : 'outline'} onClick={() => setIsFinalizeDialogOpen(true)}>
                              <FileText className="mr-2 h-4 w-4" />Finalize &amp; invoice
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setIsBookCourierOpen(true)}>
                              <Truck className="mr-2 h-4 w-4" />Book courier
                            </Button>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="outline" size="sm" className="px-2" aria-label="More actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onClick={handlePrintOrderSlip}>
                                <Printer className="mr-2 h-4 w-4" />Print slip
                              </DropdownMenuItem>
                              {!order.invoiceId && order.status !== 'Cancelled' && order.status !== 'Refunded' && (
                                <DropdownMenuItem onClick={() => setIsAdvanceDialogOpen(true)}>
                                  <CreditCard className="mr-2 h-4 w-4" />Record an advance
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem onClick={() => { setNotificationType('summary'); setIsNotificationDialogOpen(true); }}>
                                <MessageSquare className="mr-2 h-4 w-4" />Send to customer
                              </DropdownMenuItem>
                              {order.tcsConsignmentNo ? (
                                <DropdownMenuItem onClick={handleTcsTrack} disabled={isTracking}>
                                  <PackageSearch className="mr-2 h-4 w-4" />Track {order.tcsConsignmentNo}
                                </DropdownMenuItem>
                              ) : order.invoiceId || order.status === 'Completed' ? (
                                <DropdownMenuItem onClick={() => setIsBookCourierOpen(true)}>
                                  <Truck className="mr-2 h-4 w-4" />Book courier
                                </DropdownMenuItem>
                              ) : null}
                              {!order.invoiceId && (
                                <DropdownMenuItem asChild>
                                  <Link href={`/orders/${order.id}/edit`}>
                                    <Edit className="mr-2 h-4 w-4" />Edit order
                                  </Link>
                                </DropdownMenuItem>
                              )}
                              {order.status !== 'Cancelled' && order.status !== 'Refunded' && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => setIsRefundDialogOpen(true)} className="text-destructive focus:text-destructive">
                                    <RotateCcw className="mr-2 h-4 w-4" />Refund order
                                  </DropdownMenuItem>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              {order.invoiceId ? (
                                <DropdownMenuItem disabled className="text-xs">
                                  <Trash2 className="mr-2 h-4 w-4" />Delete order: delete or undo {order.invoiceId} first
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={handleDeleteOrder} className="text-destructive focus:text-destructive">
                                  <Trash2 className="mr-2 h-4 w-4" />Delete order
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
              </CardHeader>
              <CardContent>
                  {order.source === 'website' && order.website && (
                    <div className="mb-6"><WebsiteOrderPanel order={order} /></div>
                  )}
                  {/* What the form captured and this page never showed: the
                      contact, who took the order, how they found us, where it
                      goes and any notes. The bench and the counter both need
                      these without opening the edit form. */}
                  {(() => {
                    const facts: [string, React.ReactNode][] = [];
                    if (order.customerContact) {
                      facts.push(['Contact', <a key="contact" href={`tel:${order.customerContact}`} className="hover:underline">{order.customerContact}</a>]);
                    }
                    if (order.takenBy) facts.push(['Taken by', order.takenBy]);
                    if (order.source) facts.push(['Found us via', CUSTOMER_SOURCE_LABELS[order.source] ?? order.source]);
                    const shipTo = describeDelivery(order.delivery);
                    if (shipTo.length) facts.push(['Deliver to', shipTo.map(l => <span key={l} className="block">{l}</span>)]);
                    if (order.notes?.trim()) facts.push(['Notes', <span key="notes" className="whitespace-pre-wrap">{order.notes.trim()}</span>]);
                    if (!facts.length) return null;
                    return (
                      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm">
                        {facts.map(([label, value]) => (
                          <div key={label} className={cn('min-w-0', (label === 'Deliver to' || label === 'Notes') && 'col-span-2')}>
                            <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                            <dd className="break-words">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    );
                  })()}
                  <Separator className="my-6" />

                  {/* ── Finalized Invoice View (greyed-out locked state) ──── */}
                  {linkedInvoice ? (
                    <div>
                      {/* A banner, not a veil. The greyed-out overlay hid the
                          one thing this state has to show — what was actually
                          invoiced — and nothing below it is interactive anyway. */}
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
                        <div className="flex items-start gap-2 text-sm min-w-0">
                          <Lock className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                          <p>
                            <span className="font-medium">Invoiced as {linkedInvoice.id}.</span>{' '}
                            <span className="text-muted-foreground">The order is locked; to change it, revert the invoice first.</span>
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {/* Revert without editing: the invoice goes, the order is open again. The dialog
                              was here with nothing to open it (audit, 2026-10-01). */}
                          <Button variant="outline" size="sm" onClick={() => setIsRevertDialogOpen(true)} className="text-destructive hover:text-destructive">
                            <RotateCcw className="mr-2 h-4 w-4" /> Cancel invoice
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setIsRevertAndEditDialogOpen(true)}>
                            <Edit className="mr-2 h-4 w-4" /> Unlock &amp; edit
                          </Button>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-lg font-semibold mb-4">Invoiced pieces</h3>
                        <div className="space-y-4">
                          {linkedInvoice.items.map((item, index) => (
                            <div key={index} className="p-4 border rounded-lg bg-muted/30">
                              <div className="flex-grow">
                                {item.itemCategory && (
                                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{categorySingular(item.itemCategory) || item.itemCategory}</span>
                                )}
                                <p className="font-bold">{item.name}</p>
                                <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
                                  <div className="min-w-0"><dt className="text-2xs uppercase tracking-wide text-muted-foreground">Metal</dt><dd>{describeMetal(item.metalType, item.karat)}</dd></div>
                                  <div className="min-w-0"><dt className="text-2xs uppercase tracking-wide text-muted-foreground">Final weight</dt><dd>{item.metalWeightG}g</dd></div>
                                  {item.size && <div className="min-w-0"><dt className="text-2xs uppercase tracking-wide text-muted-foreground">Size</dt><dd>{item.size}</dd></div>}
                                </dl>
                                {item.stoneDetails && (
                                  <div className="mt-2 text-xs p-2 bg-background/50 rounded-md border">
                                    <p className="font-semibold flex items-center"><Gem className="w-3 h-3 mr-1.5"/>Stones</p>
                                    <p className="text-muted-foreground whitespace-pre-wrap">{item.stoneDetails}</p>
                                  </div>
                                )}
                                {item.diamondDetails && (
                                  <div className="mt-2 text-xs p-2 bg-background/50 rounded-md border">
                                    <p className="font-semibold flex items-center"><Diamond className="w-3 h-3 mr-1.5"/>Diamonds</p>
                                    <p className="text-muted-foreground whitespace-pre-wrap">{item.diamondDetails}</p>
                                  </div>
                                )}
                                <div className="text-sm mt-3 p-2 bg-background rounded-md">
                                  <div className="flex justify-between"><span className="text-muted-foreground">Metal</span> <span className="font-medium tabular-nums">PKR {(item.metalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                                  {(item.wastageCost ?? 0) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Wastage</span> <span className="font-medium tabular-nums">PKR {(item.wastageCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                  {item.makingCharges > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Making</span> <span className="font-medium tabular-nums">PKR {item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                  {item.diamondChargesIfAny > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Diamonds</span> <span className="font-medium tabular-nums">PKR {item.diamondChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                  {item.stoneChargesIfAny > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Stones</span> <span className="font-medium tabular-nums">PKR {item.stoneChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                  <Separator className="my-1"/>
                                  <div className="flex justify-between font-bold"><span>Item total</span> <span className="tabular-nums">PKR {item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        <Separator className="my-6" />

                        <div className="flex flex-col md:flex-row justify-end items-start gap-4">
                          <div className="w-full max-w-sm space-y-2 p-4 text-base bg-muted/30 rounded-lg">
                            <div className="flex justify-between"><span>Subtotal:</span> <span className="font-semibold">PKR {linkedInvoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                            {linkedInvoice.discountAmount > 0 && (
                              <div className="flex justify-between text-destructive"><span>Discount:</span> <span className="font-semibold">- PKR {linkedInvoice.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                            )}
                            <div className="flex justify-between font-bold"><span>Grand Total:</span> <span>PKR {linkedInvoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                            {linkedInvoice.amountPaid > 0 && (
                              <div className="flex justify-between text-success"><span>Paid:</span> <span className="font-semibold">PKR {linkedInvoice.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                            )}
                            <Separator className="my-2 bg-muted-foreground/20"/>
                            <div className="flex justify-between font-bold text-xl"><span className="text-primary">Balance Due:</span> <span className="text-primary">PKR {linkedInvoice.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                  <>
                  <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                    <h3 className="text-lg font-semibold">Pieces <span className="text-muted-foreground font-normal">({order.items.length})</span></h3>
                    <KarigarBulkAssign
                      orderId={order.id}
                      unassignedCount={order.items.filter(i => !i.karigarId || i.karigarId === 'none').length}
                    />
                  </div>
                  <div className="space-y-4">
                      {order.items.map((item, index) => {
                          return (
                          <div key={index} className="p-4 border rounded-lg flex flex-col md:flex-row gap-4 bg-muted/30">
                              <div className="flex items-start gap-4 flex-grow min-w-0">
                                  <OrderPhoto item={item}>{src => (
                                      <div className="relative w-24 h-24 flex-shrink-0">
                                          <Image src={src} alt={`Sample for ${item.description}`} fill className="object-contain rounded-md border bg-muted" />
                                      </div>
                                  )}</OrderPhoto>
                                  <div className="flex-grow min-w-0">
                                      {item.itemCategory && (
                                          <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{categorySingular(item.itemCategory) || item.itemCategory}</span>
                                      )}
                                      <p className="font-bold">{item.description}</p>

                                      {/* Every specification the order captured, as labelled pairs.
                                          Size, plating and stone weight were recorded on the form and
                                          then never shown here — the bench could not see the size it
                                          was supposed to make. */}
                                      <dl className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
                                        {(() => {
                                          const rows: [string, React.ReactNode][] = [];
                                          rows.push(['Metal', describeMetal(item.metalType, item.karat)]);
                                          if (!item.isManualPrice && item.estimatedWeightG > 0) {
                                            rows.push(['Est. weight', `${item.estimatedWeightG}g`]);
                                            if (item.metalType !== 'silver' && item.wastagePercentage > 0) {
                                              rows.push(['Wastage', `${item.wastagePercentage}%`]);
                                            }
                                          }
                                          if (item.size) rows.push(['Size', item.size]);
                                          const finish = describePlating(item);
                                          if (finish) rows.push(['Finish', finish]);
                                          if ((item.stoneWeightG ?? 0) > 0) rows.push(['Stone weight', `${item.stoneWeightG}g`]);
                                          if (item.referenceSku) rows.push(['Ref SKU', item.referenceSku]);
                                          if (item.sampleGiven) rows.push(['Sample', 'Provided by customer']);
                                          if (item.isManualPrice) {
                                            rows.push(['Price', `PKR ${(item.manualPrice || item.totalEstimate || 0).toLocaleString()}`]);
                                          }
                                          return rows.map(([label, value]) => (
                                            <div key={label} className="min-w-0">
                                              <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                                              <dd className="truncate" title={typeof value === 'string' ? value : undefined}>{value}</dd>
                                            </div>
                                          ));
                                        })()}
                                      </dl>

                                      {/* Inline karigar assignment — no need to reopen the order form */}
                                      <div className="mt-3 flex items-center gap-2">
                                        <span className="text-xs text-muted-foreground flex items-center gap-1"><Briefcase className="w-3 h-3"/>Karigar:</span>
                                        <KarigarAssign
                                          orderId={order.id}
                                          itemIndex={index}
                                          currentKarigarId={item.karigarId}
                                          size="compact"
                                        />
                                      </div>

                                      {(item.stoneDetails || item.diamondDetails) && (
                                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                          {item.diamondDetails && (
                                              <div className="text-xs p-2 bg-background/50 rounded-md border">
                                                  <p className="font-semibold flex items-center"><Diamond className="w-3 h-3 mr-1.5"/>Diamonds</p>
                                                  <p className="text-muted-foreground whitespace-pre-wrap">{item.diamondDetails}</p>
                                              </div>
                                          )}
                                          {item.stoneDetails && (
                                              <div className="text-xs p-2 bg-background/50 rounded-md border">
                                                  <p className="font-semibold flex items-center"><Gem className="w-3 h-3 mr-1.5"/>Stones</p>
                                                  <p className="text-muted-foreground whitespace-pre-wrap">{item.stoneDetails}</p>
                                              </div>
                                          )}
                                        </div>
                                      )}

                                      {item.adminNote && (
                                          <div className="mt-2 text-xs p-2 rounded-md border border-warning/40 bg-warning/10">
                                              <p className="font-semibold flex items-center text-warning"><Lock className="w-3 h-3 mr-1.5"/>Instructions for the karigar <span className="ml-1.5 font-normal">(never printed)</span></p>
                                              <p className="text-warning whitespace-pre-wrap">{item.adminNote}</p>
                                          </div>
                                      )}

                                      {/* Costs last: subordinate to what the piece actually is. */}
                                      {!item.isManualPrice && (
                                        <div className="text-sm mt-3 p-2 bg-background rounded-md">
                                            <div className="flex justify-between"><span className="text-muted-foreground">Metal</span> <span className="font-medium tabular-nums">PKR {(item.metalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                                            {(item.wastageCost ?? 0) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Wastage</span> <span className="font-medium tabular-nums">PKR {(item.wastageCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                            {item.makingCharges > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Making</span> <span className="font-medium tabular-nums">PKR {item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                            {item.diamondCharges > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Diamonds</span> <span className="font-medium tabular-nums">PKR {item.diamondCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                            {item.stoneCharges > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Stones</span> <span className="font-medium tabular-nums">PKR {item.stoneCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                            <Separator className="my-1"/>
                                            <div className="flex justify-between font-bold"><span>Item total</span> <span className="tabular-nums">PKR {(item.totalEstimate ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                                        </div>
                                      )}
                                  </div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                  <div className="flex items-center space-x-2">
                                      {isUpdatingItem === index ? <Loader2 className="h-4 w-4 animate-spin"/> : (
                                      <Checkbox
                                          id={`item-${index}`}
                                          checked={item.isCompleted}
                                          onCheckedChange={(checked) => handleItemStatusChange(index, !!checked)}
                                      />
                                      )}
                                      <Label htmlFor={`item-${index}`} className={cn("font-medium", item.isCompleted && "line-through text-muted-foreground")}>
                                          Mark as Complete
                                      </Label>
                                  </div>
                                  {!order.invoiceId && (
                                      <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                          onClick={() => setItemToDelete(index)}
                                          title="Remove item"
                                      >
                                          <Trash2 className="h-4 w-4" />
                                      </Button>
                                  )}
                              </div>
                          </div>
                      )})}
                  </div>

                  <Separator className="my-6" />

                  {/* TCS Tracking Info (shown after Track button is clicked) */}
                  {trackingInfo && (
                    <div className="mb-6 p-4 border rounded-lg bg-muted/30 space-y-2">
                      <p className="font-semibold flex items-center"><PackageSearch className="w-4 h-4 mr-2" />TCS Tracking — {order.tcsConsignmentNo}</p>
                      <p className="text-sm whitespace-pre-line text-muted-foreground">{trackingInfo.summary}</p>
                      {trackingInfo.checkpoints.length > 0 && (
                        <ul className="text-xs space-y-1 mt-2">
                          {trackingInfo.checkpoints.map((cp, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="text-muted-foreground shrink-0">{cp.datetime}</span>
                              <span>{cp.status}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <a
                        href={`https://www.tcscourier.com/domestic/tracking/?ref=${order.tcsConsignmentNo}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary flex items-center gap-1 hover:underline mt-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Full tracking on TCS website
                      </a>
                    </div>
                  )}

                  <div className="flex flex-col md:flex-row justify-end items-start gap-4">
                     {/* Shown only while the order is being made: once invoiced, money is taken on the invoice. */}
                     {!order.invoiceId && order.status !== 'Cancelled' && order.status !== 'Refunded' && (
                       <Button variant="outline" onClick={() => setIsAdvanceDialogOpen(true)}>Record an advance</Button>
                     )}
                      <div className="w-full max-w-sm space-y-2 p-4 text-base bg-muted/30 rounded-lg">
                          <div className="flex justify-between"><span>Subtotal:</span> <span className="font-semibold">PKR {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          {discountAmount > 0 && (
                            <div className="flex justify-between text-destructive"><span>Discount:</span> <span className="font-semibold">- PKR {discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          )}
                          <div className="flex justify-between items-center text-destructive"><span>Advance paid:</span>
                            <span className="font-semibold inline-flex items-center gap-1">- PKR {advancePayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              {/* One advance: its delete sits here; several: each line has its own below. */}
                              {!order.invoiceId && advanceLines.length === 1 && (
                                <button type="button" onClick={() => handleDeleteAdvance(0, advanceLines[0].amount)} className="min-h-0 p-1 text-muted-foreground hover:text-destructive"
                                  aria-label="Delete this advance" title="Delete this advance (asks for the delete code)"><Trash2 className="h-3.5 w-3.5" /></button>
                              )}
                            </span>
                          </div>
                          {/* Each advance with its day and how it was paid — these become the
                              invoice's payments when the order is finalised. */}
                          {advanceLines.length > 1 && (
                            <ul className="text-xs text-muted-foreground space-y-0.5 pl-3">
                              {advanceLines.map((a, i) => (
                                <li key={i} className="flex justify-between items-center gap-3">
                                  <span>{format(parseISO(a.date), 'dd MMM yyyy')}{a.method ? ` · ${a.method}` : ''}{a.notes ? ` · ${a.notes}` : ''}</span>
                                  <span className="tabular-nums inline-flex items-center gap-1">{a.amount.toLocaleString()}
                                    {!order.invoiceId && (
                                      <button type="button" onClick={() => handleDeleteAdvance(i, a.amount)} className="min-h-0 p-1 hover:text-destructive"
                                        aria-label={`Delete the advance of ${a.amount.toLocaleString()}`} title="Delete this advance (asks for the delete code)"><Trash2 className="h-3 w-3" /></button>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {advanceInExchangeValue > 0 && (
                            <div className="flex justify-between text-destructive"><span>Taken in exchange:</span> <span className="font-semibold">- PKR {advanceInExchangeValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          )}
                          {orderExchanges(order).length > 0 && (
                              <ul className="pt-1 text-xs text-muted-foreground space-y-0.5 pl-3">
                                  {orderExchanges(order).map((e, i) => (
                                    <li key={i} className="flex justify-between gap-3">
                                      <span className="whitespace-pre-wrap">{describeExchangeEntry(e)}</span>
                                      {orderExchanges(order).length > 1 && <span className="tabular-nums">{e.value.toLocaleString()}</span>}
                                    </li>
                                  ))}
                              </ul>
                          )}
                          <Separator className="my-2 bg-muted-foreground/20"/>
                          <div className="flex justify-between font-bold text-xl"><span className="text-primary">Balance Due:</span> <span className="text-primary">PKR {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          {/* The shop's margin on the order (lib/margin.ts) — blurred until tapped, never on the slip. */}
                          <MarginFigure className="mt-3" margin={orderMargin(order)} />
                      </div>
                  </div>
                  </>
                  )}
              </CardContent>
      </Card>
    </div>

    <AlertDialog open={itemToDelete !== null} onOpenChange={(open) => !open && setItemToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove this piece?</AlertDialogTitle>
          <AlertDialogDescription>
            {order && itemToDelete !== null && (
              <>Remove <span className="font-semibold">"{order.items[itemToDelete]?.description}"</span> from this order? This cannot be undone.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeletingItem}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteItem}
            disabled={isDeletingItem}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeletingItem ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
