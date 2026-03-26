

"use client";

import React, { useState, useEffect } from 'react';
import { STORE_CONFIG } from '@/lib/store-config';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Invoice, Settings, Customer, InvoiceItem, staticCategories } from '@/lib/store';
import { Loader2, Download, CheckCircle } from 'lucide-react';
import { openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';
import { format } from 'date-fns';
import { getInvoiceAdjustmentsAmount } from '@/lib/financials';

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
  
  const handlePrint = async () => {
    if (!invoice || !settings) return;

    const iOSWin = openPDFWindowForIOS();
    const pdfDoc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a5'
    });
    const pageHeight = pdfDoc.internal.pageSize.getHeight();
    const pageWidth = pdfDoc.internal.pageSize.getWidth();
    const margin = 10;

    let logoDataUrl: string | null = null;
    let logoFormat: string = 'PNG';
    let logoNaturalW = 0;
    let logoNaturalH = 0;
    const logoUrl = settings.shopLogoUrlBlack || settings.shopLogoUrl;
    if (logoUrl) {
      try {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(logoUrl)}`;
        const res = await fetch(proxyUrl);
        const blob = await res.blob();
        logoFormat = blob.type.toLowerCase().includes('jpeg') || blob.type.toLowerCase().includes('jpg') ? 'JPEG' : 'PNG';
        logoDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        // Get natural dimensions to preserve aspect ratio
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => { logoNaturalW = img.naturalWidth; logoNaturalH = img.naturalHeight; resolve(); };
          img.onerror = () => resolve();
          img.src = logoDataUrl!;
        });
      } catch (e) {
        console.error("Error loading logo:", e);
      }
    }

    function drawHeader(pageNum: number) {
        if (logoDataUrl) {
            try {
                const maxLogoH = 14;
                const logoH = maxLogoH;
                const logoW = logoNaturalH > 0 ? maxLogoH * (logoNaturalW / logoNaturalH) : 45;
                pdfDoc.addImage(logoDataUrl, logoFormat, margin, 7, logoW, logoH, undefined, 'FAST');
            } catch (e) {
                console.error("Error adding logo to PDF:", e);
            }
        }
        
        pdfDoc.setFont("helvetica", "bold");
        pdfDoc.setFontSize(14);
        pdfDoc.text('ESTIMATE', pageWidth - margin, 14, { align: 'right' });
        
        pdfDoc.setLineWidth(0.4);
        pdfDoc.line(margin, 22, pageWidth - margin, 22);

        if (pageNum > 1) {
            pdfDoc.setFontSize(7);
            pdfDoc.setTextColor(150);
            pdfDoc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 5, {align: 'right'});
        }
    }
    
    drawHeader(1);
    
    let infoY = 28;
    pdfDoc.setFontSize(7);
    pdfDoc.setTextColor(100);
    pdfDoc.setFont("helvetica", "bold");
    pdfDoc.text('BILL TO:', margin, infoY);
    pdfDoc.text('INVOICE DETAILS:', pageWidth / 2 + 2, infoY);

    pdfDoc.setLineWidth(0.2);
    pdfDoc.line(margin, infoY + 1.5, pageWidth - margin, infoY + 1.5);

    infoY += 6;
    pdfDoc.setFont("helvetica", "normal");
    pdfDoc.setTextColor(0);
    pdfDoc.setFontSize(8);

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
    
    const rates = (invoice.ratesApplied || {}) as Record<string, number>;
    const itemsList = invoice.items as InvoiceItem[];
    const usedKarats = new Set(itemsList.filter(i => i.metalType === 'gold').map(i => i.karat).filter(Boolean));
    let ratesApplied: string[] = [];
    if (usedKarats.size > 0) {
      if (usedKarats.has('24k') && rates.goldRatePerGram24k) ratesApplied.push(`24k: ${rates.goldRatePerGram24k.toLocaleString()}/g`);
      if (usedKarats.has('22k') && rates.goldRatePerGram22k) ratesApplied.push(`22k: ${rates.goldRatePerGram22k.toLocaleString()}/g`);
      if (usedKarats.has('21k') && rates.goldRatePerGram21k) ratesApplied.push(`21k: ${rates.goldRatePerGram21k.toLocaleString()}/g`);
      if (usedKarats.has('18k') && rates.goldRatePerGram18k) ratesApplied.push(`18k: ${rates.goldRatePerGram18k.toLocaleString()}/g`);
    }

    if (ratesApplied.length > 0) {
        pdfDoc.setFontSize(6.5);
        pdfDoc.setTextColor(150);
        pdfDoc.text(ratesApplied.join(' | '), pageWidth / 2 + 2, infoY + 10, { lineHeightFactor: 1.4 });
    }
    
    const tableStartY = infoY + (ratesApplied.length > 0 ? 18 : 13);
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

        const metalTypeName = item.metalType === 'silver' ? '925 Sterling Silver' : item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1);
        const karat = item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : '';
        const weightPart = item.metalWeightG > 0 ? `, Wt: ${item.metalWeightG.toFixed(2)}g` : '';
        const metalDisplay = `${metalTypeName}${karat}${weightPart}`;
        
        const mainTitle = `${item.name}`;
        const subTitle = `SKU: ${item.sku} | ${metalDisplay}`;
        
        const categoryTitle = staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory || '';
        const fullDescription = `${categoryTitle ? categoryTitle.toUpperCase() + '\n' : ''}${mainTitle}\n${subTitle}${breakdownText ? `${breakdownText}` : ''}`;

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
        headStyles: { fillColor: [230, 230, 230], textColor: 40, fontStyle: 'bold', fontSize: 7, cellPadding: 2 },
        styles: { fontSize: 7.5, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 }, valign: 'top', lineColor: [200, 200, 200], lineWidth: 0.1 },
        columnStyles: {
            0: { cellWidth: 7, halign: 'center' },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 9, halign: 'right' },
            3: { cellWidth: 22, halign: 'right' },
            4: { cellWidth: 22, halign: 'right' },
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
    
    const footerAndTotalsHeight = 80;
    let needsNewPage = finalY + footerAndTotalsHeight > pageHeight - margin;

    if (needsNewPage) {
        pdfDoc.addPage();
        drawHeader(pdfDoc.getNumberOfPages());
        finalY = 28; 
    }
    
    let currentY = finalY + 8;
    const totalsX = pageWidth - margin;
    const adjustmentsAmount = getInvoiceAdjustmentsAmount(invoice);

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
    if (adjustmentsAmount !== 0) {
        pdfDoc.setFont("helvetica", "normal").setTextColor(0);
        pdfDoc.text(`Adjustments:`, totalsX - 50, currentY, { align: 'right' });
        pdfDoc.text(`PKR ${adjustmentsAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
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

    const footerStartY = pageHeight - 36;
    const contacts = [
        { name: STORE_CONFIG.contact1Name, number: STORE_CONFIG.contact1Number },
        { name: STORE_CONFIG.contact2Name, number: STORE_CONFIG.contact2Number },
        { name: STORE_CONFIG.contact3Name, number: STORE_CONFIG.contact3Number },
        { name: STORE_CONFIG.contact4Name, number: STORE_CONFIG.contact4Number },
    ].filter(c => c.name && c.number);
    const qrCodeSize = 16;
    const qrGap = 3;
    const qrSectionWidth = (qrCodeSize * 2) + qrGap;
    const textBlockWidth = pageWidth - margin * 2 - qrSectionWidth - 6;
    const qrStartX = pageWidth - margin - qrSectionWidth;

    pdfDoc.setLineWidth(0.2);
    pdfDoc.line(margin, footerStartY - 2, pageWidth - margin, footerStartY - 2);

    pdfDoc.setFontSize(6).setFont("helvetica", "bold").setTextColor(70);
    pdfDoc.text("For Orders & Inquiries:", margin, footerStartY + 2, { maxWidth: textBlockWidth });
    pdfDoc.setFontSize(7.5).setFont("helvetica", "normal").setTextColor(30);
    contacts.forEach((c, i) => {
      pdfDoc.text(`${c.name}: ${c.number}`, margin, footerStartY + 6 + i * 4, { maxWidth: textBlockWidth });
    });
    const afterContacts = footerStartY + 6 + contacts.length * 4;
    pdfDoc.setFontSize(6).setFont("helvetica", "bold").setTextColor(80);
    pdfDoc.text(STORE_CONFIG.bankLine, margin, afterContacts + 2, { maxWidth: textBlockWidth });
    if (STORE_CONFIG.iban) {
      pdfDoc.setFontSize(6).setFont("helvetica", "normal").setTextColor(100);
      pdfDoc.text(`IBAN: ${STORE_CONFIG.iban}`, margin, afterContacts + 6, { maxWidth: textBlockWidth });
    }

    const waQrCanvas = document.getElementById('wa-qr-code') as HTMLCanvasElement;
    const instaQrCanvas = document.getElementById('insta-qr-code') as HTMLCanvasElement;

    if (waQrCanvas) {
        pdfDoc.setFontSize(5).setFont("helvetica", "bold").setTextColor(60);
        pdfDoc.text("Join us on Whatsapp", qrStartX + qrCodeSize / 2, footerStartY + 2, { align: 'center' });
        pdfDoc.addImage(waQrCanvas.toDataURL('image/png'), 'PNG', qrStartX, footerStartY + 4, qrCodeSize, qrCodeSize);
    }
    if (instaQrCanvas) {
        const secondQrX = qrStartX + qrCodeSize + qrGap;
        pdfDoc.setFontSize(5).setFont("helvetica", "bold").setTextColor(60);
        pdfDoc.text("Follow us on Instagram", secondQrX + qrCodeSize / 2, footerStartY + 2, { align: 'center' });
        pdfDoc.addImage(instaQrCanvas.toDataURL('image/png'), 'PNG', secondQrX, footerStartY + 4, qrCodeSize, qrCodeSize);
    }
    
    await savePDF(pdfDoc, `Estimate-${invoice.id}.pdf`, iOSWin);
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
      <div style={{ display: 'none' }}>
        <img id="shop-logo" src={settings?.shopLogoUrlBlack || settings?.shopLogoUrl || ''} crossOrigin="anonymous" alt="" />
        <QRCode id="wa-qr-code" value={STORE_CONFIG.whatsappUrl} size={128} />
        <QRCode id="insta-qr-code" value={STORE_CONFIG.instagramUrl} size={128} />
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
                            {getInvoiceAdjustmentsAmount(invoice) !== 0 && (
                                <p className="text-xs text-muted-foreground text-right">
                                    Includes adjustments of PKR {getInvoiceAdjustmentsAmount(invoice).toLocaleString()}
                                </p>
                            )}
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
