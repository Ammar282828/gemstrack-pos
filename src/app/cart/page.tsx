

"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAppStore, Customer, Settings, InvoiceItem, Invoice as InvoiceType, calculateProductCosts, Product, MetalType } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Plus, Minus, ShoppingCart, FileText, Printer, User, XCircle, Settings as SettingsIcon, Percent, Info, Loader2, MessageSquare, Check, Banknote, Edit, ArrowLeft, PlusCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import QRCode from 'qrcode.react';
import PhoneInput from 'react-phone-number-input/react-hook-form-input';
import 'react-phone-number-input/style.css'
import { Control, useForm } from 'react-hook-form';
import { useSearchParams } from 'next/navigation';
import { ProductForm } from '@/components/product/product-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: {
      finalY?: number;
    };
  }
}

type RateInputs = {
    gold: string;
    palladium: string;
    platinum: string;
    silver: string;
};

const WALK_IN_CUSTOMER_VALUE = "__WALK_IN__";

// A temporary structure to hold the real-time calculated invoice preview
type EstimatedInvoice = {
    subtotal: number;
    grandTotal: number;
    items: (InvoiceItem & { originalPrice: number })[];
};

type PhoneForm = {
    phone: string;
};

export default function CartPage() {
  console.log("[GemsTrack] CartPage: Rendering START");
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const preloadedInvoiceId = searchParams.get('invoice_id');

  const appReady = useAppReady();
  const cartItemsFromStore = useAppStore(state => state.cart); // Now holds full Product objects
  const customers = useAppStore(state => state.customers);
  const settings = useAppStore(state => state.settings);
  const allInvoices = useAppStore(state => state.generatedInvoices);
  const { removeFromCart, clearCart, generateInvoice: generateInvoiceAction, addHisaabEntry, updateInvoicePayment, loadCartFromInvoice, deleteInvoice, updateCartItem, updateSettings } = useAppStore();

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);
  const [walkInCustomerName, setWalkInCustomerName] = useState('');
  const [walkInCustomerPhone, setWalkInCustomerPhone] = useState('');
  const [generatedInvoice, setGeneratedInvoice] = useState<InvoiceType | null>(null);
  
  const [rateInputs, setRateInputs] = useState<RateInputs>({
    gold: '', palladium: '', platinum: '', silver: ''
  });
  
  const [discountAmountInput, setDiscountAmountInput] = useState<string>('0');
  
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isEditingEstimate, setIsEditingEstimate] = useState(false);
  
  const [editingCartItem, setEditingCartItem] = useState<Product | undefined>(undefined);
  const [isNewProductDialogOpen, setIsNewProductDialogOpen] = useState(false);


  const phoneForm = useForm<PhoneForm>();
  
  useEffect(() => {
    if (preloadedInvoiceId && !isEditingEstimate) {
        const invoice = allInvoices.find(inv => inv.id === preloadedInvoiceId);
        if (invoice) {
            setGeneratedInvoice(invoice);
             // Since we are loading a finalized invoice, we don't need the cart
            clearCart();
        }
    }
  }, [preloadedInvoiceId, allInvoices, clearCart, isEditingEstimate]);


  useEffect(() => {
    if (appReady && settings && !isEditingEstimate) {
      setRateInputs({
        gold: (settings.goldRatePerGram * (21/24)).toFixed(2),
        palladium: (settings.palladiumRatePerGram || 0).toFixed(2),
        platinum: (settings.platinumRatePerGram || 0).toFixed(2),
        silver: (settings.silverRatePerGram || 0).toFixed(2),
      });
    } else if (appReady) {
      setRateInputs({ gold: "0", palladium: "0", platinum: "0", silver: "0" });
    }
  }, [appReady, settings, isEditingEstimate]);
  
  const cartMetalTypes = useMemo(() => {
    return new Set(cartItemsFromStore.map(item => item.metalType));
  }, [cartItemsFromStore]);

  const handleRateChange = (metal: keyof RateInputs, value: string) => {
    setRateInputs(prev => ({ ...prev, [metal]: value }));
  };

  
  const estimatedInvoice = useMemo((): EstimatedInvoice | null => {
    if (!appReady || !settings || cartItemsFromStore.length === 0) return null;
    
    const parsedGoldRate21k = parseFloat(rateInputs.gold);
    if (cartMetalTypes.has('gold') && (isNaN(parsedGoldRate21k) || parsedGoldRate21k <= 0)) {
        return null;
    }
    
    const goldRate24k = parsedGoldRate21k * (24 / 21);

    const ratesForCalc = {
        goldRatePerGram24k: goldRate24k || 0,
        palladiumRatePerGram: parseFloat(rateInputs.palladium) || settings.palladiumRatePerGram || 0,
        platinumRatePerGram: parseFloat(rateInputs.platinum) || settings.platinumRatePerGram || 0,
        silverRatePerGram: parseFloat(rateInputs.silver) || settings.silverRatePerGram || 0,
    };
    
    let currentSubtotal = 0;
    const estimatedItems: EstimatedInvoice['items'] = [];

    cartItemsFromStore.forEach(cartItem => {
        const costs = calculateProductCosts(cartItem, ratesForCalc);
        const itemTotal = costs.totalPrice; // Quantity is always 1
        currentSubtotal += itemTotal;
        
        estimatedItems.push({
            sku: cartItem.sku,
            name: cartItem.name,
            categoryId: cartItem.categoryId,
            metalType: cartItem.metalType,
            karat: cartItem.karat,
            metalWeightG: cartItem.metalWeightG || 0,
            stoneWeightG: cartItem.stoneWeightG,
            quantity: 1,
            unitPrice: itemTotal,
            itemTotal: itemTotal,
            metalCost: costs.metalCost,
            wastageCost: costs.wastageCost,
            wastagePercentage: cartItem.wastagePercentage,
            makingCharges: costs.makingCharges,
            diamondChargesIfAny: costs.diamondCharges,
            stoneChargesIfAny: costs.stoneCharges,
            miscChargesIfAny: costs.miscCharges,
            originalPrice: itemTotal,
        });
    });

    const parsedDiscountAmount = parseFloat(discountAmountInput) || 0;
    const grandTotal = currentSubtotal - parsedDiscountAmount;

    return {
        subtotal: currentSubtotal,
        grandTotal: grandTotal,
        items: estimatedItems,
    };
  }, [appReady, settings, cartItemsFromStore, rateInputs, discountAmountInput, cartMetalTypes]);


  const handleGenerateInvoice = async () => {
    if (cartItemsFromStore.length === 0) {
      toast({ title: "Cart Empty", description: "Cannot generate estimate for an empty cart.", variant: "destructive" });
      return;
    }
    
    if (!estimatedInvoice) {
        toast({ title: "Invalid Input", description: "Please ensure all rates and values are correct before generating the estimate.", variant: "destructive" });
        return;
    }
    
    const isWalkIn = selectedCustomerId === undefined || selectedCustomerId === WALK_IN_CUSTOMER_VALUE;
    if (isWalkIn && !walkInCustomerName.trim()) {
        toast({ title: "Customer Name Required", description: "Please enter a name for the walk-in customer.", variant: "destructive" });
        return;
    }

    const parsedGoldRate21k = parseFloat(rateInputs.gold);
    const goldRate24kForInvoice = parsedGoldRate21k * (24 / 21);
    const parsedDiscountAmount = parseFloat(discountAmountInput) || 0;

    if (cartMetalTypes.has('gold') && (isNaN(parsedGoldRate21k) || parsedGoldRate21k <= 0)) {
      toast({ title: "Invalid Gold Rate", description: "Please enter a valid positive 21k gold rate for gold items.", variant: "destructive" });
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

    // Persist rate changes to settings
    const updatedRateSettings: Partial<Settings> = {
      goldRatePerGram: goldRate24kForInvoice,
      palladiumRatePerGram: parseFloat(rateInputs.palladium) || settings.palladiumRatePerGram,
      platinumRatePerGram: parseFloat(rateInputs.platinum) || settings.platinumRatePerGram,
      silverRatePerGram: parseFloat(rateInputs.silver) || settings.silverRatePerGram,
    };
    await updateSettings(updatedRateSettings);
    toast({ title: "Rates Updated", description: "Store metal rates have been updated with the values from this estimate."});

    const customerForInvoice = isWalkIn
        ? { name: walkInCustomerName, phone: walkInCustomerPhone }
        : { id: selectedCustomerId, name: customers.find(c => c.id === selectedCustomerId)?.name || '' };
    
    const invoiceAction = isEditingEstimate && generatedInvoice ? deleteInvoice : generateInvoiceAction;
    if(isEditingEstimate && generatedInvoice) {
        await deleteInvoice(generatedInvoice.id, true); // Soft delete
    }

    const invoice = await generateInvoiceAction(customerForInvoice, goldRate24kForInvoice, parsedDiscountAmount);
    
    if (invoice) {
      setGeneratedInvoice(invoice);
       // Pre-fill WhatsApp number if a customer with a phone number is selected
      if(invoice.customerId) {
        const customer = customers.find(c => c.id === invoice.customerId);
        if(customer?.phone) {
          phoneForm.setValue('phone', customer.phone);
        }
      } else if (walkInCustomerPhone) {
        phoneForm.setValue('phone', walkInCustomerPhone);
      }
      setIsEditingEstimate(false);
      toast({ title: "Estimate Generated", description: `Estimate ${invoice.id} created successfully.` });
    } else {
      toast({ title: "Estimate Generation Failed", description: "Could not generate the estimate. Please check inputs and logs.", variant: "destructive" });
    }
  };

  const handleEditEstimate = () => {
    if (!generatedInvoice) return;
    setIsEditingEstimate(true);
    loadCartFromInvoice(generatedInvoice);
    setSelectedCustomerId(generatedInvoice.customerId || WALK_IN_CUSTOMER_VALUE);
    if (!generatedInvoice.customerId) {
        setWalkInCustomerName(generatedInvoice.customerName || '');
    }
    setRateInputs({
      gold: ((generatedInvoice.goldRateApplied || 0) * (21/24)).toFixed(2),
      palladium: (generatedInvoice.palladiumRateApplied || settings.palladiumRatePerGram || 0).toFixed(2),
      platinum: (generatedInvoice.platinumRateApplied || settings.platinumRatePerGram || 0).toFixed(2),
      silver: (settings.silverRatePerGram || 0).toFixed(2),
    });
    setDiscountAmountInput(String(generatedInvoice.discountAmount));
    setGeneratedInvoice(null);
  };


  const handleSendWhatsApp = (invoiceToSend: InvoiceType) => {
    const whatsAppNumber = phoneForm.getValues('phone');
    if (!whatsAppNumber) {
      toast({ title: "No Phone Number", description: "Please enter a customer's phone number.", variant: "destructive" });
      return;
    }
    
    const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://gemstrack-pos.web.app';
    const invoiceUrl = `${appUrl}/view-invoice/${invoiceToSend.id}`;

    let message = `Dear ${invoiceToSend.customerName || 'Customer'},\n\n`;
    message += `Here is your updated estimate from ${settings.shopName}.\n\n`;
    message += `*Estimate ID:* ${invoiceToSend.id}\n`;
    message += `*Total Amount:* PKR ${invoiceToSend.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
    if (invoiceToSend.amountPaid > 0) {
      message += `*Amount Paid:* PKR ${invoiceToSend.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
      message += `*Balance Due:* PKR ${invoiceToSend.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    } else {
      message += `*Amount Due:* PKR ${invoiceToSend.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    }
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
                doc.addImage(logoUrl, 'PNG', margin, 15, 40, 10, undefined, 'FAST');
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

        const metalDisplay = `${item.metalType.charAt(0).toUpperCase() + item.metalType.slice(1)}${item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : ''}, Wt: item.metalWeightG.toFixed(2)}g`;
        
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
        didDrawPage: (data: { pageNumber: number, settings: { startY: number } }) => {
             // Reset startY for new pages
            if (data.pageNumber > 1) {
                doc.setPage(data.pageNumber);
                data.settings.startY = 40; 
            }
            drawHeader(data.pageNumber);
        },
    });

    let finalY = doc.lastAutoTable.finalY || 0;
    
    const footerAndTotalsHeight = 85; // Combined estimated height
    let needsNewPage = finalY + footerAndTotalsHeight > pageHeight - margin;

    if (needsNewPage) {
        doc.addPage();
        drawHeader(doc.getNumberOfPages());
        finalY = 40; 
    }

    let currentY = finalY + 10;
    const totalsX = pageWidth - margin;

    doc.setFontSize(10).setFont("helvetica", "normal").setTextColor(0);
    doc.text(`Subtotal:`, totalsX - 60, currentY, { align: 'right' });
    doc.text(`PKR ${invoiceToPrint.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;

    doc.setFont("helvetica", "bold").setTextColor(220, 53, 69);
    doc.text(`Discount:`, totalsX - 60, currentY, { align: 'right' });
    doc.text(`- PKR ${invoiceToPrint.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;
    
    doc.setFont("helvetica", "normal").setTextColor(0);
    doc.setLineWidth(0.3);
    doc.line(totalsX - 60, currentY, totalsX, currentY);
    currentY += 8;
    
    doc.setFontSize(12).setFont("helvetica", "bold");
    doc.text(`Grand Total:`, totalsX - 60, currentY, { align: 'right' });
    doc.text(`PKR ${invoiceToPrint.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 8;

    if (invoiceToPrint.amountPaid > 0) {
        doc.setFontSize(10).setFont("helvetica", "normal");
        doc.text(`Amount Paid:`, totalsX - 60, currentY, { align: 'right' });
        doc.text(`- PKR ${invoiceToPrint.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
        currentY += 8;
        
        doc.setFontSize(14).setFont("helvetica", "bold");
        doc.text(`Balance Due:`, totalsX - 60, currentY, { align: 'right' });
        doc.text(`PKR ${invoiceToPrint.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    }

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
    setIsEditingEstimate(false);
    if (settings) {
        setRateInputs({
            gold: (settings.goldRatePerGram * (21/24)).toFixed(2),
            palladium: (settings.palladiumRatePerGram || 0).toFixed(2),
            platinum: (settings.platinumRatePerGram || 0).toFixed(2),
            silver: (settings.silverRatePerGram || 0).toFixed(2),
        });
    } else {
        setRateInputs({ gold: "0", palladium: "0", platinum: "0", silver: "0" });
    }
    setDiscountAmountInput('0');
  }

  const handleRecordPayment = async (amount: number, isFullPayment: boolean = false) => {
    if (!generatedInvoice) return;
    
    const paymentAmountToRecord = isFullPayment ? generatedInvoice.balanceDue : amount;

    if (paymentAmountToRecord <= 0) {
        toast({ title: "Invalid Amount", description: "Payment amount must be positive.", variant: "destructive"});
        return;
    }

    setIsSubmittingPayment(true);
    
    try {
        const updatedInvoice = await updateInvoicePayment(generatedInvoice.id, paymentAmountToRecord);

        // Also add a corresponding entry to the general hisaab ledger
        const paymentEntry = {
            entityId: generatedInvoice.customerId || 'walk-in',
            entityType: 'customer' as const,
            entityName: generatedInvoice.customerName || 'Walk-in Customer',
            date: new Date().toISOString(),
            description: `Payment for Invoice ${generatedInvoice.id}`,
            cashDebit: 0,
            cashCredit: paymentAmountToRecord, // Money received from customer
            goldDebitGrams: 0,
            goldCreditGrams: 0,
        };
        await addHisaabEntry(paymentEntry);

        toast({ title: "Payment Recorded", description: `PKR ${paymentAmountToRecord.toLocaleString()} recorded for invoice ${generatedInvoice.id}` });
        
        // Update the local state to reflect the change immediately
        if (updatedInvoice) {
            setGeneratedInvoice(updatedInvoice);
        }
        setPaymentAmount(''); // Clear input after successful payment

        // If the balance is now zero or less, we can reset for a new sale
        if (updatedInvoice && updatedInvoice.balanceDue <= 0) {
            // Delay the reset to allow user to see the zero balance and print the final paid invoice
            setTimeout(() => handleNewSale(), 3000);
        }

    } catch (e) {
        toast({ title: "Error", description: "Failed to record payment.", variant: "destructive" });
        console.error("Error recording payment:", e);
    } finally {
        setIsSubmittingPayment(false);
    }
  };


  if (!appReady) {
    console.log("[GemsTrack] CartPage: App not ready, rendering loading message.");
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading cart...</p>
      </div>
    );
  }

  if (generatedInvoice && !isEditingEstimate) {
    const isFullyPaid = generatedInvoice.balanceDue <= 0;
    return (
        <div className="container mx-auto py-8 px-4">
            <Card>
                <CardHeader>
                    <div className="flex justify-between items-start flex-wrap gap-4">
                        <div>
                        <CardTitle className="text-2xl text-primary flex items-center">
                            <Check className="mr-3 h-8 w-8 text-green-500 bg-green-100 rounded-full p-1" />
                            Invoice {isFullyPaid ? 'Paid' : 'Generated'}: {generatedInvoice.id}
                        </CardTitle>
                        <CardDescription>
                            Invoice for {generatedInvoice.customerName || "Walk-in Customer"}. Now, record payments received.
                        </CardDescription>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={handleEditEstimate}>
                                <Edit className="mr-2 h-4 w-4"/> Edit Estimate
                            </Button>
                            <Button variant="outline" size="sm" onClick={handleNewSale}>
                                <ArrowLeft className="mr-2 h-4 w-4"/> New Sale
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                        <div className="p-3 bg-muted rounded-md">
                            <p className="text-sm text-muted-foreground">Total Amount</p>
                            <p className="text-2xl font-bold">PKR {generatedInvoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                         <div className="p-3 bg-muted rounded-md">
                            <p className="text-sm text-muted-foreground">Amount Paid</p>
                            <p className="text-2xl font-bold text-green-600">PKR {generatedInvoice.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                         <div className="p-3 bg-primary/10 rounded-md">
                            <p className="text-sm text-primary">Balance Due</p>
                            <p className="text-2xl font-bold text-primary">PKR {generatedInvoice.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                    </div>
                    <Separator />

                    {!isFullyPaid && (
                        <div className="space-y-4">
                            <Label htmlFor="payment-amount" className="font-semibold">Record Payment Received</Label>
                            <div className="flex flex-col sm:flex-row items-center gap-2">
                                <Input 
                                    id="payment-amount"
                                    type="number"
                                    placeholder="Enter amount received"
                                    value={paymentAmount}
                                    onChange={(e) => setPaymentAmount(e.target.value)}
                                    className="text-lg h-12 flex-grow"
                                    disabled={isSubmittingPayment}
                                />
                                <Button 
                                    onClick={() => handleRecordPayment(parseFloat(paymentAmount))}
                                    disabled={isSubmittingPayment || !paymentAmount || parseFloat(paymentAmount) <= 0}
                                    className="h-12 w-full sm:w-auto"
                                >
                                    {isSubmittingPayment ? <Loader2 className="animate-spin" /> : <Banknote className="mr-2"/>}
                                    Record
                                </Button>
                            </div>
                            <Button 
                                onClick={() => handleRecordPayment(0, true)}
                                disabled={isSubmittingPayment}
                                variant="default"
                                size="lg"
                                className="w-full"
                            >
                                {isSubmittingPayment ? <Loader2 className="animate-spin" /> : <Check className="mr-2"/>}
                                Mark as Fully Paid (Pay PKR {generatedInvoice.balanceDue.toLocaleString()})
                            </Button>
                        </div>
                    )}
                     
                     <Separator />
                    <div className="p-4 border rounded-lg bg-muted/50">
                        <Label htmlFor="whatsapp-number">Send Updated Estimate to Customer via WhatsApp</Label>
                        <div className="flex gap-2 mt-2">
                             <PhoneInput
                                name="phone"
                                countryCallingCodeEditable={false}
                                control={phoneForm.control as unknown as Control}
                                defaultCountry="PK"
                                international
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                            />
                             <Button onClick={() => handleSendWhatsApp(generatedInvoice)}>
                                <MessageSquare className="mr-2 h-4 w-4"/>
                                Send 
                             </Button>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end space-x-2">
                    <Button onClick={() => {
                        if (typeof window !== 'undefined') {
                            printInvoice(generatedInvoice);
                        }
                    }}><Printer className="mr-2 h-4 w-4"/> Print Updated Invoice</Button>
                </CardFooter>
            </Card>
            <div style={{ display: 'none' }}>
                <QRCode id="insta-qr-code" value="https://www.instagram.com/collectionstaheri?igsh=bWs4YWgydjJ1cXBz&utm_source=qr" size={128} />
                <QRCode id="wa-qr-code" value="https://chat.whatsapp.com/HMeoF0Zcl0i9XobLspaCWl?mode=ac_t" size={128} />
            </div>
        </div>
    );
  }

  const handleUpdateCartItem = (sku: string, updatedData: Partial<Product>) => {
    updateCartItem(sku, updatedData);
    setEditingCartItem(undefined);
    toast({ title: "Item Updated", description: "Cart item details have been saved for this sale."});
  }

  console.log("[GemsTrack] CartPage: About to return main cart view JSX. appReady:", appReady, "GeneratedInvoice exists:", !!generatedInvoice);
  return (
    <div className="container mx-auto py-8 px-4">
       {editingCartItem && (
        <Dialog open={!!editingCartItem} onOpenChange={(isOpen) => !isOpen && setEditingCartItem(undefined)}>
            <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Edit Cart Item: {editingCartItem.name}</DialogTitle>
                    <DialogDescription>
                        Changes made here will only apply to this specific sale and will not affect the master product record.
                    </DialogDescription>
                </DialogHeader>
                 <ProductForm 
                    product={editingCartItem} 
                    isCartEditMode={true}
                    onCartItemSubmit={handleUpdateCartItem}
                 />
            </DialogContent>
        </Dialog>
      )}
      <Dialog open={isNewProductDialogOpen} onOpenChange={setIsNewProductDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Create New Product</DialogTitle>
            <DialogDescription>Add a new item to your inventory. It will not be added to the current cart automatically.</DialogDescription>
          </DialogHeader>
          <ProductForm />
        </DialogContent>
      </Dialog>

      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
            <h1 className="text-3xl font-bold text-primary">Shopping Cart &amp; Estimate</h1>
            <p className="text-muted-foreground">Review items, set estimate parameters, and generate an estimate.</p>
        </div>
        <Button onClick={() => setIsNewProductDialogOpen(true)}>
            <PlusCircle className="mr-2 h-5 w-5" />
            Create New Product
        </Button>
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
                          <p className="text-xs text-muted-foreground">Metal: {item.metalType}{item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : ''}, Wt: {(Number(item.metalWeightG) || 0).toFixed(2)}g</p>
                           {estimatedInvoice?.items.find(i => i.sku === item.sku)?.unitPrice !== 0 ? (
                                <>
                                 <p className="text-sm font-semibold text-primary">PKR {estimatedInvoice?.items.find(i => i.sku === item.sku)?.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }) || '...'}</p>
                                </>
                           ) : (
                             <p className="text-sm font-semibold text-primary">PKR ...</p>
                           )}
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-center">
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingCartItem(item)}
                            >
                                <Edit className="h-4 w-4 mr-2" /> Edit
                            </Button>
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
                  <Label htmlFor="customer-select" className="mb-1 block text-sm font-medium">Select Customer</Label>
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
                {(selectedCustomerId === undefined || selectedCustomerId === WALK_IN_CUSTOMER_VALUE) && (
                    <div className="space-y-4 pt-2">
                        <div>
                            <Label htmlFor="walk-in-name">Walk-in Customer Name</Label>
                            <Input id="walk-in-name" value={walkInCustomerName} onChange={(e) => setWalkInCustomerName(e.target.value)} placeholder="e.g., John Doe" />
                        </div>
                        <div>
                            <Label htmlFor="walk-in-phone">Walk-in Customer Phone (Optional)</Label>
                            <Input id="walk-in-phone" value={walkInCustomerPhone} onChange={(e) => setWalkInCustomerPhone(e.target.value)} placeholder="e.g., 03001234567" />
                        </div>
                    </div>
                )}
                <Separator />
                 <div>
                    <Label className="flex items-center mb-2 text-sm font-medium">
                        <SettingsIcon className="w-4 h-4 mr-1 text-muted-foreground" />
                        Metal Rates for this Estimate (PKR/gram)
                    </Label>
                    <div className="space-y-3">
                        {cartMetalTypes.has('gold') && (
                        <div>
                            <Label htmlFor="invoice-gold-rate" className="text-xs">Gold (21k)</Label>
                            <Input id="invoice-gold-rate" type="number" value={rateInputs.gold} onChange={(e) => handleRateChange('gold', e.target.value)} placeholder="e.g., 175000" step="0.01"/>
                        </div>
                        )}
                        {cartMetalTypes.has('palladium') && (
                        <div>
                            <Label htmlFor="invoice-palladium-rate" className="text-xs">Palladium</Label>
                            <Input id="invoice-palladium-rate" type="number" value={rateInputs.palladium} onChange={(e) => handleRateChange('palladium', e.target.value)} placeholder="e.g., 8000" step="0.01"/>
                        </div>
                        )}
                        {cartMetalTypes.has('platinum') && (
                        <div>
                            <Label htmlFor="invoice-platinum-rate" className="text-xs">Platinum</Label>
                            <Input id="invoice-platinum-rate" type="number" value={rateInputs.platinum} onChange={(e) => handleRateChange('platinum', e.target.value)} placeholder="e.g., 12000" step="0.01"/>
                        </div>
                        )}
                        {cartMetalTypes.has('silver') && (
                        <div>
                            <Label htmlFor="invoice-silver-rate" className="text-xs">Silver</Label>
                            <Input id="invoice-silver-rate" type="number" value={rateInputs.silver} onChange={(e) => handleRateChange('silver', e.target.value)} placeholder="e.g., 250" step="0.01"/>
                        </div>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">These rates will be used for this invoice and will update the store's default rates upon generation.</p>
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
                  <FileText className="mr-2 h-5 w-5" /> {isEditingEstimate ? 'Update & Finalize Invoice' : 'Generate Invoice'}
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
