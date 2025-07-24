
"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Invoice, Settings } from '@/lib/store';
import { Loader2, FileText, User, Calendar, DollarSign, Percent, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// Re-declare module for jsPDF in this file as well
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

export default function ViewInvoicePage() {
  const params = useParams();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;

    const fetchInvoice = async () => {
      try {
        const invoiceDocRef = doc(db, 'invoices', invoiceId);
        const invoiceDoc = await getDoc(invoiceDocRef);

        if (invoiceDoc.exists()) {
          setInvoice({ id: invoiceDoc.id, ...invoiceDoc.data() } as Invoice);
        } else {
          setError("Invoice not found. The link may be invalid or the invoice may have been deleted.");
        }

        const settingsDocRef = doc(db, 'app_settings', 'global');
        const settingsDoc = await getDoc(settingsDocRef);
        if (settingsDoc.exists()) {
          setSettings(settingsDoc.data() as Settings);
        }

      } catch (err) {
        console.error("Error fetching invoice:", err);
        setError("An error occurred while trying to load the invoice.");
      } finally {
        setLoading(false);
      }
    };

    fetchInvoice();
  }, [invoiceId]);
  
  const handlePrint = () => {
    if (!invoice || !settings) return;
    const doc = new jsPDF();
    // Simplified print logic for brevity. Can be expanded to be identical to the main app's print function.
    doc.setFontSize(20);
    doc.text(`${settings.shopName} - Estimate`, 15, 20);
    doc.setFontSize(12);
    doc.text(`Estimate ID: ${invoice.id}`, 15, 30);
    doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString()}`, 15, 36);
    doc.text(`Customer: ${invoice.customerName || 'Walk-in Customer'}`, 15, 42);

    (doc as any).autoTable({
        startY: 50,
        head: [['Item', 'Qty', 'Unit Price', 'Total']],
        body: invoice.items.map(item => [
            item.name,
            item.quantity,
            item.unitPrice.toLocaleString(undefined, {minimumFractionDigits: 2}),
            item.itemTotal.toLocaleString(undefined, {minimumFractionDigits: 2})
        ]),
    });
    
    const finalY = (doc as any).lastAutoTable.finalY || 150;
    doc.text(`Subtotal: PKR ${invoice.subtotal.toLocaleString()}`, 15, finalY + 10);
    doc.text(`Discount: -PKR ${invoice.discountAmount.toLocaleString()}`, 15, finalY + 16);
    doc.setFontSize(14);
    doc.text(`Grand Total: PKR ${invoice.grandTotal.toLocaleString()}`, 15, finalY + 24);
    doc.save(`Estimate-${invoice.id}.pdf`);
  }

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-muted">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-destructive/10 p-4">
        <Card className="w-full max-w-lg border-destructive">
            <CardHeader>
                <CardTitle className="text-destructive">Error</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-destructive-foreground">{error}</p>
            </CardContent>
        </Card>
      </div>
    );
  }

  if (!invoice) return null;

  return (
    <div className="bg-muted min-h-screen p-4 sm:p-8">
        <Card className="max-w-4xl mx-auto shadow-2xl">
            <CardHeader>
                 <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-primary">{settings?.shopName || 'Estimate'}</h1>
                        <p className="text-muted-foreground">Estimate #{invoice.id}</p>
                    </div>
                     <Button onClick={handlePrint}>
                        <Download className="mr-2 h-4 w-4" /> Download PDF
                    </Button>
                </div>
                <Separator className="my-4" />
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <div>
                            <p className="text-muted-foreground">Bill To</p>
                            <p className="font-semibold">{invoice.customerName || 'Walk-in Customer'}</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-muted-foreground" />
                        <div>
                            <p className="text-muted-foreground">Date Issued</p>
                            <p className="font-semibold">{new Date(invoice.createdAt).toLocaleDateString()}</p>
                        </div>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Description</TableHead>
                            <TableHead className="text-right">Quantity</TableHead>
                            <TableHead className="text-right">Unit Price</TableHead>
                            <TableHead className="text-right">Amount</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {invoice.items.map(item => (
                            <TableRow key={item.sku}>
                                <TableCell>
                                    <p className="font-medium">{item.name}</p>
                                    <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>
                                </TableCell>
                                <TableCell className="text-right">{item.quantity}</TableCell>
                                <TableCell className="text-right">PKR {item.unitPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                                <TableCell className="text-right">PKR {item.itemTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
                <Separator className="my-6"/>
                <div className="flex justify-end">
                    <div className="w-full max-w-sm space-y-2">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Subtotal</span>
                            <span>PKR {invoice.subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                         <div className="flex justify-between">
                            <span className="text-muted-foreground">Discount</span>
                            <span>- PKR {invoice.discountAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                        <Separator />
                         <div className="flex justify-between font-bold text-lg">
                            <span className="text-primary">Grand Total</span>
                            <span className="text-primary">PKR {invoice.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
         <footer className="text-center mt-8 text-sm text-muted-foreground">
            <p>Thank you for your business!</p>
            {settings?.shopContact && <p>{settings.shopContact}</p>}
        </footer>
    </div>
  );
}

