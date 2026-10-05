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
import { finalizedItemCosts, orderInvoiceRates, takesWastageAndMaking, wastageGramsFor, wastagePercentFor } from '@/lib/order-finalize';
import { exchangeTotal, orderExchanges } from '@/lib/exchange';
import { orderAdvancePayments } from '@/lib/order-payment';
import { CostRateField, MarginFigure, SHOP_MARGIN_ON } from '@/components/shared/shop-margin';
import { marginOf } from '@/lib/margin';

// --- Finalize Order Dialog Components ---
const finalizeOrderItemSchema = z.object({
  description: z.string(), // Readonly
  karat: z.custom<KaratValue>(), // Readonly
  metalType: z.enum(metalTypeValues), // Readonly
  isManualPrice: z.boolean().default(true),
  finalManualPrice: z.coerce.number().min(0).default(0),
  finalWeightG: z.coerce.number().min(0).default(0),
  finalWastagePercentage: z.coerce.number().min(0, "Cannot be negative.").default(0),
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

const rs = (n: number) => `PKR ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;
const grams3 = (g: number) => Math.round((Number(g) || 0) * 1000) / 1000;

/** A unit at the right edge of a number box: "%" and "g" side by side read as one figure two ways. */
const Unit: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{children}</span>
);

/**
 * Finalize & invoice: the finished pieces' weight, wastage and making (and stones, diamonds), the
 * discount, and what it all comes to — the owner, 2026-10-05: change "the wastage and making …
 * without having to re-edit it". Wastage was missing, so a different figure meant editing the
 * invoice after; and nothing showed the price until the invoice existed. Each piece's price and the
 * balance are worked out here as you type, by the same calculation the invoice is written with
 * (lib/order-finalize.ts), at the order's booked rate.
 */
export const FinalizeOrderDialog: React.FC<{
    order: Order;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}> = ({ order, open, onOpenChange }) => {
    const { generateInvoiceFromOrder, settings } = useAppStore(s => ({ generateInvoiceFromOrder: s.generateInvoiceFromOrder, settings: s.settings }));
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
                finalWastagePercentage: Number(item.wastagePercentage) || 0,
                finalMakingCharges: item.makingCharges,
                finalDiamondCharges: item.diamondCharges,
                finalStoneCharges: item.stoneCharges,
            })),
            additionalDiscount: Number(order?.discountAmount) || 0,
        }
    });

    const { fields } = useFieldArray({ control: form.control, name: "items" });

    // What it comes to, live: the order's booked rate, the figures as typed.
    const rates = React.useMemo(() => orderInvoiceRates(order, settings), [order, settings]);
    const typed = form.watch('items');
    const discount = Number(form.watch('additionalDiscount')) || 0;
    const costs = order.items.map((it, i) => typed?.[i] ? finalizedItemCosts(it, typed[i], rates) : null);
    const prices = costs.map(c => c?.price ?? 0);
    const subtotal = prices.reduce((a, b) => a + b, 0);
    const exchange = exchangeTotal(orderExchanges(order));
    const advances = orderAdvancePayments(order).reduce((a, p) => a + (Number(p.amount) || 0), 0);
    const balance = subtotal - discount - exchange - advances;
    // The 24k rate now, for the shop's margin (lib/margin.ts): the order's own to start with, if it had one.
    const [costRate24k, setCostRate24k] = React.useState<number | undefined>(Number(order.costRate24k) > 0 ? Number(order.costRate24k) : undefined);
    // Each piece as the invoice will hold it, so this is the margin the invoice's page shows.
    const margin = marginOf(order.items.map((it, i) => ({
        metalType: it.metalType, karat: it.karat,
        weightG: typed?.[i]?.isManualPrice ? 0 : Number(typed?.[i]?.finalWeightG) || 0,
        stoneWeightG: it.stoneWeightG, price: prices[i],
        stoneCharges: costs[i]?.stoneCharges, diamondCharges: costs[i]?.diamondCharges,
    })), subtotal - discount, costRate24k);
    const rateLine = order.items.some(it => it.metalType === 'gold')
      ? (['21k', '22k', '18k', '24k'] as const)
          .filter(k => order.items.some(it => it.metalType === 'gold' && it.karat === k))
          .map(k => `${k} ${Number(rates[`goldRatePerGram${k}`] || 0).toLocaleString('en-PK')}/g`).join(' · ')
      : '';

    const handleFinalize = async (data: FinalizeOrderFormData) => {
        const newInvoice = await generateInvoiceFromOrder(order, data.items, data.additionalDiscount, costRate24k);
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
                        The finished pieces' weight, wastage and making — change any of them here; the order itself stays as it was.
                        Everything settled on the order carries over to the invoice: each advance as a payment with its date and how
                        it was paid, the gold taken in exchange, the discount, who took the order, the delivery address and the notes.
                    </DialogDescription>
                </DialogHeader>
                 <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleFinalize)} className="space-y-6">
                        <ScrollArea className="h-[50vh] p-1">
                            <div className="space-y-4 p-3">
                                {fields.map((field, index) => {
                                    const original = order.items[index];
                                    const manual = !!typed?.[index]?.isManualPrice;
                                    const onOrder = Number(original?.isManualPrice ? original.manualPrice : original?.totalEstimate) || 0;
                                    const stoneG = Number(original?.stoneWeightG) || 0;
                                    const weight = Number(typed?.[index]?.finalWeightG) || 0;
                                    const metal = form.getValues(`items.${index}.metalType`);
                                    return (
                                    <Card key={field.id} className="p-4 bg-muted/50 space-y-3">
                                        <div className="flex items-baseline justify-between gap-3">
                                          <p className="font-bold text-sm min-w-0">Item #{index + 1}: {form.getValues(`items.${index}.description`)}</p>
                                          {/* The piece's price as typed, and what the order had it at when it differs. */}
                                          <p className="shrink-0 text-right text-sm tabular-nums">
                                            <span className="font-semibold">{rs(prices[index])}</span>
                                            {onOrder > 0 && Math.round(onOrder) !== Math.round(prices[index]) && (
                                              <span className="block text-xs text-muted-foreground">on the order {rs(onOrder)}</span>
                                            )}
                                          </p>
                                        </div>
                                        {/* Manual price (Primary) */}
                                        {manual && (
                                            <FormField control={form.control} name={`items.${index}.finalManualPrice`} render={({ field }) => (
                                                <FormItem><FormLabel className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/>Final Price (PKR)</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                            )}/>
                                        )}
                                        {/* Toggle to rate calculation */}
                                        <FormField control={form.control} name={`items.${index}.isManualPrice`} render={({ field }) => (
                                            <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-2 bg-muted/30">
                                                <FormControl><Checkbox checked={!field.value} onCheckedChange={(checked) => field.onChange(!checked)} /></FormControl>
                                                <div className="space-y-0.5 leading-none">
                                                    <FormLabel className="text-xs text-muted-foreground cursor-pointer">Price it by weight, wastage and making</FormLabel>
                                                </div>
                                            </FormItem>
                                        )}/>
                                        {/* Rate calculation (Secondary) */}
                                        {!manual && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <FormField control={form.control} name={`items.${index}.finalWeightG`} render={({ field }) => (
                                                    <FormItem><FormLabel className="flex items-center"><Weight className="mr-2 h-4"/>Final Weight (g)</FormLabel><FormControl><AmountInput maxDecimals={3} {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                                {takesWastageAndMaking(metal) ? (
                                                  // One figure two ways: the percentage the price is made from, and the
                                                  // grams the karigar writes ("6.500 + 0.650") and the invoice prints.
                                                  <FormField control={form.control} name={`items.${index}.finalWastagePercentage`} render={({ field }) => (
                                                    <FormItem>
                                                      <FormLabel className="flex items-center"><Percent className="mr-2 h-4"/>Wastage</FormLabel>
                                                      <div className="grid grid-cols-2 gap-2">
                                                        <div className="relative">
                                                          <FormControl><AmountInput {...field} maxDecimals={2} placeholder="0" aria-label="Wastage in percent" className="pr-7" /></FormControl>
                                                          <Unit>%</Unit>
                                                        </div>
                                                        <div className="relative">
                                                          <AmountInput
                                                            aria-label="Wastage in grams" maxDecimals={3} placeholder="0" className="pr-7"
                                                            value={grams3(wastageGramsFor(Number(field.value) || 0, weight, stoneG))}
                                                            onValueChange={g => field.onChange(wastagePercentFor(Number(g) || 0, weight, stoneG))}
                                                          />
                                                          <Unit>g</Unit>
                                                        </div>
                                                      </div>
                                                      {stoneG > 0 && <FormDescription>Of the metal: {grams3(weight)} g less {grams3(stoneG)} g of stones.</FormDescription>}
                                                      <FormMessage />
                                                    </FormItem>
                                                  )}/>
                                                ) : (
                                                  <p className="self-end pb-2 text-xs text-muted-foreground">Silver&apos;s rate per gram covers its making and wastage.</p>
                                                )}
                                                {takesWastageAndMaking(metal) && (
                                                  <FormField control={form.control} name={`items.${index}.finalMakingCharges`} render={({ field }) => (
                                                      <FormItem><FormLabel className="flex items-center"><Gem className="mr-2 h-4"/>Making (PKR)</FormLabel><FormControl><AmountInput zeroAsEmpty placeholder="0" {...field} /></FormControl><FormMessage /></FormItem>
                                                  )}/>
                                                )}
                                                <FormField control={form.control} name={`items.${index}.finalStoneCharges`} render={({ field }) => (
                                                    <FormItem><FormLabel>Stones (PKR)</FormLabel><FormControl><AmountInput zeroAsEmpty placeholder="0" {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                                <FormField control={form.control} name={`items.${index}.finalDiamondCharges`} render={({ field }) => (
                                                    <FormItem><FormLabel className="flex items-center"><Diamond className="mr-2 h-4"/>Diamonds (PKR)</FormLabel><FormControl><AmountInput zeroAsEmpty placeholder="0" {...field} /></FormControl><FormMessage /></FormItem>
                                                )}/>
                                            </div>
                                        )}
                                    </Card>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                        <Separator />
                        <div className="p-3 grid gap-4 md:grid-cols-2">
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
                            {/* What the invoice will say, before it exists. */}
                            <div className="rounded-md border bg-muted/30 p-3 text-sm tabular-nums space-y-1" aria-live="polite">
                              <div className="flex justify-between"><span>Pieces</span><span>{rs(subtotal)}</span></div>
                              {discount > 0 && <div className="flex justify-between text-muted-foreground"><span>Discount</span><span>− {rs(discount)}</span></div>}
                              {exchange > 0 && <div className="flex justify-between text-muted-foreground"><span>Exchange</span><span>− {rs(exchange)}</span></div>}
                              {advances > 0 && <div className="flex justify-between text-muted-foreground"><span>Advances paid</span><span>− {rs(advances)}</span></div>}
                              <div className="flex justify-between border-t pt-1 font-semibold"><span>{balance < 0 ? 'Owed to the customer' : 'Balance due'}</span><span>{rs(Math.abs(balance))}</span></div>
                              {rateLine && <p className="pt-1 text-xs text-muted-foreground">At the order&apos;s rate: {rateLine}</p>}
                            </div>
                            {/* The shop's margin on the invoice this makes — blurred until tapped, never printed. */}
                            {SHOP_MARGIN_ON && (
                              <div className="md:col-span-2 grid gap-3 sm:grid-cols-2 sm:items-end">
                                <CostRateField id="finalize-cost-rate-24k" value={costRate24k} onChange={setCostRate24k} sheetRate24k={settings.goldRatePerGram24k} />
                                <MarginFigure margin={margin} />
                              </div>
                            )}
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
