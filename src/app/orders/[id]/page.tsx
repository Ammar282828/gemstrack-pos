

"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAppStore, Order, OrderStatus, ORDER_STATUSES, KaratValue, OrderItem, Settings, Invoice, Product, MetalType } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, User, DollarSign, Calendar, Edit, Loader2, Diamond, Gem, MessageSquare, FileText, Weight, Percent } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
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
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';


const getStatusBadgeVariant = (status: OrderStatus) => {
    switch (status) {
      case 'Pending': return 'bg-yellow-500/80 text-yellow-50';
      case 'In Progress': return 'bg-blue-500/80 text-blue-50';
      case 'Completed': return 'bg-green-500/80 text-green-50';
      case 'Cancelled': return 'bg-red-500/80 text-red-50';
      default: return 'secondary';
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

type NotificationType = 'inProgress' | 'completed';

// --- Finalize Order Dialog Components ---
const metalTypeValues: [MetalType, ...MetalType[]] = ['gold', 'palladium', 'platinum', 'silver'];
const finalizeOrderItemSchema = z.object({
  description: z.string(), // Readonly
  karat: z.custom<KaratValue>(), // Readonly
  finalWeightG: z.coerce.number().min(0.1, "Weight must be positive."),
  finalMakingCharges: z.coerce.number().min(0, "Cannot be negative."),
  finalDiamondCharges: z.coerce.number().min(0, "Cannot be negative."),
  finalStoneCharges: z.coerce.number().min(0, "Cannot be negative."),
  metalType: z.enum(metalTypeValues), // Readonly, corrected type
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
                finalWeightG: item.estimatedWeightG,
                finalMakingCharges: item.makingCharges,
                finalDiamondCharges: item.diamondCharges,
                finalStoneCharges: item.stoneCharges,
                metalType: item.metalType,
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


export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const orderId = params.id as string;

  const isHydrated = useIsStoreHydrated();
  const order = useAppStore(state => state.orders.find(o => o.id === orderId));
  const settings = useAppStore(state => state.settings);
  const { updateOrderStatus, updateOrderItemStatus, updateOrder } = useAppStore();
  
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isUpdatingItem, setIsUpdatingItem] = useState<number | null>(null);

  const [isNotificationDialogOpen, setIsNotificationDialogOpen] = useState(false);
  const [notificationType, setNotificationType] = useState<NotificationType | null>(null);
  const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = useState(false);


  const phoneForm = useForm<PhoneForm>();

  useEffect(() => {
    if(order?.customerContact) {
      phoneForm.setValue('phone', order.customerContact);
    }
  }, [order, phoneForm]);

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
    message += `This is an update regarding your order *#${order.id}* from ${settings.shopName}.\n\n`;

    if (notificationType === 'inProgress') {
        message += `We are happy to inform you that your order is now *In Progress*. We will notify you again once it is ready for collection.\n\n`;
    } else if (notificationType === 'completed') {
        message += `Great news! Your custom order is now *Completed* and ready for collection.\n\n`;
        message += `*Amount Due:* PKR ${order.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    }

    message += `Thank you for your business!`;

    const numberOnly = whatsAppNumber.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${numberOnly}?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, '_blank');
    toast({ title: "Redirecting to WhatsApp", description: "Your message is ready to be sent." });
    setIsNotificationDialogOpen(false); // Close dialog after sending
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
      <div className="container mx-auto p-4 text-center">
        <h2 className="text-2xl font-semibold">Order not found</h2>
        <Link href="/orders" passHref>
          <Button variant="link" className="mt-4">Go back to orders dashboard</Button>
        </Link>
      </div>
    );
  }

  // Robustly handle potentially missing financial data
  const subtotal = typeof order.subtotal === 'number' ? order.subtotal : 0;
  const advancePayment = typeof order.advancePayment === 'number' ? order.advancePayment : 0;
  const advanceInExchangeValue = typeof order.advanceInExchangeValue === 'number' ? order.advanceInExchangeValue : 0;
  const grandTotal = typeof order.grandTotal === 'number' ? order.grandTotal : 0;
  
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
    <div className="container mx-auto p-4 space-y-6">
      <Dialog open={isNotificationDialogOpen} onOpenChange={setIsNotificationDialogOpen}>
        <DialogContent>
            <DialogHeader>
            <DialogTitle className="flex items-center"><MessageSquare className="mr-2 h-5 w-5"/>Notify Customer via WhatsApp</DialogTitle>
            <DialogDescription>
                The order status has been updated to "{notificationType === 'inProgress' ? 'In Progress' : 'Completed'}".
                Would you like to send a notification to the customer?
            </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
                 <div>
                    <Label htmlFor="whatsapp-number">Customer WhatsApp Number</Label>
                    <PhoneInput
                        name="phone"
                        control={phoneForm.control as unknown as Control}
                        defaultCountry="PK"
                        international
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm mt-1"
                    />
                </div>
            </div>
            <DialogFooter>
            <Button variant="outline" onClick={() => setIsNotificationDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSendWhatsApp}>
                <MessageSquare className="mr-2 h-4 w-4"/> Send Update
            </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {order && <FinalizeOrderDialog order={order} open={isFinalizeDialogOpen} onOpenChange={setIsFinalizeDialogOpen} />}

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
                           <Button asChild variant="outline">
                             <Link href={`/orders/${order.id}/edit`}>
                                <Edit className="mr-2 h-4 w-4" /> Edit Order
                             </Link>
                           </Button>
                           {order.status === 'Completed' && (
                            <Button onClick={() => setIsFinalizeDialogOpen(true)}>
                                <FileText className="mr-2 h-4 w-4" /> Finalize & Generate Invoice
                            </Button>
                           )}
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
                      {order.items.map((item, index) => (
                          <div key={index} className="p-4 border rounded-lg flex flex-col md:flex-row gap-4 bg-muted/30">
                              <div className="flex items-start gap-4 flex-grow">
                                  {item.sampleImageDataUri && (
                                      <div className="relative w-24 h-24 flex-shrink-0">
                                          <Image src={item.sampleImageDataUri} alt={`Sample for ${item.description}`} fill className="object-contain rounded-md border bg-muted" />
                                      </div>
                                  )}
                                  <div className="flex-grow">
                                      <p className="font-bold">{item.description}</p>
                                      <p className="text-sm text-muted-foreground">
                                          Est. Wt: {item.estimatedWeightG}g {item.karat ? `(${item.karat.toUpperCase()})` : ''}
                                          {item.wastagePercentage > 0 && ` | Wastage: ${item.wastagePercentage}%`}
                                          {item.referenceSku && ` | Ref: ${item.referenceSku}`}
                                          {item.sampleGiven && ` | Sample Provided`}
                                      </p>
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
                      ))}
                  </div>

                  <Separator className="my-6" />

                  <div className="flex justify-end">
                      <div className="w-full max-w-sm space-y-2 p-4 text-base">
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
