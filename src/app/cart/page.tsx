
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
import { Trash2, Plus, Minus, ShoppingCart, FileText, Printer, User, XCircle, Settings as SettingsIcon, Percent, Info, Loader2, MessageSquare } from 'lucide-react';
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
    lastAutoTable: {
      finalY?: number;
    };
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
  const [whatsAppNumber, setWhatsAppNumber] = useState('');
  
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
        return null; // Don't calculate if gold rate is invalid for a cart with a gold items
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
       // Pre-fill WhatsApp number if a customer with a phone number is selected
      if(invoice.customerId) {
        const customer = customers.find(c => c.id === invoice.customerId);
        if(customer?.phone) {
          setWhatsAppNumber(customer.phone);
        }
      }
      toast({ title: "Estimate Generated", description: `Estimate ${invoice.id} created successfully.` });
    } else {
      toast({ title: "Estimate Generation Failed", description: "Could not generate the estimate. Please check inputs and logs.", variant: "destructive" });
    }
  };

  const handleSendWhatsApp = (invoiceToSend: InvoiceType) => {
    if (!whatsAppNumber) {
      toast({ title: "No Phone Number", description: "Please enter a customer's phone number.", variant: "destructive" });
      return;
    }
    
    // Use the actual origin of the window to build the link
    const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://gemstrack-pos.web.app';
    const invoiceUrl = `${appUrl}/view-invoice/${invoiceToSend.id}`;

    let message = `Dear ${invoiceToSend.customerName || 'Customer'},\n\n`;
    message += `Here is your estimate from ${settings.shopName}.\n\n`;
    message += `*Estimate ID:* ${invoiceToSend.id}\n`;
    message += `*Amount Due:* PKR ${invoiceToSend.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    message += `You can view the detailed estimate PDF here:\n${invoiceUrl}\n\n`;
    message += `Thank you for your business!`;

    const numberOnly = whatsAppNumber.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${numberOnly}?text=${encodeURIComponent(message)}`;

    window.open(whatsappUrl, '_blank');
    toast({ title: "Redirecting to WhatsApp", description: "Your message is ready to be sent." });
  };


  const printInvoice = (invoiceToPrint: InvoiceType) => {
    if (typeof window === 'undefined') {
      toast({ title: "Error", description: "PDF generation is only available in the browser.", variant: "destructive" });
      return;
    }

    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    const logoUrl = settings.shopLogoUrlBlack;

    function drawHeader(pageNum: number) {
        if (logoUrl) {
            try {
                // Ensure image is loaded before adding to prevent errors
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
    if (invoiceToPrint.customerId && invoiceToPrint.customerName) {
        const customer = customers.find(c => c.id === invoiceToPrint.customerId);
        customerInfo = `${invoiceToPrint.customerName}\n`;
        if (customer?.address) customerInfo += `${customer.address}\n`;
        if (customer?.phone) customerInfo += `Phone: ${customer.phone}\n`;
        if (customer?.email) customerInfo += `Email: ${customer.email}`;
    }
    doc.text(customerInfo, margin, infoY, { lineHeightFactor: 1.5 });

    let invoiceDetails = `Estimate #: ${invoiceToPrint.id}\n`;
    invoiceDetails += `Date: ${new Date(invoiceToPrint.createdAt).toLocaleDateString()}`;
    doc.text(invoiceDetails, pageWidth / 2, infoY, { lineHeightFactor: 1.5 });

    let ratesApplied = [];
    if (invoiceToPrint.goldRateApplied) {
        const goldRate21k = invoiceToPrint.goldRateApplied * (21 / 24);
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

    invoiceToPrint.items.forEach((item, index) => {
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
                // Reset startY for new pages
                data.settings.startY = 40; 
                drawHeader(data.pageNumber);
            } else {
                drawHeader(data.pageNumber);
            }
        },
    });

    let finalY = doc.lastAutoTable.finalY || 0;
    
    const footerAndTotalsHeight = 75; // Combined estimated height
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
    doc.text(`PKR ${invoiceToPrint.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;

    doc.setFont("helvetica", "bold").setTextColor(220, 53, 69);
    doc.text(`Discount:`, totalsX - 40, currentY, { align: 'right' });
    doc.text(`- PKR ${invoiceToPrint.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;
    doc.setFont("helvetica", "normal").setTextColor(0); // Reset color
    
    doc.setLineWidth(0.5);
    doc.line(totalsX - 60, currentY, totalsX, currentY);
    currentY += 8;
    
    doc.setFontSize(14).setFont("helvetica", "bold");
    doc.text(`Grand Total:`, totalsX - 60, currentY, { align: 'right' });
    doc.text(`PKR ${invoiceToPrint.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });

    const footerStartY = pageHeight - 45;
    const guaranteesText = "Gold used is independently tested & verified by Swiss Lab Ltd., confirming 21k (0.875 fineness). Crafted exclusively from premium ARY GOLD.";
    
    doc.setLineWidth(0.2);
    doc.line(margin, footerStartY - 10, pageWidth - margin, footerStartY - 10);
    doc.setFontSize(8).setTextColor(150);
    doc.text(guaranteesText, margin, footerStartY, { maxWidth: pageWidth - margin * 2 - 70 });
    
    // Contacts section
    const contacts = [
        { name: "Murtaza", number: "0333 2275190" },
        { name: "Muhammad", number: "0300 8280896" },
        { name: "Huzaifa", number: "0335 2275553" },
        { name: "Ammar", number: "0326 2275554" },
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

    // QR Codes
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
    

    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
    toast({ title: "Estimate Printing", description: "Modern estimate PDF sent to print dialog." });
  };
  

  const handleNewSale = () => {
    setGeneratedInvoice(null);
    clearCart();
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
                        <ScrollArea className="w-full" type="auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Product &amp; Breakdown</TableHead>
                                    <TableHead className="text-right">Qty</TableHead>
                                    <TableHead className="text-right">Unit Price</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {generatedInvoice.items.map(item => {
                                    let breakdownLines = [];
                                    if (item.metalCost > 0) breakdownLines.push(`Metal: ${item.metalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.wastageCost > 0) breakdownLines.push(`+ Wastage (${item.wastagePercentage}%): ${item.wastageCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.makingCharges > 0) breakdownLines.push(`+ Making: ${item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.diamondChargesIfAny > 0) breakdownLines.push(`+ Diamonds: ${item.diamondChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.stoneChargesIfAny > 0) breakdownLines.push(`+ Stones: ${item.stoneChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    if (item.miscChargesIfAny > 0) breakdownLines.push(`+ Misc: ${item.miscChargesIfAny.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
                                    
                                    const breakdownText = breakdownLines.join(' / ');

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
                                        <TableCell className="text-right">{item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className="text-right">{item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    </TableRow>
                                );
                            })}
                            </TableBody>
                        </Table>
                        </ScrollArea>
                    </div>
                    <div className="text-right mt-4 space-y-1">
                        <p>Subtotal: <span className="font-semibold">PKR {generatedInvoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p>
                        <p>Discount: <span className="font-semibold text-destructive">- PKR {generatedInvoice.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p>
                        <p className="text-xl font-bold">Grand Total: <span className="text-primary">PKR {generatedInvoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></p>
                    </div>
                    <Separator className="my-6"/>
                    <div className="p-4 border rounded-lg bg-muted/50">
                        <Label htmlFor="whatsapp-number">Send Estimate to Customer via WhatsApp</Label>
                        <div className="flex gap-2 mt-2">
                             <Input 
                                id="whatsapp-number"
                                type="tel"
                                placeholder="Customer's phone number, e.g. +15551234567"
                                value={whatsAppNumber}
                                onChange={(e) => setWhatsAppNumber(e.target.value)}
                             />
                             <Button onClick={() => handleSendWhatsApp(generatedInvoice)}>
                                <MessageSquare className="mr-2 h-4 w-4"/>
                                Send
                             </Button>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={handleNewSale}>New Sale / Clear</Button>
                    <Button onClick={() => {
                        if (typeof window !== 'undefined') {
                            printInvoice(generatedInvoice);
                        }
                    }}><Printer className="mr-2 h-4 w-4"/> Print Estimate</Button>
                </CardFooter>
            </Card>
            <div style={{ display: 'none' }}>
                <QRCode id="insta-qr-code" value="https://www.instagram.com/collectionstaheri?igsh=bWs4YWgydjJ1cXBz&utm_source=qr" size={128} />
                <QRCode id="wa-qr-code" value="https://chat.whatsapp.com/HMeoF0Zcl0i9XobLspaCWl?mode=ac_t" size={128} />
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
                      <div key={item.sku} className="flex flex-col sm:flex-row items-start sm:items-center space-y-3 sm:space-y-0 sm:space-x-4 p-3 border rounded-md">
                        <Image
                          src={item.imageUrl || `https://placehold.co/80x80.png?text=${encodeURIComponent(item.name?.substring(0,1) || 'P')}`}
                          alt={item.name || 'Product Image'}
                          width={60}
                          height={60}
                          className="rounded-md object-cover border flex-shrink-0"
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
                        <div className="flex items-center space-x-2 self-end sm:self-center">
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
                          className="text-destructive hover:text-destructive hover:bg-destructive/10 self-end sm:self-center"
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
                            Palladium and Platinum items in this cart will be priced using their current rates from store settings (Pd: {(settings?.palladiumRatePerGram || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) }, Pt: {(settings?.platinumRatePerGram || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) }).
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

    