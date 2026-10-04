'use client';

/**
 * The order's two money dialogs, on the order page and on the Orders hub's cards (2026-10-04):
 * Finalize & invoice (the final weights and charges, the discount; everything settled on the
 * order carries over to the invoice), and Record an advance (dated today, with how it was paid).
 * Moved out of src/app/orders/[id]/page.tsx so the list can open them without the order page.
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { DollarSign, Diamond, FileText, Gem, Loader2, Percent, Weight } from 'lucide-react';
import { useAppStore, type KaratValue, type Order, PAYMENT_TYPES } from '@/lib/store';
import { METAL_TYPES as metalTypeValues } from '@/lib/materials';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { AmountInput } from '@/components/ui/amount-input';

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

export const FinalizeOrderDialog: React.FC<{
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
             router.push(`/invoices/${newInvoice.id}`);
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
                    <DialogTitle>Finalize & invoice</DialogTitle>
                    <DialogDescription>
                        Confirm or update the final weights and charges for each item. Everything settled on the order carries over
                        to the invoice: each advance as a payment with its date and how it was paid, the gold taken in exchange,
                        the discount, who took the order, the delivery address and the notes.
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
                                Finalize & invoice
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
  method: z.enum(PAYMENT_TYPES).default('Cash'),
});
type RecordAdvanceFormData = z.infer<typeof recordAdvanceSchema>;

export const RecordAdvanceDialog: React.FC<{
    order: Order;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}> = ({ order, open, onOpenChange }) => {
    const { recordOrderAdvance } = useAppStore();
    const { toast } = useToast();
    const form = useForm<RecordAdvanceFormData>({
      resolver: zodResolver(recordAdvanceSchema),
      defaultValues: { amount: undefined, notes: 'Advance payment received', method: 'Cash' }
    });

    const handleRecordAdvance = async (data: RecordAdvanceFormData) => {
        try {
            await recordOrderAdvance(order.id, data.amount, data.notes, data.method);
            toast({
                title: "Advance Recorded",
                description: `PKR ${data.amount.toLocaleString()} by ${data.method} has been added to the advance for order ${order.id}.`,
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
                    <DialogTitle>Record an advance</DialogTitle>
                    <DialogDescription>
                        Add a subsequent advance payment received for order {order.id}. This will update the balance due.
                    </DialogDescription>
                </DialogHeader>
                 <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleRecordAdvance)} className="space-y-4 pt-4">
                        <FormField control={form.control} name="amount" render={({ field }) => (
                           <FormItem><FormLabel>Advance Amount (PKR)</FormLabel><FormControl><AmountInput placeholder="Enter amount received" {...field} /></FormControl><FormMessage /></FormItem>
                        )}/>
                        <FormField control={form.control} name="method" render={({ field }) => (
                           <FormItem><FormLabel>Paid by</FormLabel>
                             <Select value={field.value} onValueChange={field.onChange}>
                               <FormControl><SelectTrigger aria-label="Advance paid by"><SelectValue /></SelectTrigger></FormControl>
                               <SelectContent>{PAYMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                             </Select>
                           <FormMessage /></FormItem>
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
