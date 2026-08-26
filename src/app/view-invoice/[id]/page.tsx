

"use client";

import React, { useState, useEffect } from 'react';
import { metalLabel, describeMetal, describeSettings, describeDelivery } from '@/lib/materials';
import { STORE_CONFIG, STORE_LOGO_URL, STORE_LOGO_ASPECT } from '@/lib/store-config';
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
import { DetailSkeleton } from '@/components/shared/skeletons';
import { drawItemCell, itemCellHeight, type ItemBlock } from '@/lib/invoice-item-cell';
import { drawDocHeader, drawDocFooter, tableStyles, drawRowRule, alignHeadCell, label, drawTotals, type TotalRow } from '@/lib/pdf-chrome';

/** Shared by the table and by alignHeadCell, which needs the same object. */
const INVOICE_COLUMNS = {
  0: { cellWidth: 7, halign: 'center' },
  1: { cellWidth: 'auto' },
  2: { cellWidth: 9, halign: 'right' },
  3: { cellWidth: 22, halign: 'right' },
  4: { cellWidth: 22, halign: 'right' },
} as const;

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
    const logoUrl = STORE_LOGO_URL;
    if (logoUrl) {
      try {
        const proxyUrl = logoUrl.startsWith('/') ? logoUrl : `/api/proxy-image?url=${encodeURIComponent(logoUrl)}`;
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

        const drawHeader = (pageNum: number) => drawDocHeader(pdfDoc, {
      pageWidth, pageHeight, margin, title: 'Estimate',
      logoDataUrl, logoFormat, logoAspect: STORE_LOGO_ASPECT, pageNum,
    });
    
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
    const phone = customer?.phone || invoice.customerContact || '';
    const email = customer?.email || '';
    if (customer) {
        customerInfo = `${customer.name}\n`;
        if (customer.address) customerInfo += `${customer.address}\n`;
    } else if (invoice.customerName) {
        customerInfo = `${invoice.customerName}\n`;
    }
    if (phone) customerInfo += `Phone: ${phone}\n`;
    if (email) customerInfo += `Email: ${email}`;
    pdfDoc.text(customerInfo, margin, infoY, { lineHeightFactor: 1.4 });

    // Where it is going, when it is being delivered. The address the customer
    // gave was never printed, so whoever packed the piece had to go and find
    // it in the order.
    const deliveryLines: string[] = describeDelivery(invoice.delivery);
    if (deliveryLines.length) {
      const dy = infoY + (customerInfo.split('\n').length * 4) + 2;
      pdfDoc.setFontSize(7).setTextColor(100).setFont('helvetica', 'bold');
      pdfDoc.text('DELIVER TO:', margin, dy);
      pdfDoc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0);
      pdfDoc.text(deliveryLines.join('\n'), margin, dy + 4, { lineHeightFactor: 1.4 });
    }

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
    
    // The delivery block sits under BILL TO and grows with the address, so
    // the table has to start below whatever it actually took. Without this
    // the items table was drawn straight over it.
    const deliveryBlockHeight = deliveryLines.length
      ? 6 + deliveryLines.length * 4
      : 0;
    const tableStartY = infoY + (ratesApplied.length > 0 ? 18 : 13) + deliveryBlockHeight;
    const tableColumn = ["#", "Product & Breakdown", "Qty", "Unit", "Total"];
    const tableRows: any[][] = [];
    const itemBlocks: ItemBlock[] = [];
    // The description column is 'auto', so its width is whatever the fixed
    // columns leave. Computed here so the height and the drawing wrap at the
    // same measure.
    // autoTable is given this same margin, so the arithmetic below matches the
    // width it actually hands the cell. It did not: autoTable defaults to its
    // own ~14.11mm margin and these pages use 10, so the description column was
    // assumed 8.2mm wider than it was and the spec line ran into the Qty column.
    const descColWidth = (pageWidth - margin * 2) - (7 + 9 + 22 + 22);

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

        const metalTypeName = metalLabel(item.metalType);
        const karat = item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : '';
        const weightPart = item.metalWeightG > 0 ? `, Wt: ${item.metalWeightG.toFixed(2)}g` : '';
        const metalDisplay = `${metalTypeName}${karat}${weightPart}`;
        
        // The cell is drawn by hand in didDrawCell — see lib/invoice-item-cell.
        // The name leads, the specification sits under it, what is set into
        // the piece gets its own line, and the costs are subordinate.
        const block: ItemBlock = {
            name: item.name || '',
            spec: [
                staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory || '',
                metalDisplay,
                item.size ? `Size ${item.size}` : '',
                item.sku ? `SKU ${item.sku}` : '',
            ].filter(Boolean).join('  ·  '),
            settings: describeSettings(item),
            breakdown: breakdownLines.map(l => l.trim().replace(/^\+\s*/, '')),
        };
        itemBlocks.push(block);

        const itemData = [
            index + 1,
            '',
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
        ...tableStyles(margin),
        columnStyles: INVOICE_COLUMNS,
        didParseCell: (data: any) => {
            alignHeadCell(data, INVOICE_COLUMNS);
            // Tell autoTable how tall the hand-drawn cell will be, and stop it
            // laying out text of its own there.
            if (data.section === 'body' && data.column.index === 1) {
                const block = itemBlocks[data.row.index];
                if (block) {
                    data.cell.text = [];
                    data.cell.styles.minCellHeight = itemCellHeight(pdfDoc, block, descColWidth);
                }
            }
        },
        didDrawCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 1) {
                const block = itemBlocks[data.row.index];
                if (block) drawItemCell(pdfDoc, block, data.cell, descColWidth);
            }
            drawRowRule(pdfDoc, data, 4, { margin, pageWidth });
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

    const money = (n: number) => `PKR ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const totalRows: TotalRow[] = [{ label: 'Subtotal', value: money(invoice.subtotal) }];
      if (invoice.discountAmount > 0) totalRows.push({ label: 'Discount', value: `- ${money(invoice.discountAmount)}`, tone: 'ink' });
      if (adjustmentsAmount !== 0) totalRows.push({ label: 'Adjustments', value: money(adjustmentsAmount) });
      if (invoice.exchangeAmount1 || invoice.exchangeAmount2) {
      totalRows.push({ label: invoice.exchangeDescription ? `Exchange (${invoice.exchangeDescription})` : 'Exchange', value: '', tone: 'ink' });
        if (invoice.exchangeAmount1) totalRows.push({ label: '', value: `- ${money(invoice.exchangeAmount1)}` });
        if (invoice.exchangeAmount2) totalRows.push({ label: '', value: `- ${money(invoice.exchangeAmount2)}` });
    }
      drawTotals(pdfDoc, {
      pageWidth, pageHeight, margin, startY: currentY, onNewPage: drawHeader,
      rows: totalRows,
      total: { label: 'Grand Total', value: money(invoice.grandTotal) },
      after: invoice.amountPaid > 0 ? [{ label: 'Amount Paid', value: `- ${money(invoice.amountPaid)}` }] : [],
      closing: invoice.amountPaid > 0 ? { label: 'Balance Due', value: money(invoice.balanceDue) } : undefined,
    });

    drawDocFooter(pdfDoc, {
      pageWidth, pageHeight, margin,
      whatsappQr: document.getElementById('wa-qr-code') as HTMLCanvasElement | null,
      instagramQr: document.getElementById('insta-qr-code') as HTMLCanvasElement | null,
    });

    await savePDF(pdfDoc, `Estimate-${invoice.id}.pdf`, iOSWin);
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <DetailSkeleton sections={2} />
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
        <img id="shop-logo" src={STORE_LOGO_URL} crossOrigin="anonymous" alt="" loading="lazy" decoding="async" />
        <QRCode id="wa-qr-code" value={STORE_CONFIG.whatsappUrl} size={128} />
        <QRCode id="insta-qr-code" value={STORE_CONFIG.instagramUrl} size={128} />
      </div>
        <Card className="max-w-2xl mx-auto shadow-2xl">
            <CardHeader className="text-center">
                <CheckCircle className="mx-auto h-12 w-12 text-success"/>
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
                                <p className="font-semibold text-success">- PKR {invoice.amountPaid.toLocaleString()}</p>
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
            <p>Thank you for your business.</p>
            {settings?.shopName && <p>&copy; {new Date().getFullYear()} {settings.shopName}</p>}
        </footer>
    </div>
  );
}
