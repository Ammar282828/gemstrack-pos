
"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Invoice, Settings, Customer } from '@/lib/store';
import { Loader2, Download, CheckCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';

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
  const [loading, setLoading] = useState(true);
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
        setLoading(false);
      }
    };

    fetchInvoiceData();
  }, [invoiceId]);
  
  const handlePrint = () => {
    if (!invoice || !settings) return;
    
    const pdfDoc = new jsPDF();
    const pageHeight = pdfDoc.internal.pageSize.getHeight();
    const pageWidth = pdfDoc.internal.pageSize.getWidth();
    const margin = 15;
    const logoUrl = settings.shopLogoUrlBlack;

    function drawHeader(pageNum: number) {
        if (logoUrl) {
            try {
                 pdfDoc.addImage(logoUrl, 'PNG', margin, 15, 40, 10, undefined, 'FAST');
            } catch (e) {
                 console.error("Error adding logo to PDF:", e);
            }
        }
        
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(28);
        pdfDoc.text('ESTIMATE', pageWidth - margin, 22, { align: 'right' });
        
        pdfDoc.setLineWidth(0.5);
        pdfDoc.line(margin, 35, pageWidth - margin, 35);

        if (pageNum > 1) {
            pdfDoc.setFontSize(8);
            pdfDoc.setTextColor(150);
            pdfDoc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 10, {align: 'right'});
        }
    }
    
    drawHeader(1);
    
    let infoY = 50;
    pdfDoc.setFontSize(10);
    pdfDoc.setTextColor(100);
    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.text('BILL TO:', margin, infoY);
    pdfDoc.text('INVOICE DETAILS:', pageWidth / 2, infoY);

    pdfDoc.setLineWidth(0.2);
    pdfDoc.line(margin, infoY + 2, pageWidth - margin, infoY + 2);

    infoY += 8;
    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.setTextColor(0);

    let customerInfo = "Walk-in Customer";
    if (customer) {
        customerInfo = `${customer.name}\n`;
        if (customer.address) customerInfo += `${customer.address}\n`;
        if (customer.phone) customerInfo += `Phone: ${customer.phone}\n`;
        if (customer.email) customerInfo += `Email: ${customer.email}`;
    } else if (invoice.customerName) {
        customerInfo = invoice.customerName;
    }
    pdfDoc.text(customerInfo, margin, infoY, { lineHeightFactor: 1.5 });

    let invoiceDetails = `Estimate #: ${invoice.id}\n`;
    invoiceDetails += `Date: ${new Date(invoice.createdAt).toLocaleDateString()}`;
    pdfDoc.text(invoiceDetails, pageWidth / 2, infoY, { lineHeightFactor: 1.5 });

    let ratesApplied = [];
    if (invoice.goldRateApplied) {
        const goldRate21k = invoice.goldRateApplied * (21 / 24);
        ratesApplied.push(`Gold (21k): PKR ${goldRate21k.toLocaleString(undefined, { minimumFractionDigits: 0 })}/g`);
    }
    if (ratesApplied.length > 0) {
        pdfDoc.setFontSize(8);
        pdfDoc.setTextColor(150);
        pdfDoc.text(ratesApplied.join(' | '), pageWidth / 2, infoY + 12, { lineHeightFactor: 1.5 });
    }
    
    const tableStartY = infoY + 30;
    const tableColumn = ["#", "Product & Breakdown", "Qty", "Unit Price", "Total"];
    const tableRows: any[][] = [];

    invoice.items.forEach((item, index) => {
        let breakdownLines = [];
        if (item.metalCost > 0) breakdownLines.push(`  Metal: PKR ${item.metalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.wastageCost > 0) breakdownLines.push(`  + Wastage (${item.wastagePercentage}%): PKR ${item.wastageCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.makingCharges > 0) breakdownLines.push(`  + Making Charges: PKR ${item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.diamondChargesIfAny > 0) breakdownLines.push(`  + Diamonds: PKR ${item.diamondChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.stoneChargesIfAny > 0) breakdownLines.push(`  + Stones: PKR ${item.stoneChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.miscChargesIfAny > 0) breakdownLines.push(`  + Misc: PKR ${item.miscChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        const breakdownText = breakdownLines.length > 0 ? `\n${breakdownLines.join('\n')}` : '';

        const metalDisplay = `${item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1)}${item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : ''}, Wt: ${item.metalWeightG.toFixed(2)}g`;
        
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
        headStyles: { fillColor: [240, 240, 240], textColor: 50, fontStyle: 'bold', fontSize: 10, },
        styles: { fontSize: 9, cellPadding: 2.5, valign: 'top', },
        columnStyles: {
            0: { cellWidth: 10, halign: 'center' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 15, halign: 'right' },
            3: { cellWidth: 30, halign: 'right' },
            4: { cellWidth: 30, halign: 'right' },
        },
        didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
            if (data.pageNumber > 1) {
                pdfDoc.setPage(data.pageNumber);
                data.settings.startY = 40; 
            }
            drawHeader(data.pageNumber);
        },
    });

    let finalY = pdfDoc.lastAutoTable.finalY || 0;
    
    const footerAndTotalsHeight = 85;
    let needsNewPage = finalY + footerAndTotalsHeight > pageHeight - margin;

    if (needsNewPage) {
        pdfDoc.addPage();
        drawHeader(pdfDoc.getNumberOfPages());
        finalY = 40; 
    }
    
    let currentY = finalY + 10;
    const totalsX = pageWidth - margin;

    pdfDoc.setFontSize(10).setFont("helvetica", "normal").setTextColor(0);
    pdfDoc.text(`Subtotal:`, totalsX - 60, currentY, { align: 'right' });
    pdfDoc.text(`PKR ${invoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;

    pdfDoc.setFont("helvetica", "bold").setTextColor(220, 53, 69);
    pdfDoc.text(`Discount:`, totalsX - 60, currentY, { align: 'right' });
    pdfDoc.text(`- PKR ${invoice.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;
    
    pdfDoc.setFont("helvetica", "normal").setTextColor(0);
    pdfDoc.setLineWidth(0.3);
    pdfDoc.line(totalsX - 60, currentY, totalsX, currentY);
    currentY += 8;
    
    pdfDoc.setFontSize(12).setFont("helvetica", "bold");
    pdfDoc.text(`Grand Total:`, totalsX - 60, currentY, { align: 'right' });
    pdfDoc.text(`PKR ${invoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 8;
    
    if (invoice.amountPaid > 0) {
        pdfDoc.setFontSize(10).setFont("helvetica", "normal");
        pdfDoc.text(`Amount Paid:`, totalsX - 60, currentY, { align: 'right' });
        pdfDoc.text(`- PKR ${invoice.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
        currentY += 8;
        
        pdfDoc.setFontSize(14).setFont("helvetica", "bold");
        pdfDoc.text(`Balance Due:`, totalsX - 60, currentY, { align: 'right' });
        pdfDoc.text(`PKR ${invoice.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    }

    const footerStartY = pageHeight - 45;
    const guaranteesText = "Gold used is independently tested & verified by Swiss Lab Ltd., confirming 21k (0.875 fineness). Crafted exclusively from premium ARY GOLD.";
    
    pdfDoc.setLineWidth(0.2);
    pdfDoc.line(margin, footerStartY - 10, pageWidth - margin, footerStartY - 10);
    pdfDoc.setFontSize(8).setTextColor(150);
    pdfDoc.text(guaranteesText, margin, footerStartY, { maxWidth: pageWidth - margin * 2 - 70 });
    
    const contacts = [
        { name: "Murtaza", number: "0333 2275190" }, { name: "Muhammad", number: "0300 8280896" },
        { name: "Huzaifa", number: "0335 2275553" }, { name: "Ammar", number: "0326 2275554" },
    ];
    let contactY = footerStartY + 12;
    pdfDoc.setFontSize(8).setFont("helvetica", "bold").setTextColor(50);
    pdfDoc.text("For Orders & Inquiries:", margin, contactY);
    contactY += 4;
    pdfDoc.setFont("helvetica", "normal").setTextColor(100);
    contacts.forEach(contact => {
        pdfDoc.text(`${contact.name}: ${contact.number}`, margin, contactY);
        contactY += 4;
    });

    const qrCodeSize = 25;
    const qrSectionWidth = (qrCodeSize * 2) + 15;
    const qrStartX = pageWidth - margin - qrSectionWidth;

    const instaQrCanvas = document.getElementById('insta-qr-code') as HTMLCanvasElement;
    const waQrCanvas = document.getElementById('wa-qr-code') as HTMLCanvasElement;

    if (instaQrCanvas) {
        pdfDoc.setFontSize(8); pdfDoc.setFont("helvetica", "bold").setTextColor(0);
        pdfDoc.text("@collectionstaheri", qrStartX + qrCodeSize/2, footerStartY - 2, { align: 'center'});
        pdfDoc.addImage(instaQrCanvas.toDataURL('image/png'), 'PNG', qrStartX, footerStartY, qrCodeSize, qrCodeSize);
    }
    if (waQrCanvas) {
        const secondQrX = qrStartX + qrCodeSize + 15;
        pdfDoc.setFontSize(8); pdfDoc.setFont("helvetica", "bold").setTextColor(0);
        pdfDoc.text("Join on WhatsApp", secondQrX + qrCodeSize/2, footerStartY - 2, { align: 'center'});
        pdfDoc.addImage(waQrCanvas.toDataURL('image/png'), 'PNG', secondQrX, footerStartY, qrCodeSize, qrCodeSize);
    }
    
    pdfDoc.save(`Estimate-${invoice.id}.pdf`);
  }

  if (loading) {
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
      <div style={{ display: 'none' }}>
        <QRCode id="insta-qr-code" value="https://www.instagram.com/collectionstaheri?igsh=bWs4YWgydjJ1cXBz&utm_source=qr" size={128} />
        <QRCode id="wa-qr-code" value="https://chat.whatsapp.com/HMeoF0Zcl0i9XobLspaCWl?mode=ac_t" size={128} />
      </div>

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
