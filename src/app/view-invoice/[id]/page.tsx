

"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Invoice, Settings, Customer, InvoiceItem } from '@/lib/store';
import { Loader2, Download, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

// Re-declare module for jsPDF in this file as well
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: {
      finalY?: number;
    };
  }
}

export default function ViewInvoicePage() {
  const params = useParams();
  const invoiceId = params.id as string;

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;

    const fetchInvoiceData = async () => {
      try {
        // Fetch Invoice
        const invoiceDocRef = doc(db, 'invoices', invoiceId);
        const invoiceDoc = await getDoc(invoiceDocRef);

        if (invoiceDoc.exists()) {
          const fetchedInvoice = { id: invoiceDoc.id, ...invoiceDoc.data() } as Invoice;
          setInvoice(fetchedInvoice);

          // Fetch Customer if customerId exists
          if (fetchedInvoice.customerId) {
            const customerDocRef = doc(db, 'customers', fetchedInvoice.customerId);
            const customerDoc = await getDoc(customerDocRef);
            if (customerDoc.exists()) {
              setCustomer({ id: customerDoc.id, ...customerDoc.data() } as Customer);
            }
          }
        } else {
          setError("Invoice not found. The link may be invalid or the invoice may have been deleted.");
        }

        // Fetch Settings
        const settingsDocRef = doc(db, 'app_settings', 'global');
        const settingsDoc = await getDoc(settingsDocRef);
        if (settingsDoc.exists()) {
          setSettings(settingsDoc.data() as Settings);
        }

      } catch (err) {
        console.error("Error fetching invoice data:", err);
        setError("An error occurred while trying to load the invoice.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvoiceData();
  }, [invoiceId]);
  
  const handlePrint = () => {
    if (!invoice || !settings) return;
    
    const pdfDoc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a5'
    });
    const pageHeight = pdfDoc.internal.pageSize.getHeight();
    const pageWidth = pdfDoc.internal.pageSize.getWidth();
    const margin = 10;
    
    const logoToUse = settings.shopLogoUrlBlack || settings.shopLogoUrl;


    function drawHeader(pageNum: number) {
        if (logoToUse) {
            try {
                 pdfDoc.addImage(logoToUse, 'PNG', margin, 10, 35, 8, undefined, 'FAST');
            } catch (e) {
                 console.error("Error adding logo to PDF:", e);
            }
        }
        
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(18);
        pdfDoc.text('ESTIMATE', pageWidth - margin, 15, { align: 'right' });
        
        pdfDoc.setLineWidth(0.5);
        pdfDoc.line(margin, 25, pageWidth - margin, 25);

        if (pageNum > 1) {
            pdfDoc.setFontSize(8);
            pdfDoc.setTextColor(150);
            pdfDoc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 5, {align: 'right'});
        }
    }
    
    drawHeader(1);
    
    let infoY = 32;
    pdfDoc.setFontSize(9);
    pdfDoc.setTextColor(100);
    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.text('BILL TO:', margin, infoY);
    pdfDoc.text('INVOICE DETAILS:', pageWidth / 2, infoY);

    pdfDoc.setLineWidth(0.2);
    pdfDoc.line(margin, infoY + 2, pageWidth - margin, infoY + 2);

    infoY += 7;
    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.setTextColor(0);
    pdfDoc.setFontSize(9);

    let customerInfo = "Walk-in Customer";
    if (customer) {
        customerInfo = `${customer.name}\n`;
        if (customer.address) customerInfo += `${customer.address}\n`;
        if (customer.phone) customerInfo += `Phone: ${customer.phone}\n`;
        if (customer.email) customerInfo += `Email: ${customer.email}`;
    } else if (invoice.customerName) {
        customerInfo = invoice.customerName;
    }
    pdfDoc.text(customerInfo, margin, infoY, { lineHeightFactor: 1.4 });

    let invoiceDetails = `Estimate #: ${invoice.id}\n`;
    invoiceDetails += `Date: ${new Date(invoice.createdAt).toLocaleDateString()}`;
    pdfDoc.text(invoiceDetails, pageWidth / 2, infoY, { lineHeightFactor: 1.4 });
    
    const rates = invoice.ratesApplied;
    let ratesApplied: string[] = [];
    if (rates.goldRatePerGram24k) ratesApplied.push(`24k: ${rates.goldRatePerGram24k.toLocaleString()}/g`);
    if (rates.goldRatePerGram22k) ratesApplied.push(`22k: ${rates.goldRatePerGram22k.toLocaleString()}/g`);
    if (rates.goldRatePerGram21k) ratesApplied.push(`21k: ${rates.goldRatePerGram21k.toLocaleString()}/g`);
    if (rates.goldRatePerGram18k) ratesApplied.push(`18k: ${rates.goldRatePerGram18k.toLocaleString()}/g`);
    
    if (ratesApplied.length > 0) {
        pdfDoc.setFontSize(7);
        pdfDoc.setTextColor(150);
        pdfDoc.text(ratesApplied.join(' | '), pageWidth / 2, infoY + 10, { lineHeightFactor: 1.4 });
    }
    
    const tableStartY = infoY + 20;
    const tableColumn = ["#", "Product & Breakdown", "Qty", "Unit", "Total"];
    const tableRows: any[][] = [];

    const itemsToPrint = Array.isArray(invoice.items) ? invoice.items : Object.values(invoice.items as {[key: string]: InvoiceItem});
    
    itemsToPrint.forEach((item, index) => {
        let breakdownLines = [];
        if (item.metalCost > 0) breakdownLines.push(`  Metal: PKR ${item.metalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.wastageCost > 0) breakdownLines.push(`  + Wastage (${item.wastagePercentage}%): PKR ${item.wastageCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.makingCharges > 0) breakdownLines.push(`  + Making: PKR ${item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.diamondChargesIfAny > 0) breakdownLines.push(`  + Diamonds: PKR ${item.diamondChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.stoneChargesIfAny > 0) breakdownLines.push(`  + Stones: PKR ${item.stoneChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.miscChargesIfAny > 0) breakdownLines.push(`  + Misc: PKR ${item.miscChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        const breakdownText = breakdownLines.length > 0 ? `\n${breakdownLines.join('\n')}` : '';

        const metalDisplay = `${item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1)}${item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : ''}, Wt: ${(item.metalWeightG || 0).toFixed(2)}g`;
        
        const mainTitle = `${item.name}`;
        const subTitle = `SKU: ${item.sku} | ${metalDisplay}`;
        
        const fullDescription = `${mainTitle}\n${subTitle}${breakdownText ? `${breakdownText}` : ''}`;

        const itemData = [
            index + 1,
            fullDescription,
            item.quantity,
            item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }),
            item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 }),
        ];
        tableRows.push(itemData);
    });

    pdfDoc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: tableStartY,
        theme: 'grid',
        headStyles: { fillColor: [240, 240, 240], textColor: 50, fontStyle: 'bold', fontSize: 8, },
        styles: { fontSize: 8, cellPadding: 2, valign: 'top', },
        columnStyles: {
            0: { cellWidth: 8, halign: 'center' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 10, halign: 'right' },
            3: { cellWidth: 25, halign: 'right' },
            4: { cellWidth: 25, halign: 'right' },
        },
        didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
            if (data.pageNumber > 1) {
                pdfDoc.setPage(data.pageNumber);
                data.settings.startY = 28; 
            }
            drawHeader(data.pageNumber);
        },
    });

    let finalY = pdfDoc.lastAutoTable.finalY || 0;
    
    const footerAndTotalsHeight = 70;
    let needsNewPage = finalY + footerAndTotalsHeight > pageHeight - margin;

    if (needsNewPage) {
        pdfDoc.addPage();
        drawHeader(pdfDoc.getNumberOfPages());
        finalY = 28; 
    }
    
    let currentY = finalY + 8;
    const totalsX = pageWidth - margin;

    pdfDoc.setFontSize(9).setFont("helvetica", "normal").setTextColor(0);
    pdfDoc.text(`Subtotal:`, totalsX - 50, currentY, { align: 'right' });
    pdfDoc.text(`PKR ${invoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 6;

    if (invoice.discountAmount > 0) {
        pdfDoc.setFont("helvetica", "bold").setTextColor(220, 53, 69);
        pdfDoc.text(`Discount:`, totalsX - 50, currentY, { align: 'right' });
        pdfDoc.text(`- PKR ${invoice.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
        currentY += 6;
    }
    
    pdfDoc.setFont("helvetica", "normal").setTextColor(0);
    pdfDoc.setLineWidth(0.2);
    pdfDoc.line(totalsX - 50, currentY, totalsX, currentY);
    currentY += 6;
    
    pdfDoc.setFontSize(10).setFont("helvetica", "bold");
    pdfDoc.text(`Grand Total:`, totalsX - 50, currentY, { align: 'right' });
    pdfDoc.text(`PKR ${invoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;
    
    if (invoice.amountPaid > 0) {
        pdfDoc.setFontSize(9).setFont("helvetica", "normal");
        pdfDoc.text(`Amount Paid:`, totalsX - 50, currentY, { align: 'right' });
        pdfDoc.text(`- PKR ${invoice.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
        currentY += 7;
        
        pdfDoc.setFontSize(12).setFont("helvetica", "bold");
        pdfDoc.text(`Balance Due:`, totalsX - 50, currentY, { align: 'right' });
        pdfDoc.text(`PKR ${invoice.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    }

    const footerStartY = pageHeight - 35;
    const contacts = [
        { name: "Mina Khalid", number: "0316 1930960" },
        { name: "Ammar Mansa", number: "0326 2275554" },
    ];

    pdfDoc.setLineWidth(0.2);
    pdfDoc.line(margin, footerStartY - 5, pageWidth - margin, footerStartY - 5);

    let contactY = footerStartY;
    pdfDoc.setFontSize(6).setFont("helvetica", "bold").setTextColor(50);
    pdfDoc.text("For Orders & Inquiries:", margin, contactY);
    contactY += 3;
    pdfDoc.setFontSize(8).setFont("helvetica", "normal").setTextColor(100);
    contacts.forEach(contact => {
        pdfDoc.text(`${contact.name}: ${contact.number}`, margin, contactY);
        contactY += 4;
    });
    
    pdfDoc.save(`Estimate-${invoice.id}.pdf`);
  }

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-muted">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-destructive/10 p-4">
        <Card className="w-full max-w-lg border-destructive">
            <CardHeader>
                <h1 className="text-xl font-semibold text-destructive">Error</h1>
            </CardHeader>
            <CardContent>
                <p>{error || "Invoice could not be loaded."}</p>
            </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-muted min-h-screen p-4 sm:p-8">
        <Card className="max-w-2xl mx-auto shadow-2xl">
            <CardHeader className="text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-green-500"/>
                <CardTitle className="text-2xl font-bold">Estimate Ready</CardTitle>
                <CardDescription>
                    Your estimate <span className="font-mono font-medium text-foreground">{invoice.id}</span> is ready for download.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="p-4 border rounded-md bg-background">
                    <div className="flex justify-between items-center">
                        <div>
                            <p className="text-sm text-muted-foreground">Billed to</p>
                            <p className="font-semibold">{invoice.customerName || 'Walk-in Customer'}</p>
                        </div>
                         <div>
                            <p className="text-sm text-muted-foreground text-right">Grand Total</p>
                            <p className="font-semibold text-xl text-primary text-right">PKR {invoice.grandTotal.toLocaleString()}</p>
                        </div>
                    </div>
                     {invoice.amountPaid > 0 && (
                        <div className="border-t mt-3 pt-3">
                            <div className="flex justify-between items-center">
                                <p className="text-sm text-muted-foreground">Amount Paid</p>
                                <p className="font-semibold text-green-600">- PKR {invoice.amountPaid.toLocaleString()}</p>
                            </div>
                            <div className="flex justify-between items-center mt-1">
                                <p className="text-sm text-muted-foreground">Balance Due</p>
                                <p className="font-semibold text-destructive">PKR {invoice.balanceDue.toLocaleString()}</p>
                            </div>
                        </div>
                    )}
                </div>
            </CardContent>
            <CardFooter>
                 <Button onClick={handlePrint} disabled={!settings} size="lg" className="w-full">
                    <Download className="mr-2 h-5 w-5" /> Download PDF
                </Button>
            </CardFooter>
        </Card>
         <footer className="text-center mt-8 text-sm text-muted-foreground">
            <p>Thank you for your business!</p>
            {settings?.shopName && <p>&copy; {new Date().getFullYear()} {settings.shopName}</p>}
        </footer>
    </div>
  );
}
