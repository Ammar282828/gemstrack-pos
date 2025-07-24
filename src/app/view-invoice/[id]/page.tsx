
"use client";

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Invoice, Settings, Customer } from '@/lib/store';
import { Loader2, Download } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
    
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const logoUrl = settings.shopLogoUrlBlack;

    function drawHeader(pageNum: number) {
        if (logoUrl) {
            try {
                const img = new window.Image();
                img.src = logoUrl;
                img.onload = () => {
                    const aspectRatio = img.width / img.height;
                    const imgHeight = 15;
                    const imgWidth = imgHeight * aspectRatio;
                    doc.addImage(img, 'PNG', margin, 15, imgWidth, imgHeight);
                }
            } catch (e) {
                 console.error("Error adding logo to PDF:", e);
            }
        }
        
        doc.setFont("helvetica", "bold");
        doc.setFontSize(28);
        doc.text('ESTIMATE', pageWidth - margin, 22, { align: 'right' });
        
        doc.setLineWidth(0.5);
        doc.line(margin, 35, pageWidth - margin, 35);

        if (pageNum > 1) {
            doc.setFontSize(8);
            doc.setTextColor(150);
            doc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 10, {align: 'right'});
        }
    }
    
    drawHeader(1);
    
    let infoY = 50;
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.setFont("helvetica", "bold");
    doc.text('BILL TO:', margin, infoY);
    doc.text('INVOICE DETAILS:', pageWidth / 2, infoY);

    doc.setLineWidth(0.2);
    doc.line(margin, infoY + 2, pageWidth - margin, infoY + 2);

    infoY += 8;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);

    let customerInfo = "Walk-in Customer";
    if (customer) {
        customerInfo = `${customer.name}\n`;
        if (customer.address) customerInfo += `${customer.address}\n`;
        if (customer.phone) customerInfo += `Phone: ${customer.phone}\n`;
        if (customer.email) customerInfo += `Email: ${customer.email}`;
    } else if (invoice.customerName) {
        customerInfo = invoice.customerName;
    }
    doc.text(customerInfo, margin, infoY, { lineHeightFactor: 1.5 });

    let invoiceDetails = `Estimate #: ${invoice.id}\n`;
    invoiceDetails += `Date: ${new Date(invoice.createdAt).toLocaleDateString()}`;
    doc.text(invoiceDetails, pageWidth / 2, infoY, { lineHeightFactor: 1.5 });

    let ratesApplied = [];
    if (invoice.goldRateApplied) {
        const goldRate21k = invoice.goldRateApplied * (21 / 24);
        ratesApplied.push(`Gold (21k): PKR ${goldRate21k.toLocaleString(undefined, { minimumFractionDigits: 0 })}/g`);
    }
    if (ratesApplied.length > 0) {
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(ratesApplied.join(' | '), pageWidth / 2, infoY + 12, { lineHeightFactor: 1.5 });
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

    doc.autoTable({
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
        didDrawPage: (data) => {
            if (data.pageNumber > 1) {
                doc.setPage(data.pageNumber);
                data.settings.startY = 40; 
                drawHeader(data.pageNumber);
            } else {
                drawHeader(data.pageNumber);
            }
        },
    });

    let finalY = doc.lastAutoTable.finalY || 0;
    
    const footerAndTotalsHeight = 75;
    let needsNewPage = finalY + footerAndTotalsHeight > pageHeight - margin;

    if (needsNewPage) {
        doc.addPage();
        drawHeader(doc.getNumberOfPages());
        finalY = 40; 
    }

    let currentY = finalY + 15;
    const totalsX = pageWidth - margin;

    doc.setFontSize(10).setFont("helvetica", "normal").setTextColor(0);
    doc.text(`Subtotal:`, totalsX - 40, currentY, { align: 'right' });
    doc.text(`PKR ${invoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;

    doc.setFont("helvetica", "bold").setTextColor(220, 53, 69);
    doc.text(`Discount:`, totalsX - 40, currentY, { align: 'right' });
    doc.text(`- PKR ${invoice.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;
    doc.setFont("helvetica", "normal").setTextColor(0);
    
    doc.setLineWidth(0.5);
    doc.line(totalsX - 60, currentY, totalsX, currentY);
    currentY += 8;
    
    doc.setFontSize(14).setFont("helvetica", "bold");
    doc.text(`Grand Total:`, totalsX - 60, currentY, { align: 'right' });
    doc.text(`PKR ${invoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });

    const footerStartY = pageHeight - 45;
    const guaranteesText = "Gold used is independently tested & verified by Swiss Lab Ltd., confirming 21k (0.875 fineness). Crafted exclusively from premium ARY GOLD.";
    
    doc.setLineWidth(0.2);
    doc.line(margin, footerStartY - 10, pageWidth - margin, footerStartY - 10);
    doc.setFontSize(8).setTextColor(150);
    doc.text(guaranteesText, margin, footerStartY, { maxWidth: pageWidth - margin * 2 - 70 });
    
    const contacts = [
        { name: "Murtaza", number: "0333 2275190" }, { name: "Muhammad", number: "0300 8280896" },
        { name: "Huzaifa", number: "0335 2275553" }, { name: "Ammar", number: "0326 2275554" },
    ];
    let contactY = footerStartY + 12;
    doc.setFontSize(8).setFont("helvetica", "bold").setTextColor(50);
    doc.text("For Orders & Inquiries:", margin, contactY);
    contactY += 4;
    doc.setFont("helvetica", "normal").setTextColor(100);
    contacts.forEach(contact => {
        doc.text(`${contact.name}: ${contact.number}`, margin, contactY);
        contactY += 4;
    });

    const qrCodeSize = 25;
    const qrSectionWidth = (qrCodeSize * 2) + 15;
    const qrStartX = pageWidth - margin - qrSectionWidth;

    const instaQrCanvas = document.getElementById('insta-qr-code') as HTMLCanvasElement;
    const waQrCanvas = document.getElementById('wa-qr-code') as HTMLCanvasElement;

    if (instaQrCanvas) {
        doc.setFontSize(8); doc.setFont("helvetica", "bold").setTextColor(0);
        doc.text("@collectionstaheri", qrStartX + qrCodeSize/2, footerStartY - 2, { align: 'center'});
        doc.addImage(instaQrCanvas.toDataURL('image/png'), 'PNG', qrStartX, footerStartY, qrCodeSize, qrCodeSize);
    }
    if (waQrCanvas) {
        const secondQrX = qrStartX + qrCodeSize + 15;
        doc.setFontSize(8); doc.setFont("helvetica", "bold").setTextColor(0);
        doc.text("Join on WhatsApp", secondQrX + qrCodeSize/2, footerStartY - 2, { align: 'center'});
        doc.addImage(waQrCanvas.toDataURL('image/png'), 'PNG', secondQrX, footerStartY, qrCodeSize, qrCodeSize);
    }
    
    doc.save(`Estimate-${invoice.id}.pdf`);
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

  // Use a temporary render of the QR codes to generate the data URL for the PDF
  if (typeof window !== 'undefined') {
    setTimeout(() => {
        if (document.getElementById('insta-qr-code')) {
            // QR codes are in the DOM, safe to call print
        }
    }, 100);
  }

  return (
    <div className="bg-muted min-h-screen p-4 sm:p-8">
      <div style={{ display: 'none' }}>
        <QRCode id="insta-qr-code" value="https://www.instagram.com/collectionstaheri?igsh=bWs4YWgydjJ1cXBz&utm_source=qr" size={128} />
        <QRCode id="wa-qr-code" value="https://chat.whatsapp.com/HMeoF0Zcl0i9XobLspaCWl?mode=ac_t" size={128} />
      </div>

        <Card className="max-w-4xl mx-auto shadow-2xl">
            <CardHeader>
                 <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-primary">{settings?.shopName || 'Estimate'}</h1>
                        <p className="text-muted-foreground">Estimate #{invoice.id}</p>
                    </div>
                     <Button onClick={handlePrint} disabled={!settings}>
                        <Download className="mr-2 h-4 w-4" /> Download PDF
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <iframe src={doc.output('bloburl')} style={{width: '100%', height: '80vh', border: 'none'}} title={`Invoice ${invoice.id}`}></iframe>
            </CardContent>
        </Card>
         <footer className="text-center mt-8 text-sm text-muted-foreground">
            <p>Thank you for your business!</p>
            {settings?.shopContact && <p>{settings.shopContact}</p>}
        </footer>
    </div>
  );
}

    