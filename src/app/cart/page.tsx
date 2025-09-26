

"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAppStore, Customer, Settings, InvoiceItem, Invoice as InvoiceType, calculateProductCosts, Product, MetalType, KaratValue } from '@/lib/store';
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
    gold18k: string;
    gold21k: string;
    gold22k: string;
    gold24k: string;
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
  const { cartItemsFromStore, customers, settings, allInvoices, removeFromCart, clearCart, generateInvoice: generateInvoiceAction, addHisaabEntry, updateInvoicePayment, loadCartFromInvoice, deleteInvoice, updateCartItem, updateSettings, addToCart, loadCustomers, loadGeneratedInvoices } = useAppStore(state => ({
    cartItemsFromStore: state.cart,
    customers: state.customers,
    settings: state.settings,
    allInvoices: state.generatedInvoices,
    removeFromCart: state.removeFromCart,
    clearCart: state.clearCart,
    generateInvoice: state.generateInvoice,
    addHisaabEntry: state.addHisaabEntry,
    updateInvoicePayment: state.updateInvoicePayment,
    loadCartFromInvoice: state.loadCartFromInvoice,
    deleteInvoice: state.deleteInvoice,
    updateCartItem: state.updateCartItem,
    updateSettings: state.updateSettings,
    addToCart: state.addToCart,
    loadCustomers: state.loadCustomers,
    loadGeneratedInvoices: state.loadGeneratedInvoices,
  }));

  useEffect(() => {
    if(appReady) {
      loadCustomers();
      loadGeneratedInvoices();
    }
  }, [appReady, loadCustomers, loadGeneratedInvoices]);


  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);
  const [walkInCustomerName, setWalkInCustomerName] = useState('');
  const [walkInCustomerPhone, setWalkInCustomerPhone] = useState('');
  const [generatedInvoice, setGeneratedInvoice] = useState<InvoiceType | null>(null);
  
  const [rateInputs, setRateInputs] = useState<RateInputs>({
    gold18k: '', gold21k: '', gold22k: '', gold24k: '', palladium: '', platinum: '', silver: ''
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
            if (cartItemsFromStore.length > 0) {
              clearCart();
            }
        }
    }
  }, [preloadedInvoiceId, allInvoices, clearCart, isEditingEstimate, cartItemsFromStore.length]);


  useEffect(() => {
    if (appReady && settings && !isEditingEstimate) {
      setRateInputs({
        gold18k: (settings.goldRatePerGram18k || 0).toFixed(2),
        gold21k: (settings.goldRatePerGram21k || 0).toFixed(2),
        gold22k: (settings.goldRatePerGram22k || 0).toFixed(2),
        gold24k: (settings.goldRatePerGram24k || 0).toFixed(2),
        palladium: (settings.palladiumRatePerGram || 0).toFixed(2),
        platinum: (settings.platinumRatePerGram || 0).toFixed(2),
        silver: (settings.silverRatePerGram || 0).toFixed(2),
      });
    } else if (appReady) {
      setRateInputs({ gold18k: '0', gold21k: '0', gold22k: '0', gold24k: '0', palladium: '0', platinum: '0', silver: '0' });
    }
  }, [appReady, settings, isEditingEstimate]);
  
  const cartMetalInfo = useMemo(() => {
    const metals = new Set<MetalType>();
    const karats = new Set<KaratValue>();
    cartItemsFromStore.forEach(item => {
        metals.add(item.metalType);
        if (item.metalType === 'gold' && item.karat) {
            karats.add(item.karat);
        }
    });
    return { metals, karats };
  }, [cartItemsFromStore]);

  const handleRateChange = (metal: keyof RateInputs, value: string) => {
    setRateInputs(prev => ({ ...prev, [metal]: value }));
  };

  
  const estimatedInvoice = useMemo((): EstimatedInvoice | null => {
    if (!appReady || !settings || cartItemsFromStore.length === 0) return null;
    
    let hasInvalidRate = false;
    cartMetalInfo.karats.forEach(k => {
        const rateKey = `gold${k}` as keyof RateInputs;
        const rate = parseFloat(rateInputs[rateKey]);
        if (isNaN(rate) || rate <= 0) {
            hasInvalidRate = true;
        }
    });

    if (hasInvalidRate) return null;

    const ratesForCalc = {
        goldRatePerGram18k: parseFloat(rateInputs.gold18k) || settings.goldRatePerGram18k,
        goldRatePerGram21k: parseFloat(rateInputs.gold21k) || settings.goldRatePerGram21k,
        goldRatePerGram22k: parseFloat(rateInputs.gold22k) || settings.goldRatePerGram22k,
        goldRatePerGram24k: parseFloat(rateInputs.gold24k) || settings.goldRatePerGram24k,
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
  }, [appReady, settings, cartItemsFromStore, rateInputs, discountAmountInput, cartMetalInfo]);


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
    
    let finalWalkInName = walkInCustomerName.trim();
    if (isWalkIn) {
      if (finalWalkInName === '' && walkInCustomerPhone.trim()) {
        finalWalkInName = `Walk-in Customer - ${walkInCustomerPhone.trim()}`;
      } else if (finalWalkInName === '') {
        finalWalkInName = 'Walk-in Customer';
      }
    }

    const parsedDiscountAmount = parseFloat(discountAmountInput) || 0;

    let hasInvalidRate = false;
    cartMetalInfo.karats.forEach(k => {
        const rateKey = `gold${k}` as keyof RateInputs;
        if (parseFloat(rateInputs[rateKey]) <= 0) {
            hasInvalidRate = true;
            toast({ title: `Invalid Gold Rate (${k.toUpperCase()})`, description: `Please enter a valid positive gold rate for ${k.toUpperCase()} items.`, variant: "destructive" });
        }
    });
    if (hasInvalidRate) return;

    if (parsedDiscountAmount < 0) {
      toast({ title: "Invalid Discount", description: "Discount amount cannot be negative.", variant: "destructive" });
      return;
    }
    
    if (parsedDiscountAmount > estimatedInvoice.subtotal) {
        toast({ title: "Invalid Discount", description: "Discount cannot be greater than the subtotal.", variant: "destructive" });
        return;
    }
    
    const ratesForInvoice: Partial<Settings> = {
        goldRatePerGram18k: parseFloat(rateInputs.gold18k) || settings.goldRatePerGram18k,
        goldRatePerGram21k: parseFloat(rateInputs.gold21k) || settings.goldRatePerGram21k,
        goldRatePerGram22k: parseFloat(rateInputs.gold22k) || settings.goldRatePerGram22k,
        goldRatePerGram24k: parseFloat(rateInputs.gold24k) || settings.goldRatePerGram24k,
        palladiumRatePerGram: parseFloat(rateInputs.palladium) || settings.palladiumRatePerGram,
        platinumRatePerGram: parseFloat(rateInputs.platinum) || settings.platinumRatePerGram,
        silverRatePerGram: parseFloat(rateInputs.silver) || settings.silverRatePerGram,
    };

    // Persist rate changes to settings
    await updateSettings(ratesForInvoice);
    toast({ title: "Rates Updated", description: "Store metal rates have been updated with the values from this estimate."});

    const customerForInvoice = isWalkIn
        ? { name: finalWalkInName, phone: walkInCustomerPhone }
        : { id: selectedCustomerId, name: customers.find(c => c.id === selectedCustomerId)?.name || '', phone: customers.find(c => c.id === selectedCustomerId)?.phone || '' };
    
    if(isEditingEstimate && generatedInvoice) {
        await deleteInvoice(generatedInvoice.id, true); // Soft delete
    }

    const invoice = await generateInvoiceAction(customerForInvoice, ratesForInvoice, parsedDiscountAmount);
    
    if (invoice) {
      setGeneratedInvoice(invoice);
       // Pre-fill WhatsApp number if a customer with a phone number is selected
      if(invoice.customerContact) {
          phoneForm.setValue('phone', invoice.customerContact);
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
        if (generatedInvoice.customerContact) {
            setWalkInCustomerPhone(generatedInvoice.customerContact);
        }
    }
    setRateInputs({
        gold18k: (generatedInvoice.ratesApplied.goldRatePerGram18k || settings.goldRatePerGram18k || 0).toFixed(2),
        gold21k: (generatedInvoice.ratesApplied.goldRatePerGram21k || settings.goldRatePerGram21k || 0).toFixed(2),
        gold22k: (generatedInvoice.ratesApplied.goldRatePerGram22k || settings.goldRatePerGram22k || 0).toFixed(2),
        gold24k: (generatedInvoice.ratesApplied.goldRatePerGram24k || settings.goldRatePerGram24k || 0).toFixed(2),
        palladium: (generatedInvoice.ratesApplied.palladiumRatePerGram || settings.palladiumRatePerGram || 0).toFixed(2),
        platinum: (generatedInvoice.ratesApplied.platinumRatePerGram || settings.platinumRatePerGram || 0).toFixed(2),
        silver: (generatedInvoice.ratesApplied.silverRatePerGram || settings.silverRatePerGram || 0).toFixed(2),
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

    const logoToUse = settings.shopLogoUrlBlack || settings.shopLogoUrl;

    function drawHeader(pageNum: number) {
      if (logoToUse) {
        try {
          // jsPDF can handle image URLs directly
          doc.addImage(logoToUse, 'PNG', margin, 15, 40, 10, undefined, 'FAST');
        } catch (e) {
          console.error("Error adding logo image to PDF:", e);
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
    
    const rates = invoiceToPrint.ratesApplied;
    let ratesApplied: string[] = [];
    if (rates.goldRatePerGram24k) ratesApplied.push(`Gold (24k): PKR ${rates.goldRatePerGram24k.toLocaleString(undefined, { minimumFractionDigits: 0 })}/g`);
    if (rates.goldRatePerGram22k) ratesApplied.push(`Gold (22k): PKR ${rates.goldRatePerGram22k.toLocaleString(undefined, { minimumFractionDigits: 0 })}/g`);
    if (rates.goldRatePerGram21k) ratesApplied.push(`Gold (21k): PKR ${rates.goldRatePerGram21k.toLocaleString(undefined, { minimumFractionDigits: 0 })}/g`);
    if (rates.goldRatePerGram18k) ratesApplied.push(`Gold (18k): PKR ${rates.goldRatePerGram18k.toLocaleString(undefined, { minimumFractionDigits: 0 })}/g`);

    if (ratesApplied.length > 0) {
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(ratesApplied.join(' | '), pageWidth / 2, infoY + 12, { lineHeightFactor: 1.5 });
    }
    
    const tableStartY = infoY + 30;
    const tableColumn = ["#", "Product & Breakdown", "Qty", "Unit Price", "Total"];
    const tableRows: any[][] = [];

    const itemsToPrint = Array.isArray(invoiceToPrint.items) ? invoiceToPrint.items : Object.values(invoiceToPrint.items as {[key: string]: InvoiceItem});

    itemsToPrint.forEach((item: InvoiceItem, index) => {
        let breakdownLines = [];
        if (item.metalCost > 0) breakdownLines.push(`  Metal: PKR ${item.metalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.wastageCost > 0) breakdownLines.push(`  + Wastage (${item.wastagePercentage}%): PKR ${item.wastageCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
        if (item.makingCharges > 0) breakdownLines.push(`  + Making Charges: PKR ${item.makingCharges.toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
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
    doc.text(`PKR ${invoice.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;

    doc.setFont("helvetica", "bold").setTextColor(220, 53, 69);
    doc.text(`Discount:`, totalsX - 60, currentY, { align: 'right' });
    doc.text(`- PKR ${invoice.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;
    
    doc.setFont("helvetica", "normal").setTextColor(0);
    doc.setLineWidth(0.3);
    doc.line(totalsX - 60, currentY, totalsX, currentY);
    currentY += 8;
    
    doc.setFontSize(12).setFont("helvetica", "bold");
    doc.text(`Grand Total:`, totalsX - 60, currentY, { align: 'right' });
    doc.text(`PKR ${invoice.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 8;

    if (invoice.amountPaid > 0) {
        doc.setFontSize(10).setFont("helvetica", "normal");
        doc.text(`Amount Paid:`, totalsX - 60, currentY, { align: 'right' });
        doc.text(`- PKR ${invoice.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
        currentY += 8;
        
        doc.setFontSize(14).setFont("helvetica", "bold");
        doc.text(`Balance Due:`, totalsX - 60, currentY, { align: 'right' });
        doc.text(`PKR ${invoice.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
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
    

    pdfDoc.autoPrint();
    window.open(pdfDoc.output('bloburl'), '_blank');
  }

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin" />
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
