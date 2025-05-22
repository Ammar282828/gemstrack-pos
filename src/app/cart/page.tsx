"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { useAppStore, selectCartDetails, selectCartSubtotal, Customer, Product, Settings, InvoiceItem, Invoice as InvoiceType } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Plus, Minus, IndianRupee, ShoppingCart, FileText, Printer, User, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import 'jspdf-autotable'; // For table generation
import { useIsStoreHydrated } from '@/lib/store';

// Extend jsPDF with autoTable typings
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

export default function CartPage() {
  const { toast } = useToast();
  
  const isHydrated = useIsStoreHydrated();
  const cartItems = useAppStore(selectCartDetails);
  const cartSubtotal = useAppStore(selectCartSubtotal);
  const customers = useAppStore(state => state.customers);
  const settings = useAppStore(state => state.settings);
  const { updateCartQuantity, removeFromCart, clearCart, generateInvoice: generateInvoiceAction } = useAppStore();

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);
  const [generatedInvoice, setGeneratedInvoice] = useState<InvoiceType | null>(null);


  const handleQuantityChange = (sku: string, newQuantity: number) => {
    updateCartQuantity(sku, newQuantity);
  };

  const handleGenerateInvoice = () => {
    const invoice = generateInvoiceAction(selectedCustomerId);
    if (invoice) {
      setGeneratedInvoice(invoice);
      toast({ title: "Invoice Generated", description: `Invoice ${invoice.id} created successfully.` });
    } else {
      toast({ title: "Cart Empty", description: "Cannot generate invoice for an empty cart.", variant: "destructive" });
    }
  };
  
  const printInvoice = (invoiceToPrint: InvoiceType) => {
    const doc = new jsPDF();

    // Shop Logo and Name
    if (settings.shopLogoUrl) {
      try {
        // This is a simplified approach. For robust solution, ensure image is loaded first or use base64.
        // For now, assuming URL is directly usable or placeholder.
        // doc.addImage(settings.shopLogoUrl, 'PNG', 15, 10, 30, 10); // Adjust as needed
      } catch (e) { console.error("Error adding logo to PDF:", e); }
    }
    doc.setFontSize(18);
    doc.text(settings.shopName, 15, 15); // Adjust X if logo is present
    doc.setFontSize(10);
    doc.text(settings.shopAddress, 15, 22);
    doc.text(settings.shopContact, 15, 27);

    // Invoice Title
    doc.setFontSize(22);
    doc.text('INVOICE', 140, 15);
    doc.setFontSize(12);
    doc.text(`Invoice #: ${invoiceToPrint.id}`, 140, 22);
    doc.text(`Date: ${new Date(invoiceToPrint.createdAt).toLocaleDateString()}`, 140, 27);

    // Customer Info
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
    
    // Table
    const tableColumn = ["#", "Item", "SKU", "Qty", "Unit Price", "Total"];
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
      headStyles: { fillColor: [75, 0, 130] }, // Deep Indigo
      styles: { fontSize: 8 },
    });

    // Totals
    const finalY = (doc as any).lastAutoTable.finalY || 100; // Get Y pos after table
    doc.setFontSize(10);
    doc.text(`Subtotal:`, 140, finalY + 10);
    doc.text(`₹${invoiceToPrint.subtotal.toLocaleString()}`, 170, finalY + 10);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`Grand Total:`, 140, finalY + 18);
    doc.text(`₹${invoiceToPrint.grandTotal.toLocaleString()}`, 170, finalY + 18);
    
    // Footer
    doc.setFontSize(8);
    doc.text("Thank you for your business!", 15, doc.internal.pageSize.height - 10);

    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
    toast({ title: "Invoice Printing", description: "Invoice PDF sent to print dialog." });
  };


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
                                    <TableHead className="text-right">Unit Price</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {generatedInvoice.items.map(item => (
                                    <TableRow key={item.sku}>
                                        <TableCell>{item.name}</TableCell>
                                        <TableCell>{item.sku}</TableCell>
                                        <TableCell className="text-right">{item.quantity}</TableCell>
                                        <TableCell className="text-right">₹{item.unitPrice.toLocaleString()}</TableCell>
                                        <TableCell className="text-right">₹{item.itemTotal.toLocaleString()}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="text-right mt-4">
                        <p>Subtotal: <span className="font-semibold">₹{generatedInvoice.subtotal.toLocaleString()}</span></p>
                        <p className="text-xl font-bold">Grand Total: <span className="text-primary">₹{generatedInvoice.grandTotal.toLocaleString()}</span></p>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setGeneratedInvoice(null)}>New Sale / Clear</Button>
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
        <p className="text-muted-foreground">Review items and generate an invoice.</p>
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
                <ScrollArea className="h-[400px] pr-3"> {/* Added pr-3 for scrollbar space */}
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
                          <p className="text-sm font-semibold text-primary">₹{item.totalPrice.toLocaleString()}</p>
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
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="customer-select" className="mb-1 block text-sm font-medium">Select Customer (Optional)</Label>
                  <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                    <SelectTrigger id="customer-select">
                      <SelectValue placeholder="Walk-in Customer" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Walk-in Customer</SelectItem>
                      {customers.map(customer => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Subtotal:</span>
                  <span className="font-semibold text-lg">₹{cartSubtotal.toLocaleString()}</span>
                </div>
                {/* Add Tax/Discount fields here if needed */}
                <Separator />
                <div className="flex justify-between items-center text-xl font-bold">
                  <span>Grand Total:</span>
                  <span className="text-primary">₹{cartSubtotal.toLocaleString()}</span>
                </div>
              </CardContent>
              <CardFooter>
                <Button size="lg" className="w-full" onClick={handleGenerateInvoice}>
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
