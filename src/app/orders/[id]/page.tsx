

"use client";

import React, { useState, useEffect } from 'react';
import { STORE_CONFIG } from '@/lib/store-config';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, Order, OrderStatus, ORDER_STATUSES, KaratValue, OrderItem, Settings, Invoice, Product, MetalType, Karigar, staticCategories } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, DollarSign, Calendar, Edit, Loader2, Diamond, Gem, MessageSquare, FileText, Weight, Percent, Printer, Briefcase, CreditCard, RotateCcw, Truck, PackageSearch, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { cn, normalizePhoneNumber, openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Control, useForm, useFieldArray } from 'react-hook-form';
import PhoneInput from 'react-phone-number-input/react-hook-form-input';
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


const getStatusBadgeVariant = (status: OrderStatus) => {
    switch (status) {
      case 'Pending': return 'bg-yellow-500/80 text-yellow-50';
      case 'In Progress': return 'bg-blue-500/80 text-blue-50';
      case 'Completed': return 'bg-green-500/80 text-green-50';
      case 'Cancelled': return 'bg-red-500/80 text-red-50';
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
    case 'Paid': return 'bg-green-500/80 text-green-50';
    case 'Partial': return 'bg-orange-500/80 text-orange-50';
    case 'Unpaid': return 'bg-red-500/80 text-red-50';
  }
};

const DetailItem: React.FC<{ label: string; value?: string | number; children?: React.ReactNode; icon?: React.ReactNode }> = ({ label, value, children, icon }) => (
    <div className="flex items-start justify-between py-2">
      <div className="flex items-center text-sm text-muted-foreground">
        {icon && <div className="mr-2">{icon}</div>}
        <p>{label}</p>
      </div>
      {children || <p className="font-medium text-foreground">{value}</p>}
    </div>
);

type PhoneForm = {
    phone: string;
};

type NotificationType = 'inProgress' | 'completed' | 'summary';

// ─── TCS Courier ─────────────────────────────────────────────────────────────
const TCS_CITIES = [
  { code: 'KHI', name: 'Karachi' },
  { code: 'LHE', name: 'Lahore' },
  { code: 'ISB', name: 'Islamabad' },
  { code: 'RWP', name: 'Rawalpindi' },
  { code: 'MUL', name: 'Multan' },
  { code: 'FSD', name: 'Faisalabad' },
  { code: 'HYD', name: 'Hyderabad' },
  { code: 'PEW', name: 'Peshawar' },
  { code: 'QTA', name: 'Quetta' },
  { code: 'SKT', name: 'Sialkot' },
  { code: 'GUJ', name: 'Gujranwala' },
  { code: 'SWL', name: 'Sahiwal' },
  { code: 'BTN', name: 'Bahawalpur' },
  { code: 'SRG', name: 'Sargodha' },
  { code: 'ABT', name: 'Abbottabad' },
] as const;

const tcsBookingSchema = z.object({
  consigneeName: z.string().min(2, 'Name is required (min 2 chars)'),
  consigneeMobile: z.string().regex(/^03\d{9}$/, 'Enter a valid Pakistani mobile (03XXXXXXXXX)'),
  consigneeAddress: z.string().min(5, 'Full address is required'),
  cityCode: z.string().min(2, 'City code is required (e.g. KHI)').max(5),
  cityName: z.string().min(2, 'City name is required'),
  weightKg: z.coerce.number().min(0.5, 'Minimum weight is 0.5 kg'),
  codAmount: z.coerce.number().min(0, 'COD cannot be negative').max(250000),
  description: z.string().optional(),
});
type TcsBookingFormData = z.infer<typeof tcsBookingSchema>;

const BookCourierDialog: React.FC<{
    order: Order;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onBooked: (consignmentNo: string) => void;
}> = ({ order, open, onOpenChange, onBooked }) => {
    const { toast } = useToast();

    const defaultName = order.customerName || '';
    const rawPhone = order.customerContact?.replace(/\D/g, '') || '';
    const defaultPhone = rawPhone.startsWith('0') ? rawPhone : rawPhone ? `0${rawPhone}` : '';

    const form = useForm<TcsBookingFormData>({
        resolver: zodResolver(tcsBookingSchema),
        defaultValues: {
            consigneeName: defaultName,
            consigneeMobile: defaultPhone.slice(0, 11),
            consigneeAddress: '',
            cityCode: '',
            cityName: '',
            weightKg: 0.5,
            codAmount: Math.max(0, order.grandTotal || 0),
            description: order.items.map(i => i.description).join(', ').slice(0, 200),
        },
    });

    const watchCityCode = form.watch('cityCode');
    React.useEffect(() => {
        const city = TCS_CITIES.find(c => c.code === watchCityCode);
        if (city) form.setValue('cityName', city.name);
    }, [watchCityCode, form]);

    const handleSubmit = async (data: TcsBookingFormData) => {
        try {
            const res = await fetch('/api/tcs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'book',
                    consignee: {
                        name: data.consigneeName,
                        mobile: data.consigneeMobile,
                        address: data.consigneeAddress,
                        cityCode: data.cityCode,
                        cityName: data.cityName,
                    },
                    shipment: {
                        referenceNo: order.id,
                        description: data.description || 'Jewellery',
                        weightKg: data.weightKg,
                        codAmount: data.codAmount,
                    },
                }),
            });

            const result = await res.json();

            if (result.status === true && result.consignmentNo) {
                toast({
                    title: 'Shipment Booked!',
                    description: `TCS Consignment No: ${result.consignmentNo}`,
                });
                onBooked(result.consignmentNo);
                onOpenChange(false);
            } else {
                const errMsg = result.message || result.error || JSON.stringify(result);
                toast({
                    title: 'Booking Failed',
                    description: errMsg,
                    variant: 'destructive',
                });
            }
        } catch {
            toast({ title: 'Network Error', description: 'Could not reach TCS API.', variant: 'destructive' });
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center">
                        <Truck className="mr-2 h-5 w-5" /> Book TCS Courier
                    </DialogTitle>
                    <DialogDescription>
                        Create a TCS Envio shipment for order {order.id}. The consignment number will be saved to this order.
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 pt-2">
                        <div className="grid grid-cols-2 gap-4">
                            <FormField control={form.control} name="consigneeName" render={({ field }) => (
                                <FormItem className="col-span-2">
                                    <FormLabel>Recipient Name</FormLabel>
                                    <FormControl><Input placeholder="Customer full name" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="consigneeMobile" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Mobile (03XXXXXXXXX)</FormLabel>
                                    <FormControl><Input placeholder="03001234567" maxLength={11} {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="cityCode" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>City</FormLabel>
                                    <Select onValueChange={val => { field.onChange(val); }} value={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select city" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {TCS_CITIES.map(c => (
                                                <SelectItem key={c.code} value={c.code}>{c.name} ({c.code})</SelectItem>
                                            ))}
                                            <SelectItem value="OTHER">Other (type below)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                        {watchCityCode === 'OTHER' && (
                            <div className="grid grid-cols-2 gap-4">
                                <FormField control={form.control} name="cityCode" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>TCS City Code</FormLabel>
                                        <FormControl><Input placeholder="e.g. SWB" maxLength={5} {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="cityName" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>City Name</FormLabel>
                                        <FormControl><Input placeholder="e.g. Swabi" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>
                        )}
                        <FormField control={form.control} name="consigneeAddress" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Delivery Address</FormLabel>
                                <FormControl><Input placeholder="House/Shop #, Street, Area" {...field} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-4">
                            <FormField control={form.control} name="weightKg" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Parcel Weight (kg)</FormLabel>
                                    <FormControl><Input type="number" step="0.1" min="0.5" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />
                            <FormField control={form.control} name="codAmount" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>COD Amount (PKR)</FormLabel>
                                    <FormControl><Input type="number" min="0" placeholder="0 if prepaid" {...field} /></FormControl>
                                    <FormDescription className="text-xs">Cash on delivery. 0 if already paid.</FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )} />
                        </div>
                        <FormField control={form.control} name="description" render={({ field }) => (
                            <FormItem>
                                <FormLabel>Parcel Contents</FormLabel>
                                <FormControl><Input placeholder="Brief description of contents" {...field} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )} />
                        <DialogFooter>
                            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={form.formState.isSubmitting}>
                                {form.formState.isSubmitting ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Truck className="mr-2 h-4 w-4" />}
                                Book Shipment
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

// --- Finalize Order Dialog Components ---
const metalTypeValues: [MetalType, ...MetalType[]] = ['gold', 'palladium', 'platinum', 'silver'];
const finalizeOrderItemSchema = z.object({
  description: z.string(), // Readonly
  karat: z.custom<KaratValue>(), // Readonly
  metalType: z.enum(metalTypeValues), // Readonly
  isManualPrice: z.boolean().default(false),
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
            additionalDiscount: 0,
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
                                    <Card key={field.id} className="p-4 bg-muted/50">
                                        <p className="font-bold text-sm mb-2">Item #{index + 1}: {form.getValues(`items.${index}.description`)}</p>
                                        {form.watch(`items.${index}.isManualPrice`) ? (
                                            <FormField control={form.control} name={`items.${index}.finalManualPrice`} render={({ field }) => (
                                                <FormItem><FormLabel className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/>Final Price (PKR)</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                                            )}/>
                                        ) : (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <FormField control={form.control} name={`items.${index}.finalWeightG`} render={({ field }) => (
                                                    <FormItem><FormLabel className="flex items-center"><Weight className="mr-2 h-4"/>Final Weight (g)</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                                <FormField control={form.control} name={`items.${index}.finalMakingCharges`} render={({ field }) => (
                                                    <FormItem><FormLabel className="flex items-center"><Gem className="mr-2 h-4"/>Final Making Charges</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                                <FormField control={form.control} name={`items.${index}.finalDiamondCharges`} render={({ field }) => (
                                                    <FormItem><FormLabel className="flex items-center"><Diamond className="mr-2 h-4"/>Final Diamond Charges</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                                <FormField control={form.control} name={`items.${index}.finalStoneCharges`} render={({ field }) => (
                                                    <FormItem><FormLabel>Final Stone Charges</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
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
                                <FormItem><FormLabel className="flex items-center text-base"><Percent className="mr-2 h-4"/>Additional Discount</FormLabel><FormControl><Input type="number" placeholder="Enter any extra discount amount" {...field} /></FormControl><FormDescription>This discount is applied on top of the advance payment.</FormDescription><FormMessage /></FormItem>
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
                           <FormItem><FormLabel>Advance Amount (PKR)</FormLabel><FormControl><Input type="number" placeholder="Enter amount received" {...field} /></FormControl><FormMessage /></FormItem>
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
  const { updateOrderStatus, updateOrderItemStatus, updateOrder, karigars, loadKarigars, revertOrderFromInvoice, refundOrder } = useAppStore();
  
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isUpdatingItem, setIsUpdatingItem] = useState<number | null>(null);

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
  }, [loadKarigars]);

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

  const handleTcsBooked = async (consignmentNo: string) => {
    if (!order) return;
    await updateOrder(order.id, { tcsConsignmentNo: consignmentNo });
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
        
        // Trigger notification dialog if status is 'In Progress' or 'Completed'
        if (newStatus === 'In Progress' || newStatus === 'Completed') {
            setNotificationType(newStatus === 'In Progress' ? 'inProgress' : 'completed');
            setIsNotificationDialogOpen(true);
        }

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
            message += `Great news! Your custom order is now *Completed* and ready for collection.\n\n`;
            message += `*Amount Due:* PKR ${order.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
        }
    }
    
    message += `Thank you for your business!`;

    const numberOnly = whatsAppNumber.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${numberOnly}?text=${encodeURIComponent(message)}`;

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
    const logoUrl = settings.shopLogoUrlBlack || settings.shopLogoUrl;
    if (logoUrl) {
        try {
            const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(logoUrl)}`;
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
                doc.addImage(logoDataUrl, logoFormat, margin, 7, 32, 10, undefined, 'FAST');
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
    doc.text(`Order ID: ${order.id}`, margin, infoY);
    doc.text(`Date: ${format(parseISO(order.createdAt), 'PP')}`, margin, infoY + 5);
    doc.text(`Customer: ${order.customerName || 'Walk-in'}`, margin, infoY + 10);

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
        doc.text(`Gold Rates (PKR): ${ratesApplied.join(' | ')}`, margin, infoY + 15);
    }

    doc.setTextColor(0).setFontSize(8.5).setFont('helvetica', 'bold');
    doc.text(`Est: PKR ${(order.subtotal || 0).toLocaleString()}`, pageWidth - margin, infoY + 5, { align: 'right' });
    doc.text(`Advance Paid:`, pageWidth - margin, infoY + 10, { align: 'right' });
    const totalAdvance = (order.advancePayment || 0) + (order.advanceInExchangeValue || 0);
    doc.text(`- PKR ${totalAdvance.toLocaleString()}`, pageWidth - margin, infoY + 15, { align: 'right' });

    doc.setLineWidth(0.3);
    doc.line(margin, infoY + 20, pageWidth - margin, infoY + 20);

    let finalY = infoY + 27;

    // Build items table (autoTable)
    const tableRows: any[][] = [];
    for (let i = 0; i < order.items.length; i++) {
        const item = order.items[i];
        const categoryTitle = staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory || '';
        const metalName = item.metalType === 'silver'
            ? '925 Sterling Silver'
            : `${item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1)}${item.karat ? ` (${item.karat.toUpperCase()})` : ''}`;
        const metalLine = item.isManualPrice
            ? metalName
            : `${metalName}  |  Est. Wt: ${item.estimatedWeightG}g${item.metalType !== 'silver' && item.wastagePercentage > 0 ? `  |  Wastage: ${item.wastagePercentage}%` : ''}`;

        let detailLines = [];
        if (categoryTitle) detailLines.push(categoryTitle.toUpperCase());
        detailLines.push(item.description);
        detailLines.push(metalLine);
        if (item.referenceSku) detailLines.push(`Ref SKU: ${item.referenceSku}`);
        if (item.stoneDetails) detailLines.push(`Instructions: ${item.stoneDetails}`);
        if (item.diamondDetails) detailLines.push(`Instructions: ${item.diamondDetails}`);

        tableRows.push([
            i + 1,
            detailLines.join('\n'),
            `PKR ${(item.totalEstimate || 0).toLocaleString()}`,
        ]);
    }

    doc.autoTable({
        head: [['#', 'Item Details', 'Est. Price']],
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
            // Make category row bold, description normal, metal gray
            if (data.column.index === 1 && data.cell.raw) {
                data.cell.styles.fontStyle = 'normal';
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
        <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
          <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
          <p className="text-lg text-muted-foreground">Loading order details...</p>
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
    <div className="container mx-auto py-8 px-4 space-y-6">
      <div style={{ display: 'none' }}>
        <img id="shop-logo" src={settings?.shopLogoUrlBlack || settings?.shopLogoUrl || ''} crossOrigin="anonymous" alt="" />
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
                    <PhoneInput
                        name="phone"
                        control={phoneForm.control as unknown as Control}
                        defaultCountry="PK"
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm mt-1"
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
      {order && <BookCourierDialog order={order} open={isBookCourierOpen} onOpenChange={setIsBookCourierOpen} onBooked={handleTcsBooked} />}

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
            <AlertDialogTitle>Cancel Invoice & Edit Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Invoice <strong>{order?.invoiceId}</strong> will be permanently cancelled and its hisaab entries removed before you can edit. You can re-finalize a new invoice after editing. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReverting}>Keep Invoice</AlertDialogCancel>
            <AlertDialogAction onClick={handleRevertAndEdit} disabled={isReverting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {isReverting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Edit className="mr-2 h-4 w-4" />}
              Cancel Invoice & Edit
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

      <Button variant="outline" onClick={() => router.back()} className="mb-0">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
      </Button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-3 space-y-6">
          <Card>
              <CardHeader>
                  <div className="flex flex-col md:flex-row justify-between md:items-start gap-4">
                      <div>
                          <CardTitle className="text-2xl">Order {order.id}</CardTitle>
                          <CardDescription>Details of the custom order.</CardDescription>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                           <Button variant="outline" onClick={handlePrintOrderSlip}><Printer className="mr-2 h-4 w-4"/>Print Slip</Button>
                           <Button variant="outline" onClick={() => { setNotificationType('summary'); setIsNotificationDialogOpen(true); }}><MessageSquare className="mr-2 h-4 w-4"/>Send to Customer</Button>
                           {order.tcsConsignmentNo ? (
                             <Button variant="outline" onClick={handleTcsTrack} disabled={isTracking}>
                               {isTracking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageSearch className="mr-2 h-4 w-4" />}
                               TCS: {order.tcsConsignmentNo}
                             </Button>
                           ) : (
                             <Button variant="outline" onClick={() => setIsBookCourierOpen(true)}>
                               <Truck className="mr-2 h-4 w-4" /> Book Courier
                             </Button>
                           )}
                           {!order.invoiceId && (
                             <Button asChild variant="outline">
                               <Link href={`/orders/${order.id}/edit`}>
                                 <Edit className="mr-2 h-4 w-4" /> Edit Order
                               </Link>
                             </Button>
                           )}
                           {order.invoiceId ? (
                             <>
                               <Button variant="outline" onClick={() => setIsRevertAndEditDialogOpen(true)}>
                                 <Edit className="mr-2 h-4 w-4" /> Edit Order
                               </Button>
                               <Button variant="outline" asChild>
                                 <Link href={`/cart?invoice_id=${order.invoiceId}`}>
                                   <FileText className="mr-2 h-4 w-4" /> View Invoice ({order.invoiceId})
                                 </Link>
                               </Button>
                               <Button variant="destructive" onClick={() => setIsRevertDialogOpen(true)}>
                                 <RotateCcw className="mr-2 h-4 w-4" /> Revert & Cancel Invoice
                               </Button>
                             </>
                           ) : order.status === 'Completed' && (
                             <Button onClick={() => setIsFinalizeDialogOpen(true)}>
                               <FileText className="mr-2 h-4 w-4" /> Finalize & Generate Invoice
                             </Button>
                           )}
                           {order.status !== 'Cancelled' && order.status !== 'Refunded' && (
                             <Button variant="outline" onClick={() => setIsRefundDialogOpen(true)} className="border-destructive text-destructive hover:bg-destructive/10">
                               <RotateCcw className="mr-2 h-4 w-4" /> Refund Order
                             </Button>
                           )}
                          <Badge className={cn("text-base border-transparent", getPaymentBadgeClass(getPaymentStatus(order)))}>
                              <CreditCard className="w-3.5 h-3.5 mr-1.5" />{getPaymentStatus(order)}
                          </Badge>
                          <Badge className={cn("text-base border-transparent", getStatusBadgeVariant(order.status))}>
                              {order.status}
                          </Badge>
                          <Select onValueChange={(val) => handleStatusChange(val as OrderStatus)} disabled={isUpdatingStatus}>
                              <SelectTrigger className="w-[180px] h-9" id="status-update">
                                  <SelectValue placeholder="Update Status" />
                              </SelectTrigger>
                              <SelectContent>
                                  {ORDER_STATUSES.map(status => (
                                      <SelectItem key={status} value={status}>{status}</SelectItem>
                                  ))}
                              </SelectContent>
                          </Select>
                      </div>
                  </div>
              </CardHeader>
              <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                      <DetailItem label="Order Date" value={format(parseISO(order.createdAt), 'PPpp')} icon={<Calendar className="w-4 h-4"/>}/>
                      <DetailItem label="Customer" value={order.customerName || 'Walk-in'} icon={<User className="w-4 h-4"/>} />
                      <DetailItem label="Gold Rate(s) Applied" value={getRateDisplay()} icon={<DollarSign className="w-4 h-4"/>}/>
                  </div>

                  <Separator className="my-6" />

                  <h3 className="text-lg font-semibold mb-4">Order Items Checklist</h3>
                  <div className="space-y-4">
                      {order.items.map((item, index) => {
                          const karigarName = karigars.find(k => k.id === item.karigarId)?.name;
                          return (
                          <div key={index} className="p-4 border rounded-lg flex flex-col md:flex-row gap-4 bg-muted/30">
                              <div className="flex items-start gap-4 flex-grow">
                                  {item.sampleImageDataUri && (
                                      <div className="relative w-24 h-24 flex-shrink-0">
                                          <Image src={item.sampleImageDataUri} alt={`Sample for ${item.description}`} fill className="object-contain rounded-md border bg-muted" />
                                      </div>
                                  )}
                                  <div className="flex-grow">
                                      {item.itemCategory && (
                                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory}</span>
                                      )}
                                      <p className="font-bold">{item.description}</p>
                                      <div className="text-sm text-muted-foreground space-y-1 mt-1">
                                          {(() => {
                                            const mName = item.metalType === 'silver' ? '925 Sterling Silver' : `${item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1)}${item.karat ? ` (${item.karat.toUpperCase()})` : ''}`;
                                            return item.isManualPrice ? (
                                              <>
                                                <p className="font-medium">{mName}</p>
                                                <p>Price: PKR {(item.manualPrice || item.totalEstimate || 0).toLocaleString()}</p>
                                              </>
                                            ) : (
                                              <p>
                                                {mName} | Est. Wt: {item.estimatedWeightG}g
                                                {item.metalType !== 'silver' && item.wastagePercentage > 0 && ` | Wastage: ${item.wastagePercentage}%`}
                                              </p>
                                            );
                                          })()}
                                          {item.referenceSku && <p>Ref SKU: {item.referenceSku}</p>}
                                          {item.sampleGiven && <p>Sample Provided by Customer</p>}
                                          {karigarName && <p className="font-medium flex items-center gap-1"><Briefcase className="w-3 h-3"/>Karigar: {karigarName}</p>}
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
                                          {item.diamondCharges > 0 && <div className="flex justify-between"><span>+ Diamond Charges:</span> <span className="font-semibold">PKR {item.diamondCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                          {item.stoneCharges > 0 && <div className="flex justify-between"><span>+ Other Stone Charges:</span> <span className="font-semibold">PKR {item.stoneCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                                          <Separator className="my-1"/>
                                          <div className="flex justify-between font-bold"><span>Item Total:</span> <span>PKR {(item.totalEstimate ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                                      </div>
                                  </div>
                              </div>
                              <div className="flex items-center space-x-2 flex-shrink-0">
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
              </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
