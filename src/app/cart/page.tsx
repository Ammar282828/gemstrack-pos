
"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link'; 
import { useAppStore, selectCartDetails, selectCartSubtotal, Customer, Settings, InvoiceItem, Invoice as InvoiceType } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Plus, Minus, ShoppingCart, FileText, Printer, User, XCircle, Settings as SettingsIcon, Percent } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import 'jspdf-autotable'; // For table generation
import { useIsStoreHydrated } from '@/lib/store';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';

// Extend jsPDF with autoTable typings
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

const WALK_IN_CUSTOMER_VALUE = "__WALK_IN__";

export default function CartPage() {
  const { toast } = useToast();
  
  const isHydrated = useIsStoreHydrated();
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal); // This subtotal is based on settings gold rate
  const customers = useAppStore(state => state.customers);
  const settings = useAppStore(state => state.settings);
  const { updateCartQuantity, removeFromCart, clearCart, generateInvoice: generateInvoiceAction } = useAppStore();

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);
  const [generatedInvoice, setGeneratedInvoice] = useState<InvoiceType | null>(null);
  
  // State for dynamic gold rate and discount for the current invoice
  const [invoiceGoldRateInput, setInvoiceGoldRateInput] = useState<string>('');
  const [discountAmountInput, setDiscountAmountInput] = useState<string>('0');

  useEffect(() => {
    if (isHydrated) {
        setInvoiceGoldRateInput(settings.goldRatePerGram.toString());
    }
  }, [isHydrated, settings.goldRatePerGram]);


  const handleQuantityChange = (sku: string, newQuantity: number) => {
    updateCartQuantity(sku, newQuantity);
  };

  const handleGenerateInvoice = () => {
    if (cartItems.length === 0) {
      toast({ title: "Cart Empty", description: "Cannot generate invoice for an empty cart.", variant: "destructive" });
      return;
    }

    const parsedGoldRate = parseFloat(invoiceGoldRateInput);
    if (isNaN(parsedGoldRate) || parsedGoldRate <= 0) {
      toast({ title: "Invalid Gold Rate", description: "Please enter a valid positive gold rate.", variant: "destructive" });
      return;
    }

    const parsedDiscountAmount = parseFloat(discountAmountInput) || 0;
    if (parsedDiscountAmount < 0) {
      toast({ title: "Invalid Discount", description: "Discount amount cannot be negative.", variant: "destructive" });
      return;
    }

    // Calculate subtotal based on the dynamic gold rate for validation, though store will recalculate
    let currentSubtotalForValidation = 0;
    cartItems.forEach(item => {
        const product = useAppStore.getState().products.find(p => p.sku === item.sku);
        if (product) {
            const costs = useAppStore.getState().calculateProductCosts(product, parsedGoldRate);
            currentSubtotalForValidation += costs.totalPrice * item.quantity;
        }
    });

    if (parsedDiscountAmount > currentSubtotalForValidation) {
        toast({ title: "Invalid Discount", description: "Discount cannot be greater than the subtotal.", variant: "destructive" });
        return;
    }
    
    const invoice = generateInvoiceAction(selectedCustomerId, parsedGoldRate, parsedDiscountAmount);
    if (invoice) {
      setGeneratedInvoice(invoice);
      toast({ title: "Invoice Generated", description: `Invoice ${invoice.id} created successfully.` });
    } else {
      // This case might be hit if generateInvoiceAction itself returns null for other reasons (e.g. internal validation)
      toast({ title: "Invoice Generation Failed", description: "Could not generate the invoice. Please check inputs.", variant: "destructive" });
    }
  };
  
  const printInvoice = (invoiceToPrint: InvoiceType) => {
    const doc = new jsPDF();

    if (settings.shopLogoUrl) {
      try {
        // Note: External image URLs in jsPDF often require CORS or preloading to base64
        // doc.addImage(settings.shopLogoUrl, 'PNG', 15, 10, 30, 10); 
      } catch (e) { console.error("Error adding logo to PDF:", e); }
    }
    doc.setFontSize(18);
    doc.text(settings.shopName, 15, 15);
    doc.setFontSize(10);
    doc.text(settings.shopAddress, 15, 22);
    doc.text(settings.shopContact, 15, 27);

    doc.setFontSize(22);
    doc.text('INVOICE', 140, 15);
    doc.setFontSize(12);
    doc.text(`Invoice #: ${invoiceToPrint.id}`, 140, 22);
    doc.text(`Date: ${new Date(invoiceToPrint.createdAt).toLocaleDateString()}`, 140, 27);
    doc.text(`Gold Rate: PKR ${invoiceToPrint.goldRateApplied.toLocaleString()}/g`, 140, 32);


    if (invoiceToPrint.customerId) {
      const customer = customers.find(c => c.id === invoiceToPrint.customerId);
      if (customer) {
        doc.setFontSize(12);
        doc.text('Bill To:', 15, 40);
        doc.setFontSize(10);
        doc.text(customer.name, 15, 45);
        if(customer.address) doc.text(customer.address, 15, 50);
        if(customer.phone) doc.text(`Phone: ${customer.phone}`, 15, 55);
        if(customer.email) doc.text(`Email: ${customer.email}`, 15, 60);
      }
    }
    
    const tableColumn = ["#", "Item", "SKU", "Qty", "Unit Price (PKR)", "Total (PKR)"];
    const tableRows: any[][] = [];
    invoiceToPrint.items.forEach((item, index) => {
      const itemData = [
        index + 1,
        item.name,
        item.sku,
        item.quantity,
        item.unitPrice.toLocaleString(),
        item.itemTotal.toLocaleString(),
      ];
      tableRows.push(itemData);
    });

    doc.autoTable({
      head: [tableColumn],
      body: tableRows,
      startY: 70,
      theme: 'grid',
      headStyles: { fillColor: [75, 0, 130] }, 
      styles: { fontSize: 8 },
    });

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
    setInvoiceGoldRateInput(settings.goldRatePerGram.toString());
    setDiscountAmountInput('0');
  }


  if (!isHydrated) {
    return (
      <div className="container mx-auto py-8 px-4">
        <p className="text-center text-muted-foreground">Loading cart...</p>
      </div>
    );
  }
  
  if (generatedInvoice) {
    return (
        <div className="container mx-auto py-8 px-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-2xl">Invoice Generated: {generatedInvoice.id}</CardTitle>
                    <CardDescription>
                        Invoice for {generatedInvoice.customerName || "Walk-in Customer"} created on {new Date(generatedInvoice.createdAt).toLocaleString()}.
                        <br/>
                        Gold Rate Applied: PKR {generatedInvoice.goldRateApplied.toLocaleString()}/gram
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="mb-4">
                        <h3 className="font-semibold mb-2">Items:</h3>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead>SKU</TableHead>
                                    <TableHead className="text-right">Qty</TableHead>
                                    <TableHead className="text-right">Unit Price (PKR)</TableHead>
                                    <TableHead className="text-right">Total (PKR)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {generatedInvoice.items.map(item => (
                                    <TableRow key={item.sku}>
                                        <TableCell>{item.name}</TableCell>
                                        <TableCell>{item.sku}</TableCell>
                                        <TableCell className="text-right">{item.quantity}</TableCell>
                                        <TableCell className="text-right">{item.unitPrice.toLocaleString()}</TableCell>
                                        <TableCell className="text-right">{item.itemTotal.toLocaleString()}</TableCell>
                                    </TableRow>
                                ))}
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


  return (
    <div className="container mx-auto py-8 px-4">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-primary">Shopping Cart & Invoice</h1>
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
                          src={item.imageUrl || `https://placehold.co/80x80.png?text=${item.name.substring(0,1)}`}
                          alt={item.name}
                          width={60}
                          height={60}
                          className="rounded-md object-cover border"
                          data-ai-hint="product jewelry"
                        />
                        <div className="flex-grow">
                          <h4 className="font-medium">{item.name}</h4>
                          <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>
                          <p className="text-sm font-semibold text-primary">PKR {item.totalPrice.toLocaleString()} (at current gold rate)</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button size="icon" variant="outline" onClick={() => handleQuantityChange(item.sku, item.quantity - 1)} disabled={item.quantity <= 1}>
                            <Minus className="h-4 w-4" />
                          </Button>
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => handleQuantityChange(item.sku, parseInt(e.target.value) || 1)}
                            className="w-16 h-9 text-center"
                            min="1"
                          />
                          <Button size="icon" variant="outline" onClick={() => handleQuantityChange(item.sku, item.quantity + 1)}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                        <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => removeFromCart(item.sku)}>
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
                <CardTitle>Order Summary & Invoice Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="customer-select" className="mb-1 block text-sm font-medium">Select Customer (Optional)</Label>
                  <Select 
                    value={selectedCustomerId} 
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
                    <SettingsIcon className="w-4 h-4 mr-1 text-muted-foreground" /> Gold Rate for this Invoice (PKR/gram)
                  </Label>
                  <Input
                    id="invoice-gold-rate"
                    type="number"
                    value={invoiceGoldRateInput}
                    onChange={(e) => setInvoiceGoldRateInput(e.target.value)}
                    placeholder="e.g., 20000"
                    className="text-base"
                  />
                   <p className="text-xs text-muted-foreground mt-1">Current store setting: PKR {settings.goldRatePerGram.toLocaleString()}/gram</p>
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
                  />
                </div>

                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Cart Subtotal (est.):</span>
                  <span className="font-semibold text-lg">PKR {cartSubtotal.toLocaleString()}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  (Estimated using current store gold rate. Final invoice will use the rate entered above.)
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
