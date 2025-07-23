
"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppStore, Settings, KaratValue, useAppReady, calculateProductCosts } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Loader2, DollarSign, Weight, Zap, Diamond, Gem as GemIcon, FileText, Printer, PencilRuler } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';

// Extend jsPDF interface for the autoTable plugin
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const karatValues: [KaratValue, ...KaratValue[]] = ['18k', '21k', '22k', '24k'];

// Schema for the custom order form
const orderFormSchema = z.object({
  description: z.string().min(3, "Description is required"),
  karat: z.enum(karatValues),
  estimatedWeightG: z.coerce.number().min(0.1, "Weight must be a positive number"),
  makingCharges: z.coerce.number().min(0).default(0),
  diamondCharges: z.coerce.number().min(0).default(0),
  stoneCharges: z.coerce.number().min(0).default(0),
  goldRate: z.coerce.number().min(1, "Gold rate must be positive"),
});

type OrderFormData = z.infer<typeof orderFormSchema>;

type GeneratedEstimate = OrderFormData & {
  metalCost: number;
  totalEstimate: number;
};

export default function CustomOrderPage() {
  const { toast } = useToast();
  const appReady = useAppReady();
  const settings = useAppStore(state => state.settings);
  const isLoading = useAppStore(state => state.isSettingsLoading);

  const [generatedEstimate, setGeneratedEstimate] = useState<GeneratedEstimate | null>(null);

  const form = useForm<OrderFormData>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      description: '',
      karat: '21k',
      estimatedWeightG: 0,
      makingCharges: 0,
      diamondCharges: 0,
      stoneCharges: 0,
      goldRate: settings.goldRatePerGram || 0,
    },
  });

  useEffect(() => {
    if (settings.goldRatePerGram > 0) {
      form.setValue('goldRate', settings.goldRatePerGram);
    }
  }, [settings.goldRatePerGram, form]);

  const formValues = form.watch();

  const liveEstimate = useMemo(() => {
    const { estimatedWeightG, karat, goldRate, makingCharges, diamondCharges, stoneCharges } = form.getValues();
    if (estimatedWeightG <= 0 || goldRate <= 0) return { metalCost: 0, totalEstimate: 0 };
    
    const productForCalc = {
      metalType: 'gold' as const,
      karat: karat,
      metalWeightG: estimatedWeightG,
      wastagePercentage: 0, // Wastage is not part of this custom form
      makingCharges,
      hasDiamonds: diamondCharges > 0,
      diamondCharges,
      stoneCharges,
      miscCharges: 0
    };

    const ratesForCalc = {
      goldRatePerGram24k: goldRate,
      palladiumRatePerGram: 0,
      platinumRatePerGram: 0,
    };
    
    const costs = calculateProductCosts(productForCalc, ratesForCalc);

    return {
      metalCost: costs.metalCost,
      totalEstimate: costs.totalPrice,
    };
  }, [formValues, form]);


  const onSubmit = (data: OrderFormData) => {
    const { metalCost, totalEstimate } = liveEstimate;
    setGeneratedEstimate({ ...data, metalCost, totalEstimate });
    toast({ title: "Estimate Ready", description: "Custom order estimate is ready to be printed." });
  };
  
  const printEstimate = (estimate: GeneratedEstimate) => {
    if (typeof window === 'undefined') return;

    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;

    // Header
    if (settings.shopLogoUrl) doc.addImage(settings.shopLogoUrl, 'PNG', margin, 15, 40, 10, undefined, 'FAST');
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text('CUSTOM ORDER ESTIMATE', pageWidth - margin, 22, { align: 'right' });

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${new Date().toLocaleDateString()}`, pageWidth - margin, 29, { align: 'right' });
    
    const goldRate21k = estimate.goldRate * (21/24);
    doc.text(`Gold Rate (21k): PKR ${goldRate21k.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/g`, pageWidth - margin, 34, { align: 'right' });


    // Body
    let yPos = 55;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Estimate Details", margin, yPos);
    yPos += 8;

    const addLineItem = (label: string, value: string) => {
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(label, margin, yPos);
      doc.setFont("helvetica", "normal");
      doc.text(value, margin + 50, yPos);
      yPos += 7;
    };
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(estimate.description, margin, yPos);
    yPos += 10;
    
    addLineItem("Karat:", estimate.karat.toUpperCase());
    addLineItem("Est. Gold Weight:", `${estimate.estimatedWeightG.toFixed(2)} g`);

    yPos += 5;
    doc.setLineDashPattern([1, 1], 0);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 10;
    
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Cost Breakdown", margin, yPos);
    yPos += 8;

    const addCostLine = (label: string, amount: number) => {
      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      doc.text(label, margin, yPos);
      doc.text(`PKR ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, pageWidth - margin, yPos, { align: 'right' });
      yPos += 7;
    };

    addCostLine("Estimated Metal Cost", estimate.metalCost);
    if(estimate.makingCharges > 0) addCostLine("Making Charges", estimate.makingCharges);
    if(estimate.diamondCharges > 0) addCostLine("Diamond Charges", estimate.diamondCharges);
    if(estimate.stoneCharges > 0) addCostLine("Other Stone Charges", estimate.stoneCharges);
    
    yPos += 3;
    doc.setLineDashPattern([], 0);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 10;

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("Grand Total:", margin, yPos);
    doc.text(`PKR ${estimate.totalEstimate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, pageWidth - margin, yPos, { align: 'right' });

    // Footer
    const guaranteesText = "This is to certify that all 21k gold used in our Jewelry has been independently tested and verified by Swiss Lab Ltd., confirming a purity of 0.875 fineness (21 karat). We further guarantee that every piece is crafted exclusively from premium ARY GOLD.";
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(guaranteesText, margin, pageHeight - 45, { maxWidth: pageWidth / 2.5 });
    
    doc.setFont("helvetica", "normal");
    doc.text("Thank you for your business!", margin, pageHeight - 30);

    const qrCodeSize = 25;
    const qrYPos = pageHeight - 35;
    const qrSectionWidth = (qrCodeSize * 2) + 25;
    const qrStartX = pageWidth - margin - qrSectionWidth;

    const instaQrCanvas = document.getElementById('insta-qr-code') as HTMLCanvasElement;
    const waQrCanvas = document.getElementById('wa-qr-code') as HTMLCanvasElement;

    if (instaQrCanvas && waQrCanvas) {
      doc.addImage('https://placehold.co/20x20.png?text=I', 'PNG', qrStartX, qrYPos - 7, 5, 5);
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.text("Follow on Instagram", qrStartX + 7, qrYPos - 3);
      doc.addImage(instaQrCanvas.toDataURL('image/png'), 'PNG', qrStartX, qrYPos, qrCodeSize, qrCodeSize);
      
      const secondQrX = qrStartX + qrCodeSize + 15;
      doc.addImage('https://placehold.co/20x20.png?text=W', 'PNG', secondQrX, qrYPos - 7, 5, 5);
      doc.setFontSize(8); doc.setFont("helvetica", "bold");
      doc.text("Join WhatsApp Community", secondQrX + 7, qrYPos - 3);
      doc.addImage(waQrCanvas.toDataURL('image/png'), 'PNG', secondQrX, qrYPos, qrCodeSize, qrCodeSize);
    }

    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
  }

  if (!appReady || isLoading) {
    return (
      <div className="container mx-auto p-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading Custom Order Form...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
       <div style={{ display: 'none' }}>
        <QRCode id="wa-qr-code" value="https://chat.whatsapp.com/HMeoF0Zcl0i9XobLspaCWl?mode=ac_t" size={128} />
        <QRCode id="insta-qr-code" value="https://www.instagram.com/collectionstaheri?igsh=bWs4YWgydjJ1cXBz&utm_source=qr" size={128} />
      </div>

      {!generatedEstimate ? (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center"><PencilRuler className="mr-3 h-6 w-6 text-primary"/>Create Custom Order Estimate</CardTitle>
                  <CardDescription>Enter the details for a new custom piece to generate a price estimate.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control} name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Item Description</FormLabel>
                        <FormControl><Textarea placeholder="e.g., Custom 22k gold ring with ruby stone" {...field} rows={3}/></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField
                      control={form.control} name="estimatedWeightG"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4"/>Estimated Gold Weight (grams)</FormLabel>
                          <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control} name="karat"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center"><Zap className="mr-2 h-4 w-4"/>Gold Karat</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                            <SelectContent>
                              {karatValues.map(k => <SelectItem key={k} value={k}>{k.toUpperCase()}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <Separator />
                  <p className="font-medium">Additional Charges</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <FormField
                      control={form.control} name="makingCharges"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center"><GemIcon className="mr-2 h-4 w-4"/>Making Charges</FormLabel>
                          <FormControl><Input type="number" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control} name="diamondCharges"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center"><Diamond className="mr-2 h-4 w-4"/>Diamond Charges</FormLabel>
                          <FormControl><Input type="number" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                     <FormField
                      control={form.control} name="stoneCharges"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Other Stone Charges</FormLabel>
                          <FormControl><Input type="number" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <Separator />
                   <FormField
                      control={form.control} name="goldRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/>Gold Rate for this Estimate (PKR per gram, 24k)</FormLabel>
                          <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                          <FormDescription>Defaults to the current store setting but can be overridden here.</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                </CardContent>
              </Card>
            </div>
            
            <div className="lg:col-span-1">
                <Card className="sticky top-8">
                    <CardHeader>
                        <CardTitle>Live Estimate</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2 p-3 bg-muted/50 rounded-md">
                            <div className="flex justify-between items-center">
                                <span className="text-muted-foreground">Est. Metal Cost:</span>
                                <span className="font-semibold text-lg">PKR {liveEstimate.metalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between items-center text-xl font-bold">
                                <span>Grand Total:</span>
                                <span className="text-primary">PKR {liveEstimate.totalEstimate.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                        </div>
                         <p className="text-xs text-muted-foreground">
                          Total is calculated based on all values entered in the form.
                        </p>
                    </CardContent>
                    <CardFooter>
                        <Button type="submit" size="lg" className="w-full" disabled={!form.formState.isValid}>
                        <FileText className="mr-2 h-5 w-5" /> Generate Estimate
                        </Button>
                    </CardFooter>
                </Card>
            </div>
          </form>
        </Form>
      ) : (
        <Card>
            <CardHeader>
                <CardTitle>Custom Order Estimate Generated</CardTitle>
                <CardDescription>
                    The following estimate has been prepared based on your inputs.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="space-y-2 mb-6">
                    <p><strong>Description:</strong> {generatedEstimate.description}</p>
                    <p><strong>Est. Weight:</strong> {generatedEstimate.estimatedWeightG}g ({generatedEstimate.karat.toUpperCase()})</p>
                </div>
                 <div className="space-y-2 p-4 bg-muted rounded-md text-lg">
                    <div className="flex justify-between"><span>Est. Metal Cost:</span> <span className="font-semibold">PKR {generatedEstimate.metalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                    {generatedEstimate.makingCharges > 0 && <div className="flex justify-between"><span>Making Charges:</span> <span className="font-semibold">PKR {generatedEstimate.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                    {generatedEstimate.diamondCharges > 0 && <div className="flex justify-between"><span>Diamond Charges:</span> <span className="font-semibold">PKR {generatedEstimate.diamondCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                    {generatedEstimate.stoneCharges > 0 && <div className="flex justify-between"><span>Other Stone Charges:</span> <span className="font-semibold">PKR {generatedEstimate.stoneCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>}
                    <Separator className="my-2 bg-muted-foreground/20"/>
                    <div className="flex justify-between font-bold text-xl"><span className="text-primary">Grand Total:</span> <span className="text-primary">PKR {generatedEstimate.totalEstimate.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setGeneratedEstimate(null)}>Create New Estimate</Button>
                <Button onClick={() => printEstimate(generatedEstimate)}>
                    <Printer className="mr-2 h-4 w-4"/> Print Estimate
                </Button>
            </CardFooter>
        </Card>
      )}
    </div>
  );
}
