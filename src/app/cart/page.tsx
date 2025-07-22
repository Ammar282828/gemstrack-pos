
"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAppStore, selectCartDetails, selectCartSubtotal, Customer, Settings, InvoiceItem, Invoice as InvoiceType, calculateProductCosts, useAppReady } from '@/lib/store';
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


declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const WALK_IN_CUSTOMER_VALUE = "__WALK_IN__";

export default function CartPage() {
  console.log("[GemsTrack] CartPage: Rendering START");
  const { toast } = useToast();

  const appReady = useAppReady();
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal);
  const customers = useAppStore(state => state.customers);
  const settings = useAppStore(state => state.settings);
  const { updateCartQuantity, removeFromCart, clearCart, generateInvoice: generateInvoiceAction } = useAppStore();
  const products = useAppStore(state => state.products); // Needed for invoice generation logic

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);
  const [generatedInvoice, setGeneratedInvoice] = useState<InvoiceType | null>(null);

  const [invoiceGoldRateInput, setInvoiceGoldRateInput] = useState<string>('');
  const [discountAmountInput, setDiscountAmountInput] = useState<string>('0');

  useEffect(() => {
    if (appReady && settings && typeof settings.goldRatePerGram === 'number') {
      setInvoiceGoldRateInput(settings.goldRatePerGram.toString());
    } else if (appReady) {
      console.warn("[GemsTrack] CartPage: Could not set initial invoiceGoldRateInput because settings or goldRatePerGram was missing/invalid.", settings);
      setInvoiceGoldRateInput("0"); // Fallback to 0 if settings are not ready
    }
  }, [appReady, settings]);

  const cartContainsNonGoldItems = cartItems.some(item => item.metalType !== 'gold');


  const handleGenerateInvoice = async () => {
    if (cartItems.length === 0) {
      toast({ title: "Cart Empty", description: "Cannot generate invoice for an empty cart.", variant: "destructive" });
      return;
    }

    const parsedGoldRate = parseFloat(invoiceGoldRateInput);
    const hasGoldItems = cartItems.some(item => item.metalType === 'gold');
    if (hasGoldItems && (isNaN(parsedGoldRate) || parsedGoldRate <= 0)) {
      toast({ title: "Invalid Gold Rate", description: "Please enter a valid positive gold rate for gold items.", variant: "destructive" });
      return;
    }

    const parsedDiscountAmount = parseFloat(discountAmountInput) || 0;
    if (parsedDiscountAmount < 0) {
      toast({ title: "Invalid Discount", description: "Discount amount cannot be negative.", variant: "destructive" });
      return;
    }

    let currentSubtotalForValidation = 0;
    cartItems.forEach(item => {
        const productFromStore = products.find(p => p.sku === item.sku);
        if (productFromStore) {
            const ratesForCalc = {
                goldRatePerGram24k: item.metalType === 'gold' ? parsedGoldRate : (settings?.goldRatePerGram || 0),
                palladiumRatePerGram: settings?.palladiumRatePerGram || 0,
                platinumRatePerGram: settings?.platinumRatePerGram || 0,
            };
            const costs = calculateProductCosts(productFromStore, ratesForCalc);
            currentSubtotalForValidation += costs.totalPrice * item.quantity;
        }
    });

    if (parsedDiscountAmount > currentSubtotalForValidation) {
        toast({ title: "Invalid Discount", description: "Discount cannot be greater than the subtotal.", variant: "destructive" });
        return;
    }

    const invoice = await generateInvoiceAction(selectedCustomerId, parsedGoldRate, parsedDiscountAmount);
    if (invoice) {
      setGeneratedInvoice(invoice);
      toast({ title: "Invoice Generated", description: `Invoice ${invoice.id} created successfully.` });
    } else {
      toast({ title: "Invoice Generation Failed", description: "Could not generate the invoice. Please check inputs.", variant: "destructive" });
    }
  };

  const printInvoice = (invoiceToPrint: InvoiceType) => {
    const doc = new jsPDF();
    
    // Logo
    if (settings.shopLogoUrl) {
        try {
            // Using a placeholder or a default image for PDF generation
            // as direct SVG rendering can be complex in jsPDF without extra libraries.
            // For a real app, you might use a PNG version of the logo here.
            doc.addImage(settings.shopLogoUrl, 'PNG', 15, 12, 50, 12.5);
        } catch(e) { console.error("Error adding image to PDF:", e) }
    }

    // Shop Info
    doc.setFontSize(18);
    doc.text(settings.shopName, 15, 32);
    doc.setFontSize(10);
    doc.text(settings.shopAddress, 15, 39);
    doc.text(settings.shopContact, 15, 44);

    // Invoice Info
    doc.setFontSize(22);
    doc.text('INVOICE', 140, 15);
    doc.setFontSize(12);
    doc.text(`Invoice #: ${invoiceToPrint.id}`, 140, 22);
    doc.text(`Date: ${new Date(invoiceToPrint.createdAt).toLocaleDateString()}`, 140, 27);

    // Metal Rates
    let rateYPos = 32;
    if (invoiceToPrint.goldRateApplied) {
        doc.text(`Gold Rate: PKR ${invoiceToPrint.goldRateApplied.toLocaleString()}/g (24k)`, 140, rateYPos);
        rateYPos += 5;
    }
    if (invoiceToPrint.palladiumRateApplied) {
        doc.text(`Palladium Rate: PKR ${invoiceToPrint.palladiumRateApplied.toLocaleString()}/g`, 140, rateYPos);
        rateYPos += 5;
    }
    if (invoiceToPrint.platinumRateApplied) {
        doc.text(`Platinum Rate: PKR ${invoiceToPrint.platinumRateApplied.toLocaleString()}/g`, 140, rateYPos);
    }

    // Customer Info
    if (invoiceToPrint.customerId) {
      const customer = customers.find(c => c.id === invoiceToPrint.customerId);
      if (customer) {
        doc.setFontSize(12);
        doc.text('Bill To:', 15, 52);
        doc.setFontSize(10);
        doc.text(customer.name, 15, 57);
        if(customer.address) doc.text(customer.address, 15, 62);
        if(customer.phone) doc.text(`Phone: ${customer.phone}`, 15, 67);
        if(customer.email) doc.text(`Email: ${customer.email}`, 15, 72);
      }
    } else {
        doc.setFontSize(12);
        doc.text('Bill To:', 15, 52);
        doc.setFontSize(10);
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
      if (item.metalCost > 0) breakdownLines.push(`  Metal Cost: ${item.metalCost.toLocaleString()}`);
      if (item.wastageCost > 0) breakdownLines.push(`  Wastage Cost: ${item.wastageCost.toLocaleString()}`);
      if (item.makingCharges > 0) breakdownLines.push(`  Making Charges: ${item.makingCharges.toLocaleString()}`);
      if (item.diamondChargesIfAny > 0) breakdownLines.push(`  Diamonds: ${item.diamondChargesIfAny.toLocaleString()}`);
      if (item.stoneChargesIfAny > 0) breakdownLines.push(`  Stones: ${item.stoneChargesIfAny.toLocaleString()}`);
      if (item.miscChargesIfAny > 0) breakdownLines.push(`  Misc: ${item.miscChargesIfAny.toLocaleString()}`);

      const breakdown = breakdownLines.join('\n');

      const itemDescription = `${item.name} (SKU: ${item.sku})\nMetal: ${metalDisplay}, Wt: ${item.metalWeightG.toFixed(2)}g\n${breakdown ? breakdown : ''}`;

      const itemData = [
        index + 1,
        itemDescription.trim(),
        item.quantity,
        item.unitPrice.toLocaleString(),
        item.itemTotal.toLocaleString(),
      ];
      tableRows.push(itemData);
    });

    doc.autoTable({
      head: [tableColumn],
      body: tableRows,
      startY: 80,
      theme: 'grid',
      headStyles: { fillColor: [75, 0, 130] },
      styles: { fontSize: 8, cellPadding: 1.5, overflow: 'linebreak' },
      columnStyles: {
        1: { cellWidth: 'auto' },
      },
      didParseCell: function (data: any) {
        // Potentially adjust row height if content is multi-line, autoTable usually handles this.
      }
    });

    // Totals Section
    const finalY = (doc as any).lastAutoTable.finalY || 100;
    let currentY = finalY + 10;
    doc.setFontSize(10);
    doc.text(`Subtotal:`, 140, currentY);
    doc.text(`PKR ${invoiceToPrint.subtotal.toLocaleString()}`, 170, currentY);

    currentY += 6;
    doc.text(`Discount:`, 140, currentY);
    doc.text(`PKR ${invoiceToPrint.discountAmount.toLocaleString()}`, 170, currentY);

    currentY += 8;
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`Grand Total:`, 140, currentY);
    doc.text(`PKR ${invoiceToPrint.grandTotal.toLocaleString()}`, 170, currentY);

    doc.setFontSize(8);
    doc.text("Thank you for your business!", 15, doc.internal.pageSize.height - 10);

    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
    toast({ title: "Invoice Printing", description: "Invoice PDF sent to print dialog." });
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
    if (generatedInvoice.goldRateApplied) ratesAppliedMessage += `Gold Rate: PKR ${generatedInvoice.goldRateApplied.toLocaleString()}/g. `;
    if (generatedInvoice.palladiumRateApplied) ratesAppliedMessage += `Palladium Rate: PKR ${generatedInvoice.palladiumRateApplied.toLocaleString()}/g. `;
    if (generatedInvoice.platinumRateApplied) ratesAppliedMessage += `Platinum Rate: PKR ${generatedInvoice.platinumRateApplied.toLocaleString()}/g.`;

    return (
        <div className="container mx-auto py-8 px-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-2xl">Invoice Generated: {generatedInvoice.id}</CardTitle>
                    <CardDescription>
                        Invoice for {generatedInvoice.customerName || "Walk-in Customer"} created on {new Date(generatedInvoice.createdAt).toLocaleString()}.
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
                                    if (item.metalCost > 0) breakdownLines.push(`Metal Cost: ${item.metalCost.toLocaleString()}`);
                                    if (item.wastageCost > 0) breakdownLines.push(`Wastage Cost: ${item.wastageCost.toLocaleString()}`);
                                    if (item.makingCharges > 0) breakdownLines.push(`Making Charges: ${item.makingCharges.toLocaleString()}`);
                                    if (item.diamondChargesIfAny > 0) breakdownLines.push(`Diamonds: ${item.diamondChargesIfAny.toLocaleString()}`);
                                    if (item.stoneChargesIfAny > 0) breakdownLines.push(`Stones: ${item.stoneChargesIfAny.toLocaleString()}`);
                                    if (item.miscChargesIfAny > 0) breakdownLines.push(`Misc: ${item.miscChargesIfAny.toLocaleString()}`);
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
                                        <TableCell className="text-right">{item.unitPrice.toLocaleString()}</TableCell>
                                        <TableCell className="text-right">{item.itemTotal.toLocaleString()}</TableCell>
                                    </TableRow>
                                );
                            })}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="text-right mt-4 space-y-1">
                        <p>Subtotal: <span className="font-semibold">PKR {generatedInvoice.subtotal.toLocaleString()}</span></p>
                        <p>Discount: <span className="font-semibold text-destructive">- PKR {generatedInvoice.discountAmount.toLocaleString()}</span></p>
                        <p className="text-xl font-bold">Grand Total: <span className="text-primary">PKR {generatedInvoice.grandTotal.toLocaleString()}</span></p>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={handleNewSale}>New Sale / Clear</Button>
                    <Button onClick={() => printInvoice(generatedInvoice)}><Printer className="mr-2 h-4 w-4"/> Print Invoice</Button>
                </CardFooter>
            </Card>
        </div>
    );
  }

  console.log("[GemsTrack] CartPage: About to return main cart view JSX. appReady:", appReady, "GeneratedInvoice exists:", !!generatedInvoice);
  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-primary">Shopping Cart &amp; Invoice</h1>
        <p className="text-muted-foreground">Review items, set invoice parameters, and generate an invoice.</p>
      </header>

      {cartItems.length === 0 ? (
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
                <CardTitle>Cart Items ({cartItems.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[400px] pr-3">
                  <div className="space-y-4">
                    {cartItems.map(item => (
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
                          <p className="text-sm font-semibold text-primary">PKR {item.totalPrice.toLocaleString()} (at current store rates)</p>
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
                <CardTitle>Order Summary &amp; Invoice Details</CardTitle>
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
                    <SettingsIcon className="w-4 h-4 mr-1 text-muted-foreground" /> Gold Rate for this Invoice (PKR/gram, 24k)
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
                   <p className="text-xs text-muted-foreground mt-1">Current store setting for Gold: PKR {(settings?.goldRatePerGram || 0).toLocaleString()}/gram.</p>
                   {cartContainsNonGoldItems && (
                    <Alert variant="default" className="mt-2 text-xs">
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                            Palladium and Platinum items in this cart will be priced using their current rates from store settings (Pd: {(settings?.palladiumRatePerGram || 0).toLocaleString()}, Pt: {(settings?.platinumRatePerGram || 0).toLocaleString()}).
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
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Cart Subtotal (est.):</span>
                  <span className="font-semibold text-lg">PKR {cartSubtotal.toLocaleString()}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  (Estimated using current store metal rates. Final invoice will use the Gold rate entered above for gold items, and store rates for Palladium/Platinum.)
                </p>
                <Separator />
                <div className="flex justify-between items-center text-xl font-bold">
                  <span>Grand Total (est.):</span>
                  <span className="text-primary">PKR {(cartSubtotal - (parseFloat(discountAmountInput) || 0)).toLocaleString()}</span>
                </div>
              </CardContent>
              <CardFooter>
                <Button size="lg" className="w-full" onClick={handleGenerateInvoice} disabled={cartItems.length === 0}>
                  <FileText className="mr-2 h-5 w-5" /> Generate Invoice
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

    