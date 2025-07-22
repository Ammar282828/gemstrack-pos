
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal, Customer, Settings, InvoiceItem, Invoice as InvoiceType, calculateProductCosts, useAppReady, Product } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Plus, Minus, ShoppingCart, FileText, Printer, User, XCircle, Settings as SettingsIcon, Percent, Info, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import QRCode from 'qrcode.react';


declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const WALK_IN_CUSTOMER_VALUE = "__WALK_IN__";

// A temporary structure to hold the real-time calculated invoice preview
type EstimatedInvoice = {
    subtotal: number;
    grandTotal: number;
    items: (InvoiceItem & { originalPrice: number })[];
};


export default function CartPage() {
  console.log("[GemsTrack] CartPage: Rendering START");
  const { toast } = useToast();

  const appReady = useAppReady();
  const cartItemsFromStore = useAppStore(selectCartDetails);
  const customers = useAppStore(state => state.customers);
  const settings = useAppStore(state => state.settings);
  const { updateCartQuantity, removeFromCart, clearCart, generateInvoice: generateInvoiceAction } = useAppStore();
  const productsInCart = useAppStore(state => state.cart.map(ci => state.products.find(p => p.sku === ci.sku)).filter(Boolean) as Product[]);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);
  const [generatedInvoice, setGeneratedInvoice] = useState<InvoiceType | null>(null);

  const [invoiceGoldRateInput, setInvoiceGoldRateInput] = useState<string>('');
  const [discountAmountInput, setDiscountAmountInput] = useState<string>('0');
  
  useEffect(() => {
    if (appReady && settings && typeof settings.goldRatePerGram === 'number') {
      setInvoiceGoldRateInput(settings.goldRatePerGram.toString());
    } else if (appReady) {
      console.warn("[GemsTrack] CartPage: Could not set initial invoiceGoldRateInput because settings or goldRatePerGram was missing/invalid.", settings);
      setInvoiceGoldRateInput("0");
    }
  }, [appReady, settings]);

  const cartContainsNonGoldItems = cartItemsFromStore.some(item => item.metalType !== 'gold');
  
  const estimatedInvoice = useMemo((): EstimatedInvoice | null => {
    if (!appReady || !settings || cartItemsFromStore.length === 0) return null;
    
    const parsedGoldRate = parseFloat(invoiceGoldRateInput);
    const hasGoldItems = cartItemsFromStore.some(item => item.metalType === 'gold');
    
    if (hasGoldItems && (isNaN(parsedGoldRate) || parsedGoldRate <= 0)) {
        return null; // Don't calculate if gold rate is invalid for a cart with gold items
    }
    
    const ratesForCalc = {
        goldRatePerGram24k: parsedGoldRate || 0,
        palladiumRatePerGram: settings.palladiumRatePerGram || 0,
        platinumRatePerGram: settings.platinumRatePerGram || 0,
    };
    
    let currentSubtotal = 0;
    const estimatedItems: EstimatedInvoice['items'] = [];

    cartItemsFromStore.forEach(cartItem => {
        const productForCalc = productsInCart.find(p => p.sku === cartItem.sku);
        if (productForCalc) {
            const costs = calculateProductCosts(productForCalc, ratesForCalc);
            const itemTotal = costs.totalPrice * cartItem.quantity;
            currentSubtotal += itemTotal;
            
            estimatedItems.push({
                ...cartItem,
                unitPrice: costs.totalPrice,
                itemTotal: itemTotal,
                metalCost: costs.metalCost,
                wastageCost: costs.wastageCost,
                wastagePercentage: productForCalc.wastagePercentage,
                makingCharges: costs.makingCharges,
                diamondChargesIfAny: costs.diamondCharges,
                stoneChargesIfAny: costs.stoneCharges,
                miscChargesIfAny: costs.miscCharges,
                originalPrice: cartItem.totalPrice,
            });
        }
    });

    const parsedDiscountAmount = parseFloat(discountAmountInput) || 0;
    const grandTotal = currentSubtotal - parsedDiscountAmount;

    return {
        subtotal: currentSubtotal,
        grandTotal: grandTotal,
        items: estimatedItems,
    };
  }, [appReady, settings, cartItemsFromStore, productsInCart, invoiceGoldRateInput, discountAmountInput]);


  const handleGenerateInvoice = async () => {
    if (cartItemsFromStore.length === 0) {
      toast({ title: "Cart Empty", description: "Cannot generate estimate for an empty cart.", variant: "destructive" });
      return;
    }
    
    if (!estimatedInvoice) {
        toast({ title: "Invalid Input", description: "Please ensure all rates and values are correct before generating the estimate.", variant: "destructive" });
        return;
    }

    const parsedGoldRate = parseFloat(invoiceGoldRateInput);
    const parsedDiscountAmount = parseFloat(discountAmountInput) || 0;

    const hasGoldItems = cartItemsFromStore.some(item => item.metalType === 'gold');
    if (hasGoldItems && (isNaN(parsedGoldRate) || parsedGoldRate <= 0)) {
      toast({ title: "Invalid Gold Rate", description: "Please enter a valid positive gold rate for gold items.", variant: "destructive" });
      return;
    }

    if (parsedDiscountAmount < 0) {
      toast({ title: "Invalid Discount", description: "Discount amount cannot be negative.", variant: "destructive" });
      return;
    }
    
    if (parsedDiscountAmount > estimatedInvoice.subtotal) {
        toast({ title: "Invalid Discount", description: "Discount cannot be greater than the subtotal.", variant: "destructive" });
        return;
    }

    const invoice = await generateInvoiceAction(selectedCustomerId, parsedGoldRate, parsedDiscountAmount);
    if (invoice) {
      setGeneratedInvoice(invoice);
      toast({ title: "Estimate Generated", description: `Estimate ${invoice.id} created successfully.` });
    } else {
      toast({ title: "Estimate Generation Failed", description: "Could not generate the estimate. Please check inputs and logs.", variant: "destructive" });
    }
  };

  const printInvoice = (invoiceToPrint: InvoiceType) => {
    const doc = new jsPDF();
    
    // Logo
    if (settings.shopLogoUrl) {
        try {
            // Using a placeholder that doesn't have text
            const logoUrl = 'https://placehold.co/150x40/FFFFFF/FFFFFF.png?text=%20';
            doc.addImage(logoUrl, 'PNG', 15, 12, 50, 13);
        } catch(e) { console.error("Error adding image to PDF:", e) }
    }

    // Shop Info
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(settings.shopName, 15, 32);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(settings.shopAddress, 15, 39);
    doc.text(settings.shopContact, 15, 44);

    // Invoice Info
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.text('ESTIMATE', 140, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Estimate #: ${invoiceToPrint.id}`, 140, 22);
    doc.text(`Date: ${new Date(invoiceToPrint.createdAt).toLocaleDateString()}`, 140, 27);

    // Metal Rates
    let rateYPos = 32;
    if (invoiceToPrint.goldRateApplied) {
        const goldRate21k = invoiceToPrint.goldRateApplied * (21/24);
        doc.text(`Gold Rate (21k): PKR ${goldRate21k.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/g`, 140, rateYPos);
        rateYPos += 5;
    }
    
    // Customer Info
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text('Bill To:', 15, 52);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    if (invoiceToPrint.customerId) {
      const customer = customers.find(c => c.id === invoiceToPrint.customerId);
      if (customer) {
        doc.text(customer.name, 15, 57);
        if(customer.address) doc.text(customer.address, 15, 62);
        if(customer.phone) doc.text(`Phone: ${customer.phone}`, 15, 67);
        if(customer.email) doc.text(`Email: ${customer.email}`, 15, 72);
      }
    } else {
        doc.text("Walk-in Customer", 15, 57);
    }

    // Items Table
    const tableColumn = ["#", "Item Description", "Qty", "Unit Price (PKR)", "Total (PKR)"];
    const tableRows: any[][] = [];

    invoiceToPrint.items.forEach((item, index) => {
      let metalDisplay = item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1);
      if (item.metalType === 'gold' && item.karat) {
        metalDisplay += ` (${item.karat.toUpperCase()})`;
      }

      let breakdownLines = [];
      breakdownLines.push(`  Metal Cost: ${item.metalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
      if (item.wastageCost > 0) breakdownLines.push(`  + Wastage (${item.wastagePercentage}%): ${item.wastageCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
      if (item.makingCharges > 0) breakdownLines.push(`  + Making Charges: ${item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
      if (item.diamondChargesIfAny > 0) breakdownLines.push(`  + Diamonds: ${item.diamondChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
      if (item.stoneChargesIfAny > 0) breakdownLines.push(`  + Stones: ${item.stoneChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
      if (item.miscChargesIfAny > 0) breakdownLines.push(`  + Misc: ${item.miscChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);

      const breakdown = breakdownLines.join('\n');

      const itemDescription = `${item.name} (SKU: ${item.sku})\nMetal: ${metalDisplay}, Wt: ${item.metalWeightG.toFixed(2)}g\n${breakdown ? breakdown : ''}`;

      const itemData = [
        index + 1,
        itemDescription.trim(),
        item.quantity,
        item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }),
        item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 }),
      ];
      tableRows.push(itemData);
    });

    doc.autoTable({
      head: [tableColumn],
      body: tableRows,
      startY: 80,
      theme: 'grid',
      headStyles: { fillColor: [0, 100, 0], fontStyle: 'bold' },
      styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
      columnStyles: {
        1: { cellWidth: 'auto' },
      },
    });

    // Totals Section
    const finalY = (doc as any).lastAutoTable.finalY || 100;
    let currentY = finalY + 10;
    
    // Subtotal
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`Subtotal:`, 140, currentY);
    doc.setFont("helvetica", "normal");
    doc.text(`PKR ${invoiceToPrint.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 205, currentY, { align: 'right' });
    
    currentY += 6;
    
    // Discount
    doc.setFont("helvetica", "bold");
    doc.text(`Discount:`, 140, currentY);
    doc.setFont("helvetica", "normal");
    doc.text(`PKR ${invoiceToPrint.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 205, currentY, { align: 'right' });

    currentY += 8;

    // Grand Total
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`Grand Total:`, 140, currentY);
    doc.text(`PKR ${invoiceToPrint.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 205, currentY, { align: 'right' });
    doc.setFont("helvetica", "normal");

    // Guarantees text positioning
    let guaranteesY = finalY + 10;
    doc.setFontSize(8);
    doc.text("Gold used is 100% as per described Karats & purity.", 15, guaranteesY);
    guaranteesY += 4;
    doc.setFont("helvetica", "bold");
    doc.text("Lab Tested Guarantees by ARY Assay Lab", 15, guaranteesY);
    doc.setFont("helvetica", "normal");


    doc.setFontSize(8);
    doc.text("Thank you for your business!", 15, doc.internal.pageSize.height - 25);

    // QR Codes
    const qrCodeSize = 20;
    const qrYPos = doc.internal.pageSize.height - 22;
    const waQrCanvas = document.getElementById('wa-qr-code') as HTMLCanvasElement;
    const instaQrCanvas = document.getElementById('insta-qr-code') as HTMLCanvasElement;
    
    if (instaQrCanvas) {
      doc.addImage(instaQrCanvas.toDataURL('image/png'), 'PNG', doc.internal.pageSize.width - (qrCodeSize * 2) - 25, qrYPos, qrCodeSize, qrCodeSize);
    }
    if (waQrCanvas) {
      doc.addImage(waQrCanvas.toDataURL('image/png'), 'PNG', doc.internal.pageSize.width - qrCodeSize - 15, qrYPos, qrCodeSize, qrCodeSize);
    }

    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
    toast({ title: "Estimate Printing", description: "Estimate PDF sent to print dialog." });
  };

  const handleNewSale = () => {
    setGeneratedInvoice(null);
    clearCart();
    setSelectedCustomerId(undefined);
    if (settings && typeof settings.goldRatePerGram === 'number') {
        setInvoiceGoldRateInput(settings.goldRatePerGram.toString());
    } else {
        setInvoiceGoldRateInput("0");
    }
    setDiscountAmountInput('0');
  }


  if (!appReady) {
    console.log("[GemsTrack] CartPage: App not ready, rendering loading message.");
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading cart...</p>
      </div>
    );
  }

  if (generatedInvoice) {
    console.log("[GemsTrack] CartPage: Rendering generated invoice view.");
    let ratesAppliedMessage = "";
    if (generatedInvoice.goldRateApplied) {
      const goldRate21k = generatedInvoice.goldRateApplied * (21/24);
      ratesAppliedMessage += `Gold Rate (21k): PKR ${goldRate21k.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}/g. `;
    }
    if (generatedInvoice.palladiumRateApplied) ratesAppliedMessage += `Palladium Rate: PKR ${generatedInvoice.palladiumRateApplied.toLocaleString()}/g. `;
    if (generatedInvoice.platinumRateApplied) ratesAppliedMessage += `Platinum Rate: PKR ${generatedInvoice.platinumRateApplied.toLocaleString()}/g.`;

    return (
        <div className="container mx-auto py-8 px-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-2xl">Estimate Generated: {generatedInvoice.id}</CardTitle>
                    <CardDescription>
                        Estimate for {generatedInvoice.customerName || "Walk-in Customer"} created on {new Date(generatedInvoice.createdAt).toLocaleString()}.
                        <br/>
                        {ratesAppliedMessage.trim()}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="mb-4">
                        <h3 className="font-semibold mb-2">Items:</h3>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product &amp; Breakdown</TableHead>
                                    <TableHead className="text-right">Qty</TableHead>
                                    <TableHead className="text-right">Unit Price (PKR)</TableHead>
                                    <TableHead className="text-right">Total (PKR)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {generatedInvoice.items.map(item => {
                                    let breakdownLines = [];
                                    breakdownLines.push(`Metal Cost: ${item.metalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.wastageCost > 0) breakdownLines.push(`+ Wastage (${item.wastagePercentage}%): ${item.wastageCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.makingCharges > 0) breakdownLines.push(`+ Making: ${item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.diamondChargesIfAny > 0) breakdownLines.push(`+ Diamonds: ${item.diamondChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.stoneChargesIfAny > 0) breakdownLines.push(`+ Stones: ${item.stoneChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.miscChargesIfAny > 0) breakdownLines.push(`+ Misc: ${item.miscChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    
                                    const breakdownText = breakdownLines.join(', ');

                                    return (
                                    <TableRow key={item.sku}>
                                        <TableCell>
                                            <p className="font-medium">{item.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                SKU: {item.sku} |
                                                Metal: {item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1)}{item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : ''} |
                                                Wt: {item.metalWeightG.toFixed(2)}g
                                            </p>
                                            {breakdownText && <p className="text-xs text-muted-foreground/80 italic">{breakdownText}</p>}
                                        </TableCell>
                                        <TableCell className="text-right">{item.quantity}</TableCell>
                                        <TableCell className="text-right">{item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                        <TableCell className="text-right">{item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                    </TableRow>
                                );
                            })}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="text-right mt-4 space-y-1">
                        <p>Subtotal: <span className="font-semibold">PKR {generatedInvoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
                        <p>Discount: <span className="font-semibold text-destructive">- PKR {generatedInvoice.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
                        <p className="text-xl font-bold">Grand Total: <span className="text-primary">PKR {generatedInvoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></p>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={handleNewSale}>New Sale / Clear</Button>
                    <Button onClick={() => printInvoice(generatedInvoice)}><Printer className="mr-2 h-4 w-4"/> Print Estimate</Button>
                </CardFooter>
            </Card>
            <div style={{ display: 'none' }}>
                <QRCode id="wa-qr-code" value="https://chat.whatsapp.com/HMeoF0Zcl0i9XobLspaCWl?mode=ac_t" size={128} />
                <QRCode id="insta-qr-code" value="https://www.instagram.com/collectionstaheri?igsh=bWs4YWgydjJ1cXBz&utm_source=qr" size={128} />
            </div>
        </div>
    );
  }

  console.log("[GemsTrack] CartPage: About to return main cart view JSX. appReady:", appReady, "GeneratedInvoice exists:", !!generatedInvoice);
  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-primary">Shopping Cart &amp; Estimate</h1>
        <p className="text-muted-foreground">Review items, set estimate parameters, and generate an estimate.</p>
      </header>

      {cartItemsFromStore.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <ShoppingCart className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">Your Cart is Empty</h3>
            <p className="text-muted-foreground mb-4">Add some products to get started.</p>
            <Link href="/products" passHref><Button>Browse Products</Button></Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Cart Items ({cartItemsFromStore.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] pr-3">
                  <div className="space-y-4">
                    {cartItemsFromStore.map(item => (
                      <div key={item.sku} className="flex items-center space-x-4 p-3 border rounded-md">
                        <Image
                          src={item.imageUrl || `https://placehold.co/80x80.png?text=${encodeURIComponent(item.name?.substring(0,1) || 'P')}`}
                          alt={item.name || 'Product Image'}
                          width={60}
                          height={60}
                          className="rounded-md object-cover border"
                          data-ai-hint="product jewelry"
                        />
                        <div className="flex-grow">
                          <h4 className="font-medium">{item.name}</h4>
                          <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>
                          <p className="text-xs text-muted-foreground">Metal: {item.metalType}{item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : ''}, Wt: {item.metalWeightG.toFixed(2)}g</p>
                           {estimatedInvoice?.items.find(i => i.sku === item.sku)?.unitPrice !== item.totalPrice ? (
                                <>
                                 <p className="text-sm font-semibold text-primary">PKR {estimatedInvoice?.items.find(i => i.sku === item.sku)?.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '...'}</p>
                                 <p className="text-xs text-muted-foreground line-through">PKR {item.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })} (at store rate)</p>
                                </>
                           ) : (
                             <p className="text-sm font-semibold text-primary">PKR {item.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                           )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => updateCartQuantity(item.sku, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                            aria-label={`Decrease quantity of ${item.name}`}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateCartQuantity(item.sku, parseInt(e.target.value) || 1)}
                            className="w-16 h-9 text-center"
                            min="1"
                            aria-label={`Quantity of ${item.name}`}
                          />
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => updateCartQuantity(item.sku, item.quantity + 1)}
                            aria-label={`Increase quantity of ${item.name}`}
                           >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => removeFromCart(item.sku)}
                          aria-label={`Remove ${item.name} from cart`}
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                 <Button variant="outline" onClick={clearCart} className="mt-4 text-destructive hover:text-destructive hover:border-destructive/50">
                    <XCircle className="mr-2 h-4 w-4" /> Clear Cart
                </Button>
              </CardContent>
            </Card>
          </div>

          <div>
            <Card>
              <CardHeader>
                <CardTitle>Order Summary &amp; Estimate Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="customer-select" className="mb-1 block text-sm font-medium">Select Customer (Optional)</Label>
                  <Select
                    value={selectedCustomerId === undefined ? WALK_IN_CUSTOMER_VALUE : selectedCustomerId}
                    onValueChange={(value) => setSelectedCustomerId(value === WALK_IN_CUSTOMER_VALUE ? undefined : value)}
                  >
                    <SelectTrigger id="customer-select">
                      <SelectValue placeholder="Walk-in Customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={WALK_IN_CUSTOMER_VALUE}>Walk-in Customer</SelectItem>
                      {customers.map(customer => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div>
                  <Label htmlFor="invoice-gold-rate" className="flex items-center mb-1 text-sm font-medium">
                    <SettingsIcon className="w-4 h-4 mr-1 text-muted-foreground" /> Gold Rate for this Estimate (PKR/gram, 24k)
                  </Label>
                  <Input
                    id="invoice-gold-rate"
                    type="number"
                    value={invoiceGoldRateInput}
                    onChange={(e) => setInvoiceGoldRateInput(e.target.value)}
                    placeholder="e.g., 20000"
                    className="text-base"
                    step="0.01"
                  />
                   <p className="text-xs text-muted-foreground mt-1">Current store setting for Gold: PKR {(settings?.goldRatePerGram || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}/gram.</p>
                   {cartContainsNonGoldItems && (
                    <Alert variant="default" className="mt-2 text-xs">
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                            Palladium and Platinum items in this cart will be priced using their current rates from store settings (Pd: {(settings?.palladiumRatePerGram || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}, Pt: {(settings?.platinumRatePerGram || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) }).
                        </AlertDescription>
                    </Alert>
                   )}
                </div>
                <div>
                  <Label htmlFor="discount-amount" className="flex items-center mb-1 text-sm font-medium">
                    <Percent className="w-4 h-4 mr-1 text-muted-foreground" /> Discount Amount (PKR)
                  </Label>
                  <Input
                    id="discount-amount"
                    type="number"
                    value={discountAmountInput}
                    onChange={(e) => setDiscountAmountInput(e.target.value)}
                    placeholder="e.g., 500"
                    className="text-base"
                    step="0.01"
                  />
                </div>

                <Separator />
                <div className="space-y-2 p-3 bg-muted/50 rounded-md">
                    <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Subtotal:</span>
                        <span className="font-semibold text-lg">PKR {estimatedInvoice ? estimatedInvoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '...'}</span>
                    </div>
                     <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Discount:</span>
                        <span className="font-semibold text-lg text-destructive">- PKR {(parseFloat(discountAmountInput) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center text-xl font-bold">
                        <span>Grand Total:</span>
                        <span className="text-primary">PKR {estimatedInvoice ? estimatedInvoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '...'}</span>
                    </div>
                </div>
                 <p className="text-xs text-muted-foreground">
                  (Final price is calculated using the rates and discount entered above.)
                </p>
              </CardContent>
              <CardFooter>
                <Button size="lg" className="w-full" onClick={handleGenerateInvoice} disabled={cartItemsFromStore.length === 0 || !estimatedInvoice}>
                  <FileText className="mr-2 h-5 w-5" /> Generate Estimate
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
