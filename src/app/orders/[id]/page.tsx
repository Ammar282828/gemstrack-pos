

"use client";

import React, { useState, useEffect } from 'react';
import { ListSkeleton } from '@/components/shared/skeletons';
import { whatsAppLink } from '@/lib/whatsapp';
import { describePlating } from '@/lib/materials';
import { itemCellHeight, drawItemCell } from '@/lib/invoice-item-cell';
import { buildOrderItemBlocks, drawOrderTotals } from '@/lib/order-slip';
import { fitText } from '@/lib/pdf-text';
import { STORE_CONFIG, STORE_LOGO_URL, STORE_LOGO_ASPECT } from '@/lib/store-config';
import { METAL_TYPES as metalTypeValues, describeMetal } from '@/lib/materials';
import { KarigarAssign, KarigarBulkAssign } from '@/components/karigar/karigar-assign';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, Order, OrderStatus, ORDER_STATUSES, KaratValue, OrderItem, Settings, Invoice, Product, MetalType, Karigar, staticCategories } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, DollarSign, Calendar, Edit, Loader2, Diamond, Gem, MessageSquare, FileText, Weight, Percent, Printer, Briefcase, CreditCard, RotateCcw, Truck, PackageSearch, ExternalLink, Trash2, Lock, ShoppingBag, MoreHorizontal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { cn, normalizePhoneNumber, openPDFWindowForIOS, savePDF } from '@/lib/utils';
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
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';
import { AmountInput } from '@/components/ui/amount-input';
import { PageBack } from '@/components/shared/page-back';
import { PromiseLine } from '@/components/shared/promise-line';
import { PhoneField } from '@/components/ui/phone-field';
import { auth as firebaseAuth } from '@/lib/firebase';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';


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

// --- Finalize Order Dialog Components ---
const finalizeOrderItemSchema = z.object({
  description: z.string(), // Readonly
  karat: z.custom<KaratValue>(), // Readonly
  metalType: z.enum(metalTypeValues), // Readonly
  isManualPrice: z.boolean().default(true),
  finalManualPrice: z.coerce.number().min(0).default(0),
  finalWeightG: z.coerce.number().min(0).default(0),
  finalMakingCharges: z.coerce.number().min(0, "Cannot be negative."),
  finalDiamondCharges: z.coerce.number().min(0, "Cannot be negative."),
  finalStoneCharges: z.coerce.number().min(0, "Cannot be negative."),
}).superRefine((data, ctx) => {
  if (data.isManualPrice) {
    if (data.finalManualPrice <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Final price must be greater than 0", path: ['finalManualPrice'] });
  } else {
    if (data.finalWeightG <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Weight must be a positive number.", path: ['finalWeightG'] });
  }
});

const finalizeOrderSchema = z.object({
  items: z.array(finalizeOrderItemSchema),
  additionalDiscount: z.coerce.number().min(0, "Discount cannot be negative.").default(0),
});

type FinalizeOrderFormData = z.infer<typeof finalizeOrderSchema>;

const FinalizeOrderDialog: React.FC<{
    order: Order;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}> = ({ order, open, onOpenChange }) => {
    const { generateInvoiceFromOrder } = useAppStore();
    const router = useRouter();
    const { toast } = useToast();

    const form = useForm<FinalizeOrderFormData>({
        resolver: zodResolver(finalizeOrderSchema),
        defaultValues: {
            items: order.items.map(item => ({
                description: item.description,
                karat: item.karat,
                metalType: item.metalType,
                isManualPrice: item.isManualPrice || false,
                finalManualPrice: item.manualPrice || item.totalEstimate || 0,
                finalWeightG: item.estimatedWeightG,
                finalMakingCharges: item.makingCharges,
                finalDiamondCharges: item.diamondCharges,
                finalStoneCharges: item.stoneCharges,
            })),
            additionalDiscount: Number(order?.discountAmount) || 0,
        }
    });

    const { fields } = useFieldArray({ control: form.control, name: "items" });

    const handleFinalize = async (data: FinalizeOrderFormData) => {
        const newInvoice = await generateInvoiceFromOrder(order, data.items, data.additionalDiscount);
        if (newInvoice) {
            toast({
                title: "Invoice Generated",
                description: `Invoice ${newInvoice.id} has been successfully created from order ${order.id}. You will now be taken to the cart page to manage payments.`,
            });
            // Redirect to cart/payment page, which now shows the finalized invoice
             router.push(`/cart?invoice_id=${newInvoice.id}`);
        } else {
            toast({
                title: "Error",
                description: "Failed to generate an invoice from this order. Please check the details and try again.",
                variant: "destructive",
            });
        }
        onOpenChange(false);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle>Finalize Order & Generate Invoice</DialogTitle>
                    <DialogDescription>
                        Confirm or update the final weights and charges for each item before creating the sales invoice. The initial advance payment will be automatically applied.
                    </DialogDescription>
                </DialogHeader>
                 <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFinalize)} className="space-y-6">
                        <ScrollArea className="h-[50vh] p-1">
                            <div className="space-y-4 p-3">
                                {fields.map((field, index) => (
                                    <Card key={field.id} className="p-4 bg-muted/50 space-y-3">
                                        <p className="font-bold text-sm">Item #{index + 1}: {form.getValues(`items.${index}.description`)}</p>
                                        {/* Manual price (Primary) */}
                                        {form.watch(`items.${index}.isManualPrice`) && (
                                            <FormField control={form.control} name={`items.${index}.finalManualPrice`} render={({ field }) => (
                                                <FormItem><FormLabel className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/>Final Price (PKR)</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                            )}/>
                                        )}
                                        {/* Toggle to rate calculation */}
                                        <FormField control={form.control} name={`items.${index}.isManualPrice`} render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-2 bg-muted/30">
                                                <FormControl><Checkbox checked={!field.value} onCheckedChange={(checked) => field.onChange(!checked)} /></FormControl>
                                                <div className="space-y-0.5 leading-none">
                                                    <FormLabel className="text-xs text-muted-foreground cursor-pointer">Use Rate &amp; Stone Calculation Instead</FormLabel>
                                                </div>
                                            </FormItem>
                                        )}/>
                                        {/* Rate calculation (Secondary) */}
                                        {!form.watch(`items.${index}.isManualPrice`) && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <FormField control={form.control} name={`items.${index}.finalWeightG`} render={({ field }) => (
                                                    <FormItem><FormLabel className="flex items-center"><Weight className="mr-2 h-4"/>Final Weight (g)</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                                <FormField control={form.control} name={`items.${index}.finalMakingCharges`} render={({ field }) => (
                                                    <FormItem><FormLabel className="flex items-center"><Gem className="mr-2 h-4"/>Final Making Charges</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                                <FormField control={form.control} name={`items.${index}.finalDiamondCharges`} render={({ field }) => (
                                                    <FormItem><FormLabel className="flex items-center"><Diamond className="mr-2 h-4"/>Final Diamond Charges</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                                <FormField control={form.control} name={`items.${index}.finalStoneCharges`} render={({ field }) => (
                                                    <FormItem><FormLabel>Final Stone Charges</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                            </div>
                                        )}
                                    </Card>
                                ))}
                            </div>
                        </ScrollArea>
                        <Separator />
                        <div className="p-3">
                            <FormField control={form.control} name="additionalDiscount" render={({ field }) => (
                                <FormItem>
                                  <FormLabel className="flex items-center text-base"><Percent className="mr-2 h-4"/>Discount</FormLabel>
                                  <FormControl><AmountInput placeholder="0" {...field} /></FormControl>
                                  <FormDescription>
                                    {Number(order?.discountAmount) > 0
                                      ? `Carried over from the order. Adjust it here if the agreed figure has changed.`
                                      : 'Applied on top of the advance payment.'}
                                  </FormDescription>
                                  <FormMessage />
                                </FormItem>
                            )}/>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={form.formState.isSubmitting}>
                                {form.formState.isSubmitting ? <Loader2 className="animate-spin mr-2" /> : <FileText className="mr-2 h-4 w-4"/>}
                                Create Final Invoice
                            </Button>
                        </DialogFooter>
                    </form>
                 </Form>
            </DialogContent>
        </Dialog>
    );
};

const recordAdvanceSchema = z.object({
  amount: z.coerce.number().positive("Amount must be a positive number."),
  notes: z.string().min(3, "Please add a brief note for the payment.").default('Advance payment received'),
});
type RecordAdvanceFormData = z.infer<typeof recordAdvanceSchema>;

const RecordAdvanceDialog: React.FC<{
    order: Order;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}> = ({ order, open, onOpenChange }) => {
    const { recordOrderAdvance } = useAppStore();
    const { toast } = useToast();
    const form = useForm<RecordAdvanceFormData>({
      resolver: zodResolver(recordAdvanceSchema),
      defaultValues: { amount: undefined, notes: 'Advance payment received' }
    });

    const handleRecordAdvance = async (data: RecordAdvanceFormData) => {
        try {
            await recordOrderAdvance(order.id, data.amount, data.notes);
            toast({
                title: "Advance Recorded",
                description: `PKR ${data.amount.toLocaleString()} has been added to the advance for order ${order.id}.`,
            });
            onOpenChange(false);
            form.reset();
        } catch (error) {
             toast({
                title: "Error",
                description: "Failed to record advance payment.",
                variant: "destructive",
            });
        }
    };
    
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Record Additional Advance</DialogTitle>
                    <DialogDescription>
                        Add a subsequent advance payment received for order {order.id}. This will update the balance due.
                    </DialogDescription>
                </DialogHeader>
                 <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleRecordAdvance)} className="space-y-4 pt-4">
                        <FormField control={form.control} name="amount" render={({ field }) => (
                           <FormItem><FormLabel>Advance Amount (PKR)</FormLabel><FormControl><AmountInput placeholder="Enter amount received" {...field} /></FormControl><FormMessage /></FormItem>
                        )}/>
                        <FormField control={form.control} name="notes" render={({ field }) => (
                           <FormItem><FormLabel>Notes</FormLabel><FormControl><Input placeholder="e.g., Second advance payment" {...field} /></FormControl><FormMessage /></FormItem>
                        )}/>
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={form.formState.isSubmitting}>
                               {form.formState.isSubmitting ? <Loader2 className="animate-spin mr-2"/> : <DollarSign className="mr-2 h-4 w-4"/>}
                                Record Payment
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};


export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const orderId = params.id as string;

  const isHydrated = useIsStoreHydrated();
  const order = useAppStore(state => state.orders.find(o => o.id === orderId));
  const settings = useAppStore(state => state.settings);
  const invoices = useAppStore(state => state.generatedInvoices);
  const { updateOrderStatus, updateOrderItemStatus, removeItemFromOrder, updateOrder, karigars, loadKarigars, revertOrderFromInvoice, refundOrder, loadGeneratedInvoices } = useAppStore();

  const linkedInvoice = order?.invoiceId ? invoices.find(inv => inv.id === order.invoiceId) : null;

  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isUpdatingItem, setIsUpdatingItem] = useState<number | null>(null);
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);
  const [isDeletingItem, setIsDeletingItem] = useState(false);

  const [isNotificationDialogOpen, setIsNotificationDialogOpen] = useState(false);
  const [notificationType, setNotificationType] = useState<NotificationType | null>(null);
  const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = useState(false);
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
    loadKarigars();
    loadGeneratedInvoices();
  }, [loadKarigars, loadGeneratedInvoices]);

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
    } catch {
        toast({ title: "Error", description: "Failed to revert order.", variant: "destructive" });
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
    } catch {
        toast({ title: "Error", description: "Failed to cancel invoice before editing.", variant: "destructive" });
    } finally {
        setIsReverting(false);
    }
  };

  const handleTcsTrack = async () => {
    if (!order?.tcsConsignmentNo) return;
    setIsTracking(true);
    try {
      const res = await fetch('/api/tcs', {
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
    } catch {
        toast({ title: "Error", description: "Failed to process refund.", variant: "destructive" });
    } finally {
        setIsRefunding(false);
    }
  };

  const handleStatusChange = async (newStatus: OrderStatus) => {
    if (!order) return;
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
    if (!order || typeof window === 'undefined' || !settings) return;
    const iOSWin = openPDFWindowForIOS();

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a5'
    });
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;
    
    let logoDataUrl: string | null = null;
    let logoFormat: string = 'PNG';
    const logoUrl = STORE_LOGO_URL;
    if (logoUrl) {
        try {
            const proxyUrl = logoUrl.startsWith('/') ? logoUrl : `/api/proxy-image?url=${encodeURIComponent(logoUrl)}`;
            const res = await fetch(proxyUrl);
            const blob = await res.blob();
            logoFormat = blob.type.toLowerCase().includes('jpeg') || blob.type.toLowerCase().includes('jpg') ? 'JPEG' : 'PNG';
            logoDataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.error("Error loading logo:", e);
        }
    }

    function drawHeader(pageNum: number) {
        if (logoDataUrl) {
            try {
                const h = 8; const w = h * STORE_LOGO_ASPECT;
                doc.addImage(logoDataUrl, logoFormat, margin, 8, w, h, undefined, 'FAST');
            } catch (e) {
                console.error("Error adding logo to Order Slip PDF:", e);
            }
        }
        doc.setFont("helvetica", "bold").setFontSize(14);
        doc.text('WORKSHOP ORDER SLIP', pageWidth - margin, 14, { align: 'right' });
        doc.setLineWidth(0.4);
        doc.line(margin, 22, pageWidth - margin, 22);
        if (pageNum > 1) {
            doc.setFontSize(7).setTextColor(150);
            doc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 5, { align: 'right' });
            doc.setTextColor(0);
        }
    }

    drawHeader(1);

    // Order info section
    let infoY = 28;
    doc.setFontSize(7).setTextColor(100).setFont("helvetica", "bold");
    doc.text('ORDER DETAILS:', margin, infoY);
    doc.setLineWidth(0.2);
    doc.line(margin, infoY + 1.5, pageWidth - margin, infoY + 1.5);
    infoY += 6;

    doc.setFont("helvetica", "normal").setTextColor(0).setFontSize(8.5);
    // The money moved to a totals block under the table, the way the invoice
    // does it, so the whole width is the left column now. Still capped: jsPDF
    // will draw a long name straight off the page.
    const leftW = pageWidth - margin * 2;
    fitText(doc, `Order ID: ${order.id}`, margin, infoY, leftW);
    fitText(doc, `Date: ${format(parseISO(order.createdAt), 'PP')}`, margin, infoY + 5, leftW);
    fitText(doc, `Customer: ${order.customerName || 'Walk-in'}`, margin, infoY + 10, leftW);
    // What the customer was told, printed so the slip can be held to it.
    // The rule under this block follows whatever the last line turned out to
    // be. A silver order has no gold-rate line and most have no promised date
    // yet, and a fixed offset left a hand's width of blank above the table.
    let lastLine = infoY + 10;
    if (order.promisedDate) {
      lastLine += 5;
      fitText(doc, `Promised: ${format(parseISO(order.promisedDate), 'PP')}`, margin, lastLine, leftW);
    }

    const rates = order.ratesApplied;
    const usedKarats = new Set(order.items.filter(i => i.metalType === 'gold').map(i => i.karat).filter(Boolean));
    let ratesApplied: string[] = [];
    if (usedKarats.size > 0) {
        if (usedKarats.has('24k') && rates.goldRatePerGram24k) ratesApplied.push(`24k: ${rates.goldRatePerGram24k.toLocaleString()}/g`);
        if (usedKarats.has('22k') && rates.goldRatePerGram22k) ratesApplied.push(`22k: ${rates.goldRatePerGram22k.toLocaleString()}/g`);
        if (usedKarats.has('21k') && rates.goldRatePerGram21k) ratesApplied.push(`21k: ${rates.goldRatePerGram21k.toLocaleString()}/g`);
        if (usedKarats.has('18k') && rates.goldRatePerGram18k) ratesApplied.push(`18k: ${rates.goldRatePerGram18k.toLocaleString()}/g`);
    }
    if (ratesApplied.length > 0) {
        doc.setFontSize(6.5).setTextColor(150);
        doc.text(`Gold Rates (PKR): ${ratesApplied.join(' | ')}`, margin, (lastLine += 5), { maxWidth: leftW });
    }


    const infoBottom = lastLine + 5;

    doc.setLineWidth(0.3);
    doc.line(margin, infoBottom, pageWidth - margin, infoBottom);

    let finalY = infoBottom + 7;

    // Items, drawn the way the invoice draws them.
    //
    // This was a flat `detailLines.join('\n')` dropped into one autoTable
    // cell, so the category, the piece, the metal and the bench instructions
    // all came out at the same size and weight — with the category shouting in
    // caps above the thing being made. The same hand-drawn cell the invoice
    // uses gives it a hierarchy: the piece leads, its specification sits under
    // it in grey, and what has to be set into it is darker because that is
    // what the karigar is actually reading.
    const itemBlocks = buildOrderItemBlocks(order);
    const tableRows: any[][] = order.items.map((item, idx) => [idx + 1, '', `PKR ${(item.totalEstimate || 0).toLocaleString()}`]);
    // Must match columnStyles below; see itemCellHeight on why this cannot be
    // read from the cell at parse time.
    const slipDescWidth = pageWidth - margin * 2 - 7 - 28;

    doc.autoTable({
        head: [['#', 'Piece & Instructions', 'Est. Price']],
        body: tableRows,
        startY: finalY,
        theme: 'grid',
        headStyles: { fillColor: [230, 230, 230], textColor: 40, fontStyle: 'bold', fontSize: 7, cellPadding: 2 },
        styles: { fontSize: 7.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 }, valign: 'top', lineColor: [200, 200, 200], lineWidth: 0.1 },
        columnStyles: {
            0: { cellWidth: 7, halign: 'center' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 28, halign: 'right' },
        },
        didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 1) {
                const block = itemBlocks[data.row.index];
                if (block) {
                    data.cell.text = [];
                    data.cell.styles.minCellHeight = itemCellHeight(doc, block, slipDescWidth);
                }
            }
        },
        didDrawCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 1) {
                const block = itemBlocks[data.row.index];
                if (block) drawItemCell(doc, block, data.cell, slipDescWidth);
            }
        },
        didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
            if (data.pageNumber > 1) {
                doc.setPage(data.pageNumber);
                data.settings.startY = 30;
            }
            drawHeader(data.pageNumber);
        },
    });

    finalY = doc.lastAutoTable.finalY || finalY;

    // The money, laid out the way the invoice lays it out.
    drawOrderTotals(doc, order, { pageWidth, margin, startY: finalY + 8 });

    const footerStartY = pageHeight - 36;
    const contacts = [
        { name: STORE_CONFIG.contact1Name, number: STORE_CONFIG.contact1Number },
        { name: STORE_CONFIG.contact2Name, number: STORE_CONFIG.contact2Number },
        { name: STORE_CONFIG.contact3Name, number: STORE_CONFIG.contact3Number },
        { name: STORE_CONFIG.contact4Name, number: STORE_CONFIG.contact4Number },
    ].filter(c => c.name && c.number);
    const qrCodeSize = 16;
    const qrGap = 3;
    const qrSectionWidth = (qrCodeSize * 2) + qrGap;
    const textBlockWidth = pageWidth - margin * 2 - qrSectionWidth - 6;
    const qrStartX = pageWidth - margin - qrSectionWidth;

    doc.setLineWidth(0.2);
    doc.line(margin, footerStartY - 2, pageWidth - margin, footerStartY - 2);

    doc.setFontSize(6).setFont("helvetica", "bold").setTextColor(70);
    doc.text("For Orders & Inquiries:", margin, footerStartY + 2, { maxWidth: textBlockWidth });
    doc.setFontSize(7.5).setFont("helvetica", "normal").setTextColor(30);
    contacts.forEach((c, i) => {
      doc.text(`${c.name}: ${c.number}`, margin, footerStartY + 6 + i * 4, { maxWidth: textBlockWidth });
    });
    const afterContacts = footerStartY + 6 + contacts.length * 4;
    doc.setFontSize(6).setFont("helvetica", "bold").setTextColor(80);
    doc.text(STORE_CONFIG.bankLine, margin, afterContacts + 2, { maxWidth: textBlockWidth });
    if (STORE_CONFIG.iban) {
      doc.setFontSize(6).setFont("helvetica", "normal").setTextColor(100);
      doc.text(`IBAN: ${STORE_CONFIG.iban}`, margin, afterContacts + 6, { maxWidth: textBlockWidth });
    }

    const waQrCanvas = document.getElementById('wa-qr-code') as HTMLCanvasElement;
    const instaQrCanvas = document.getElementById('insta-qr-code') as HTMLCanvasElement;

    if (waQrCanvas) {
        doc.setFontSize(5).setFont("helvetica", "bold").setTextColor(60);
        doc.text("Join us on Whatsapp", qrStartX + qrCodeSize / 2, footerStartY + 2, { align: 'center' });
        doc.addImage(waQrCanvas.toDataURL('image/png'), 'PNG', qrStartX, footerStartY + 4, qrCodeSize, qrCodeSize);
    }
    if (instaQrCanvas) {
        const secondQrX = qrStartX + qrCodeSize + qrGap;
        doc.setFontSize(5).setFont("helvetica", "bold").setTextColor(60);
        doc.text("Follow us on Instagram", secondQrX + qrCodeSize / 2, footerStartY + 2, { align: 'center' });
        doc.addImage(instaQrCanvas.toDataURL('image/png'), 'PNG', secondQrX, footerStartY + 4, qrCodeSize, qrCodeSize);
    }


    await savePDF(doc, `OrderSlip-${order.id}.pdf`, iOSWin);
  };


  if (!isHydrated) {
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
  const grandTotal = subtotal - advancePayment - advanceInExchangeValue;
  
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
      {order && <RecordAdvanceDialog order={order} open={isAdvanceDialogOpen} onOpenChange={setIsAdvanceDialogOpen} />}
      {order && <BookCourierDialog order={order} open={isBookCourierOpen} onOpenChange={setIsBookCourierOpen} />}

      <AlertDialog open={isRevertDialogOpen} onOpenChange={setIsRevertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revert & Cancel Invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently cancel invoice <strong>{order?.invoiceId}</strong> and revert this order back to &ldquo;In Progress&rdquo; so it can be edited and re-finalized. Any hisaab entries linked to the invoice will also be removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReverting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevert} disabled={isReverting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isReverting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              Yes, Revert Order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isRevertAndEditDialogOpen} onOpenChange={setIsRevertAndEditDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unlock Order for Editing?</AlertDialogTitle>
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
            <AlertDialogTitle>Refund this Order?</AlertDialogTitle>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-3 space-y-6">
          <Card>
              <CardHeader>
                  <div className="flex flex-col gap-4">
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
                              {ORDER_STATUSES.map(status => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                            </SelectContent>
                          </Select>

                          {order.invoiceId ? (
                            <Button asChild size="sm">
                              <Link href={`/cart?invoice_id=${order.invoiceId}`}>
                                <FileText className="mr-2 h-4 w-4" />Invoice {order.invoiceId}
                              </Link>
                            </Button>
                          ) : order.status === 'Completed' ? (
                            <Button size="sm" onClick={() => setIsFinalizeDialogOpen(true)}>
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
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                  </div>
              </CardHeader>
              <CardContent>
                  <Separator className="my-6" />

                  {/* ── Finalized Invoice View (greyed-out locked state) ──── */}
                  {linkedInvoice ? (
                    <div className="relative">
                      <div className="absolute inset-0 bg-background/50 z-10 rounded-lg flex items-start justify-center pt-8 pointer-events-none">
                        <div className="bg-background border shadow-lg rounded-lg px-6 py-3 text-center pointer-events-auto">
                          <p className="font-semibold text-lg">Invoice {linkedInvoice.id} — Finalized</p>
                          <p className="text-sm text-muted-foreground mt-1">This order is locked. To make changes, revert the invoice first.</p>
                          <Button variant="outline" className="mt-3" onClick={() => setIsRevertAndEditDialogOpen(true)}>
                            <Edit className="mr-2 h-4 w-4" /> Unlock & Edit Order
                          </Button>
                        </div>
                      </div>

                      <div className="opacity-40 pointer-events-none select-none">
                        <h3 className="text-lg font-semibold mb-4">Finalized Items</h3>
                        <div className="space-y-4">
                          {linkedInvoice.items.map((item, index) => (
                            <div key={index} className="p-4 border rounded-lg bg-muted/30">
                              <div className="flex-grow">
                                {item.itemCategory && (
                                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory}</span>
                                )}
                                <p className="font-bold">{item.name}</p>
                                <div className="text-sm text-muted-foreground mt-1">
                                  <p>{describeMetal(item.metalType, item.karat)} | Final Wt: {item.metalWeightG}g</p>
                                </div>
                                {item.stoneDetails && (
                                  <div className="mt-2 text-xs p-2 bg-background/50 rounded-md border">
                                    <p className="font-semibold flex items-center"><Gem className="w-3 h-3 mr-1.5"/>Stone Details:</p>
                                    <p className="text-muted-foreground whitespace-pre-wrap">{item.stoneDetails}</p>
                                  </div>
                                )}
                                {item.diamondDetails && (
                                  <div className="mt-2 text-xs p-2 bg-background/50 rounded-md border">
                                    <p className="font-semibold flex items-center"><Diamond className="w-3 h-3 mr-1.5"/>Diamond Details:</p>
                                    <p className="text-muted-foreground whitespace-pre-wrap">{item.diamondDetails}</p>
                                  </div>
                                )}
                                <div className="text-sm mt-2 p-2 bg-background rounded-md">
                                  <div className="flex justify-between"><span>Metal Cost:</span> <span className="font-semibold">PKR {(item.metalCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                                  {(item.wastageCost ?? 0) > 0 && <div className="flex justify-between"><span>+ Wastage Cost:</span> <span className="font-semibold">PKR {(item.wastageCost ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                  {item.makingCharges > 0 && <div className="flex justify-between"><span>+ Making Charges:</span> <span className="font-semibold">PKR {item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                  {item.diamondChargesIfAny > 0 && <div className="flex justify-between"><span>+ Diamond Charges:</span> <span className="font-semibold">PKR {item.diamondChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                  {item.stoneChargesIfAny > 0 && <div className="flex justify-between"><span>+ Other Stone Charges:</span> <span className="font-semibold">PKR {item.stoneChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                  <Separator className="my-1"/>
                                  <div className="flex justify-between font-bold"><span>Item Total:</span> <span>PKR {item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
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
                              <div className="flex justify-between text-success"><span>Amount Paid:</span> <span className="font-semibold">PKR {linkedInvoice.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
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
                    <h3 className="text-lg font-semibold">Order Items Checklist</h3>
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
                                  {item.sampleImageDataUri && (
                                      <div className="relative w-24 h-24 flex-shrink-0">
                                          <Image src={item.sampleImageDataUri} alt={`Sample for ${item.description}`} fill className="object-contain rounded-md border bg-muted" />
                                      </div>
                                  )}
                                  <div className="flex-grow min-w-0">
                                      {item.itemCategory && (
                                          <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory}</span>
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
                     <Button variant="outline" onClick={() => setIsAdvanceDialogOpen(true)}>Record Additional Advance</Button>
                      <div className="w-full max-w-sm space-y-2 p-4 text-base bg-muted/30 rounded-lg">
                          <div className="flex justify-between"><span>Subtotal:</span> <span className="font-semibold">PKR {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          <div className="flex justify-between text-destructive"><span>Advance Payment (Cash):</span> <span className="font-semibold">- PKR {advancePayment.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          {advanceInExchangeValue > 0 && (
                            <div className="flex justify-between text-destructive"><span>Advance (In-Exchange):</span> <span className="font-semibold">- PKR {advanceInExchangeValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                          )}
                          {order.advanceInExchangeDescription && (
                              <div className="pt-2 text-sm text-muted-foreground">
                                  <p className="font-semibold">In-Exchange Details:</p>
                                  <p className="whitespace-pre-wrap">{order.advanceInExchangeDescription}</p>
                              </div>
                          )}
                          <Separator className="my-2 bg-muted-foreground/20"/>
                          <div className="flex justify-between font-bold text-xl"><span className="text-primary">Balance Due:</span> <span className="text-primary">PKR {grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                      </div>
                  </div>
                  </>
                  )}
              </CardContent>
          </Card>
        </div>
      </div>
    </div>

    <AlertDialog open={itemToDelete !== null} onOpenChange={(open) => !open && setItemToDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Item?</AlertDialogTitle>
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
