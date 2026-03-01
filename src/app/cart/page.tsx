

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
import { Trash2, Plus, Minus, ShoppingCart, FileText, Printer, User, XCircle, Settings as SettingsIcon, Percent, Info, Loader2, MessageSquare, Check, Banknote, Edit, ArrowLeft, PlusCircle, CalendarIcon, List } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import PhoneInput from 'react-phone-number-input/react-hook-form-input';
import 'react-phone-number-input/style.css'
import { Control, useForm } from 'react-hook-form';
import { useSearchParams } from 'next/navigation';
import { ProductForm } from '@/components/product/product-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { format } from 'date-fns';

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

  // Silver item inline editor
  const [silverEditItem, setSilverEditItem] = useState<Product | null>(null);
  const [editRate, setEditRate] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [useManualPrice, setUseManualPrice] = useState(false);
  const [editManualPrice, setEditManualPrice] = useState('');

  useEffect(() => {
    if (silverEditItem) {
      setEditRate(silverEditItem.silverRatePerGram?.toString() ?? parseFloat(rateInputs.silver || '0').toFixed(2));
      setEditWeight(silverEditItem.metalWeightG?.toString() ?? '');
      setUseManualPrice(silverEditItem.isCustomPrice ?? false);
      setEditManualPrice(silverEditItem.customPrice?.toString() ?? '');
    }
  }, [silverEditItem]);


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
        ...(cartMetalInfo.metals.has('gold') && {
            goldRatePerGram18k: parseFloat(rateInputs.gold18k) || settings.goldRatePerGram18k,
            goldRatePerGram21k: parseFloat(rateInputs.gold21k) || settings.goldRatePerGram21k,
            goldRatePerGram22k: parseFloat(rateInputs.gold22k) || settings.goldRatePerGram22k,
            goldRatePerGram24k: parseFloat(rateInputs.gold24k) || settings.goldRatePerGram24k,
        }),
        ...(cartMetalInfo.metals.has('palladium') && { palladiumRatePerGram: parseFloat(rateInputs.palladium) || settings.palladiumRatePerGram }),
        ...(cartMetalInfo.metals.has('platinum') && { platinumRatePerGram: parseFloat(rateInputs.platinum) || settings.platinumRatePerGram }),
        ...(cartMetalInfo.metals.has('silver') && { silverRatePerGram: parseFloat(rateInputs.silver) || settings.silverRatePerGram }),
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
  
    const handleRecordPayment = async () => {
    if (!generatedInvoice || !paymentAmount) return;
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid Amount", description: "Please enter a positive payment amount.", variant: "destructive" });
      return;
    }
     if (amount > generatedInvoice.balanceDue) {
      toast({ title: "Overpayment", description: `Payment cannot exceed the balance due of PKR ${generatedInvoice.balanceDue.toLocaleString()}.`, variant: "destructive" });
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const updatedInvoice = await updateInvoicePayment(generatedInvoice.id, amount, new Date().toISOString());
      if (updatedInvoice) {
        setGeneratedInvoice(updatedInvoice); // Update local state with the new invoice data
        setPaymentAmount('');
        toast({ title: "Payment Recorded", description: `PKR ${amount.toLocaleString()} has been recorded.` });
      } else {
        throw new Error("Failed to get updated invoice from the store.");
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to record payment.", variant: "destructive" });
    } finally {
      setIsSubmittingPayment(false);
    }
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


  const printInvoice = async (invoiceToPrint: InvoiceType) => {
    if (typeof window === 'undefined') {
      toast({ title: "Error", description: "PDF generation is only available in the browser.", variant: "destructive" });
      return;
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a5'
    });
    const pageHeight = doc.internal.pageSize.getHeight();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 10;

    let logoDataUrl: string | null = null;
    let logoFormat: string = 'PNG';
    const logoUrl = settings?.shopLogoUrlBlack || settings?.shopLogoUrl;
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
      } catch (e) {
        console.error("Error loading logo:", e);
      }
    }

    function drawHeader(pageNum: number) {
      if (logoDataUrl) {
        try {
          doc.addImage(logoDataUrl, logoFormat, margin, 8, 35, 11, undefined, 'FAST');
        } catch (e) {
          console.error("Error adding logo image to PDF:", e);
        }
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text('ESTIMATE', pageWidth - margin, 15, { align: 'right' });
      
      doc.setLineWidth(0.5);
      doc.line(margin, 25, pageWidth - margin, 25);

      if (pageNum > 1) {
          doc.setFontSize(8);
          doc.setTextColor(150);
          doc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 5, {align: 'right'});
      }
    }
    
    drawHeader(1);
    
    let infoY = 32;
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.setFont("helvetica", "bold");
    doc.text('BILL TO:', margin, infoY);
    doc.text('INVOICE DETAILS:', pageWidth / 2, infoY);

    doc.setLineWidth(0.2);
    doc.line(margin, infoY + 2, pageWidth - margin, infoY + 2);

    infoY += 7;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    doc.setFontSize(9);

    let customerInfo = "Walk-in Customer";
    if (invoiceToPrint.customerId && invoiceToPrint.customerName) {
        const customer = customers.find(c => c.id === invoiceToPrint.customerId);
        customerInfo = `${invoiceToPrint.customerName}\n`;
        if (customer?.address) customerInfo += `${customer.address}\n`;
        if (customer?.phone) customerInfo += `Phone: ${customer.phone}\n`;
        if (customer?.email) customerInfo += `Email: ${customer.email}`;
    }
    doc.text(customerInfo, margin, infoY, { lineHeightFactor: 1.4 });

    let invoiceDetails = `Estimate #: ${invoiceToPrint.id}\n`;
    invoiceDetails += `Date: ${new Date(invoiceToPrint.createdAt).toLocaleDateString()}`;
    doc.text(invoiceDetails, pageWidth / 2, infoY, { lineHeightFactor: 1.4 });
    
    const rates = invoiceToPrint.ratesApplied;
    let ratesApplied: string[] = [];
    if (rates.goldRatePerGram24k) ratesApplied.push(`24k: ${rates.goldRatePerGram24k.toLocaleString()}/g`);
    if (rates.goldRatePerGram22k) ratesApplied.push(`22k: ${rates.goldRatePerGram22k.toLocaleString()}/g`);
    if (rates.goldRatePerGram21k) ratesApplied.push(`21k: ${rates.goldRatePerGram21k.toLocaleString()}/g`);
    if (rates.goldRatePerGram18k) ratesApplied.push(`18k: ${rates.goldRatePerGram18k.toLocaleString()}/g`);

    if (ratesApplied.length > 0) {
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(ratesApplied.join(' | '), pageWidth / 2, infoY + 10, { lineHeightFactor: 1.4 });
    }
    
    const tableStartY = infoY + 20;
    const tableColumn = ["#", "Product & Breakdown", "Qty", "Unit", "Total"];
    const tableRows: any[][] = [];

    const itemsToPrint = Array.isArray(invoiceToPrint.items) ? invoiceToPrint.items : Object.values(invoiceToPrint.items as {[key: string]: InvoiceItem});

    itemsToPrint.forEach((item: InvoiceItem, index) => {
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

    doc.autoTable({
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
        didDrawPage: (data: { pageNumber: number, settings: { startY: number } }) => {
            if (data.pageNumber > 1) {
                doc.setPage(data.pageNumber);
                data.settings.startY = 28; 
            }
            drawHeader(data.pageNumber);
        },
    });

    let finalY = doc.lastAutoTable.finalY || 0;
    
    // Add payment history if it exists
    if (invoiceToPrint.paymentHistory && invoiceToPrint.paymentHistory.length > 0) {
        finalY += 8;
        doc.setFontSize(9).setFont("helvetica", "bold");
        doc.text("Payment History", margin, finalY);
        finalY += 4;
        const paymentRows = invoiceToPrint.paymentHistory.map(p => [
            format(new Date(p.date), 'PP'),
            `PKR ${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`,
            p.notes || 'Payment received'
        ]);
        doc.autoTable({
            head: [['Date', 'Amount', 'Notes']],
            body: paymentRows,
            startY: finalY,
            theme: 'striped',
            headStyles: { fillColor: [240, 240, 240], textColor: 50, fontSize: 8 },
            styles: { fontSize: 7 },
        });
        finalY = doc.lastAutoTable.finalY || finalY;
    }


    const footerAndTotalsHeight = 70; // Combined estimated height
    let needsNewPage = finalY + footerAndTotalsHeight > pageHeight - margin;

    if (needsNewPage) {
        doc.addPage();
        drawHeader(doc.getNumberOfPages());
        finalY = 28; 
    }

    let currentY = finalY + 8;
    const totalsX = pageWidth - margin;

    doc.setFontSize(9).setFont("helvetica", "normal").setTextColor(0);
    doc.text(`Subtotal:`, totalsX - 50, currentY, { align: 'right' });
    doc.text(`PKR ${invoiceToPrint.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 6;

    if (invoiceToPrint.discountAmount > 0) {
        doc.setFont("helvetica", "bold").setTextColor(220, 53, 69);
        doc.text(`Discount:`, totalsX - 50, currentY, { align: 'right' });
        doc.text(`- PKR ${invoiceToPrint.discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
        currentY += 6;
    }
    
    doc.setFont("helvetica", "normal").setTextColor(0);
    doc.setLineWidth(0.2);
    doc.line(totalsX - 50, currentY, totalsX, currentY);
    currentY += 6;
    
    doc.setFontSize(10).setFont("helvetica", "bold");
    doc.text(`Grand Total:`, totalsX - 50, currentY, { align: 'right' });
    doc.text(`PKR ${invoiceToPrint.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    currentY += 7;

    if (invoiceToPrint.amountPaid > 0) {
        doc.setFontSize(9).setFont("helvetica", "normal");
        doc.text(`Amount Paid:`, totalsX - 50, currentY, { align: 'right' });
        doc.text(`- PKR ${invoiceToPrint.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
        currentY += 7;
        
        doc.setFontSize(12).setFont("helvetica", "bold");
        doc.text(`Balance Due:`, totalsX - 50, currentY, { align: 'right' });
        doc.text(`PKR ${invoiceToPrint.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, totalsX, currentY, { align: 'right' });
    }

    const footerStartY = pageHeight - 35;
    const contacts = [
        { name: "Mina Khalid", number: "0316 1930960" },
        { name: "Ammar Mansa", number: "0326 2275554" },
    ];
    const qrCodeSize = 17;
    const qrGap = 4;
    const qrSectionWidth = (qrCodeSize * 2) + qrGap;
    const textBlockWidth = pageWidth - margin * 2 - qrSectionWidth - 6;
    const qrStartX = pageWidth - margin - qrSectionWidth;

    // Separator
    doc.setLineWidth(0.2);
    doc.line(margin, footerStartY - 2, pageWidth - margin, footerStartY - 2);

    // Left: label + contacts
    doc.setFontSize(6).setFont("helvetica", "bold").setTextColor(70);
    doc.text("For Orders & Inquiries:", margin, footerStartY + 2, { maxWidth: textBlockWidth });
    doc.setFontSize(8).setFont("helvetica", "normal").setTextColor(80);
    doc.text(`${contacts[0].name}: ${contacts[0].number}`, margin, footerStartY + 8, { maxWidth: textBlockWidth });
    doc.text(`${contacts[1].name}: ${contacts[1].number}`, margin, footerStartY + 14, { maxWidth: textBlockWidth });

    // Right: QR codes with titles
    const waQrCanvas = document.getElementById('wa-qr-code') as HTMLCanvasElement;
    const instaQrCanvas = document.getElementById('insta-qr-code') as HTMLCanvasElement;

    if (waQrCanvas) {
        doc.setFontSize(5).setFont("helvetica", "bold").setTextColor(60);
        doc.text("Join us on Whatsapp", qrStartX + qrCodeSize / 2, footerStartY + 2, { align: 'center' });
        doc.addImage(waQrCanvas.toDataURL('image/png'), 'PNG', qrStartX, footerStartY + 4, qrCodeSize, qrCodeSize);
    }
    if (instaQrCanvas) {
        const secondQrX = qrStartX + qrCodeSize + qrGap;
        doc.setFontSize(5).setFont("helvetica", "bold").setTextColor(60);
        doc.text("Follow us on Instagram", secondQrX + qrCodeSize / 2, footerStartY + 2, { align: 'center' });
        doc.addImage(instaQrCanvas.toDataURL('image/png'), 'PNG', secondQrX, footerStartY + 4, qrCodeSize, qrCodeSize);
    }

    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
  };
  
  if (!appReady) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin" />
      </div>
    );
  }

  // If viewing a generated invoice, show the finalized view
  if (generatedInvoice) {
    return (
      <div className="bg-muted min-h-screen p-4 sm:p-8">
        <div style={{ display: 'none' }}>
          <img id="shop-logo" src={settings?.shopLogoUrlBlack || settings?.shopLogoUrl || ''} crossOrigin="anonymous" alt="" />
          <QRCode id="wa-qr-code" value="https://chat.whatsapp.com/GspOCiFlp3tJWiNFkLfF0H" size={128} />
          <QRCode id="insta-qr-code" value="https://www.instagram.com/houseofmina__?igsh=aTAyZWQycWVudm43&utm_source=qr" size={128} />
        </div>
        <Card className="max-w-4xl mx-auto shadow-lg">
           <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
                <div>
                    <CardTitle className="text-2xl font-bold">Estimate Finalized</CardTitle>
                    <CardDescription>Estimate <span className="font-mono">{generatedInvoice.id}</span> created successfully.</CardDescription>
                </div>
                 <div className="flex gap-2 flex-col sm:flex-row">
                    <Button variant="outline" onClick={handleEditEstimate}>
                      <Edit className="mr-2 h-4 w-4"/> Edit Estimate
                    </Button>
                     <Button onClick={() => printInvoice(generatedInvoice)}>
                      <Printer className="mr-2 h-4 w-4"/> Print
                    </Button>
                 </div>
            </div>
           </CardHeader>
           <CardContent className="space-y-6">
                <div className="p-4 border rounded-md bg-background">
                    <div className="flex justify-between items-center mb-4">
                        <div>
                            <p className="text-sm text-muted-foreground">Billed to</p>
                            <p className="font-semibold">{generatedInvoice.customerName || 'Walk-in Customer'}</p>
                        </div>
                         <div>
                            <p className="text-sm text-muted-foreground text-right">Estimate Date</p>
                            <p className="font-semibold text-right">{new Date(generatedInvoice.createdAt).toLocaleDateString()}</p>
                        </div>
                    </div>
                    <Separator/>
                    <Table>
                        <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {generatedInvoice.items.map((item, index) => (
                                <TableRow key={index}>
                                    <TableCell>
                                        <div className="font-medium">{item.name}</div>
                                        <div className="text-xs text-muted-foreground">{item.sku}</div>
                                    </TableCell>
                                    <TableCell className="text-right font-medium">PKR {item.itemTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                     <Separator className="mt-4"/>
                     <div className="pt-4 space-y-2 text-right">
                        <div className="flex justify-end items-center gap-4"><span className="text-muted-foreground">Subtotal:</span> <span className="w-32 font-medium">PKR {generatedInvoice.subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                        {generatedInvoice.discountAmount > 0 && <div className="flex justify-end items-center gap-4"><span className="text-muted-foreground">Discount:</span> <span className="w-32 font-medium">- PKR {generatedInvoice.discountAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>}
                        <div className="flex justify-end items-center gap-4 text-lg font-bold"><span className="text-muted-foreground">Grand Total:</span> <span className="w-32">PKR {generatedInvoice.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                     </div>
                </div>

                <Separator />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                         <h3 className="font-semibold text-lg">Send to Customer</h3>
                         <div className="space-y-2">
                            <Label htmlFor="whatsapp-number">Customer WhatsApp Number</Label>
                             <PhoneInput
                                name="phone"
                                control={phoneForm.control as unknown as Control}
                                international
                                defaultCountry="PK"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                            />
                        </div>
                        <Button onClick={() => handleSendWhatsApp(generatedInvoice)} className="w-full">
                            <MessageSquare className="mr-2 h-4 w-4"/> Send via WhatsApp
                        </Button>
                    </div>

                    <div className="space-y-4">
                        <h3 className="font-semibold text-lg">Record a Payment</h3>
                        <div className="space-y-2">
                            <Label htmlFor="payment-amount">Payment Amount Received (PKR)</Label>
                            <Input 
                                id="payment-amount" 
                                type="number" 
                                placeholder={`Balance due: ${generatedInvoice.balanceDue.toLocaleString()}`}
                                value={paymentAmount}
                                onChange={(e) => setPaymentAmount(e.target.value)}
                            />
                        </div>
                        <Button 
                            className="w-full"
                            disabled={!paymentAmount || isSubmittingPayment || generatedInvoice.balanceDue <= 0}
                            onClick={handleRecordPayment}
                        >
                            {isSubmittingPayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Banknote className="mr-2 h-4 w-4"/>}
                            Submit Payment
                        </Button>
                    </div>
                </div>
                 {generatedInvoice.paymentHistory && generatedInvoice.paymentHistory.length > 0 && (
                     <div>
                        <h3 className="text-lg font-semibold flex items-center mb-2"><List className="mr-2 h-5 w-5"/>Payment History</h3>
                        <Card>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead><CalendarIcon className="h-4 w-4 inline-block mr-1"/> Date</TableHead>
                                            <TableHead>Notes</TableHead>
                                            <TableHead className="text-right">Amount (PKR)</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {generatedInvoice.paymentHistory.map((p, index) => (
                                            <TableRow key={index}>
                                                <TableCell>{format(new Date(p.date), 'PP')}</TableCell>
                                                <TableCell>{p.notes || 'Payment received'}</TableCell>
                                                <TableCell className="text-right font-medium">{p.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                        <Alert variant="default" className="mt-4 bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300">
                            <Check className="h-4 w-4 text-green-600"/>
                            <AlertTitle>Payment Summary</AlertTitle>
                            <AlertDescription>
                                A total of <strong className="font-semibold">PKR {generatedInvoice.amountPaid.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong> has been paid. 
                                The outstanding balance is <strong className="font-semibold">PKR {generatedInvoice.balanceDue.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong>.
                            </AlertDescription>
                        </Alert>
                     </div>
                 )}

           </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto py-8 px-4">
      {cartItemsFromStore.length === 0 ? (
          <Card className="max-w-2xl mx-auto">
            <CardHeader className="text-center">
              <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground" />
              <CardTitle className="text-2xl mt-4">Your Cart is Empty</CardTitle>
              <CardDescription>
                Add some products to the cart from the Products page or by using the QR scanner to create an estimate.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/scan" passHref>
                <Button className="w-full" size="lg">Start Scanning</Button>
              </Link>
            </CardContent>
          </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center"><Link href="/scan"><ArrowLeft className="mr-4 h-5 w-5"/></Link> Shopping Cart</CardTitle>
                        <CardDescription>Review items and apply discounts before generating the final estimate.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ScrollArea className="h-[40vh] pr-2 -mr-2">
                             <Table>
                                <TableHeader>
                                    <TableRow>
                                    <TableHead>Product</TableHead>
                                    <TableHead className="text-right">Price</TableHead>
                                    <TableHead className="w-10"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {cartItemsFromStore.map(item => (
                                        <TableRow key={item.sku}>
                                            <TableCell>
                                                <p className="font-medium">{item.name}</p>
                                                <p className="text-xs text-muted-foreground">{item.sku}</p>
                                                {item.metalType === 'silver' && item.isCustomPrice && (
                                                    <p className="text-xs text-amber-600 font-medium">Manual: PKR {item.customPrice?.toLocaleString()}</p>
                                                )}
                                                {item.metalType === 'silver' && !item.isCustomPrice && item.silverRatePerGram && (
                                                    <p className="text-xs text-blue-500">Rate: {item.silverRatePerGram}/g · {item.metalWeightG}g</p>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold">PKR {calculateProductCosts(item, settings).totalPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                                            <TableCell className="w-20">
                                                <div className="flex items-center gap-1">
                                                    {item.metalType === 'silver' && (
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setSilverEditItem(item)}>
                                                            <Edit className="h-4 w-4"/>
                                                        </Button>
                                                    )}
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeFromCart(item.sku)}>
                                                        <Trash2 className="h-4 w-4"/>
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    </CardContent>
                    <CardFooter>
                       <Button variant="outline" onClick={clearCart}>Clear All Items</Button>
                    </CardFooter>
                </Card>
            </div>

             {/* Sidebar */}
            <div className="lg:col-span-1 lg:sticky top-8 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Customer & Rates</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Select onValueChange={setSelectedCustomerId} defaultValue={WALK_IN_CUSTOMER_VALUE}>
                            <SelectTrigger><SelectValue/></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={WALK_IN_CUSTOMER_VALUE}>Walk-in Customer</SelectItem>
                                {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        
                        {(selectedCustomerId === WALK_IN_CUSTOMER_VALUE || selectedCustomerId === undefined) && (
                            <div className="p-4 border rounded-md space-y-3">
                                 <div><Label>Walk-in Name <span className="text-muted-foreground text-xs">(Optional)</span></Label><Input value={walkInCustomerName} onChange={e => setWalkInCustomerName(e.target.value)} placeholder="e.g., John Doe"/></div>
                                 <div><Label>Walk-in Contact <span className="text-muted-foreground text-xs">(Optional)</span></Label><Input value={walkInCustomerPhone} onChange={e => setWalkInCustomerPhone(e.target.value)} placeholder="e.g., 03001234567"/></div>
                            </div>
                        )}
                        <Separator />
                        <div className="space-y-2">
                             <Label>Gold Rates (PKR)</Label>
                             <div className="grid grid-cols-2 gap-2">
                                {cartMetalInfo.karats.has('18k') && <div><Label className="text-xs">18k/gram</Label><Input value={rateInputs.gold18k} onChange={e => handleRateChange('gold18k', e.target.value)} /></div>}
                                {cartMetalInfo.karats.has('21k') && <div><Label className="text-xs">21k/gram</Label><Input value={rateInputs.gold21k} onChange={e => handleRateChange('gold21k', e.target.value)} /></div>}
                                {cartMetalInfo.karats.has('22k') && <div><Label className="text-xs">22k/gram</Label><Input value={rateInputs.gold22k} onChange={e => handleRateChange('gold22k', e.target.value)} /></div>}
                                {cartMetalInfo.karats.has('24k') && <div><Label className="text-xs">24k/gram</Label><Input value={rateInputs.gold24k} onChange={e => handleRateChange('gold24k', e.target.value)} /></div>}
                             </div>
                        </div>

                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Final Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex justify-between"><span>Subtotal</span><span>PKR {estimatedInvoice?.subtotal.toLocaleString(undefined, {minimumFractionDigits: 2}) || '...'}</span></div>
                        <div className="flex items-center justify-between">
                            <Label htmlFor="discount" className="flex items-center"><Percent className="mr-2 h-4 w-4"/>Discount</Label>
                            <Input id="discount" type="number" value={discountAmountInput} onChange={(e) => setDiscountAmountInput(e.target.value)} className="w-32 text-right" placeholder="0"/>
                        </div>
                        <Separator />
                        <div className="flex justify-between font-bold text-xl"><span className="text-primary">Total</span><span>PKR {estimatedInvoice?.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2}) || '...'}</span></div>
                    </CardContent>
                    <CardFooter>
                         <Button size="lg" className="w-full" onClick={handleGenerateInvoice} disabled={!estimatedInvoice}>
                            <FileText className="mr-2 h-5 w-5"/> {isEditingEstimate ? 'Update Estimate' : 'Generate Estimate'}
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        </div>
      )}

      {/* Silver Item Edit Dialog */}
      <Dialog open={!!silverEditItem} onOpenChange={(open) => { if (!open) setSilverEditItem(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Silver Item</DialogTitle>
            <DialogDescription>{silverEditItem?.name} · {silverEditItem?.sku}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Rate per gram (PKR)</Label>
                <Input
                  type="number"
                  value={editRate}
                  onChange={e => setEditRate(e.target.value)}
                  disabled={useManualPrice}
                  placeholder="e.g. 150"
                />
              </div>
              <div className="space-y-1">
                <Label>Weight (g)</Label>
                <Input
                  type="number"
                  value={editWeight}
                  onChange={e => setEditWeight(e.target.value)}
                  disabled={useManualPrice}
                  placeholder="e.g. 25.5"
                />
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-2">
              <input
                id="use-manual-price"
                type="checkbox"
                checked={useManualPrice}
                onChange={e => setUseManualPrice(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <Label htmlFor="use-manual-price" className="cursor-pointer">Use manual price instead</Label>
            </div>
            {useManualPrice && (
              <div className="space-y-1">
                <Label>Manual Price (PKR)</Label>
                <Input
                  type="number"
                  value={editManualPrice}
                  onChange={e => setEditManualPrice(e.target.value)}
                  placeholder="e.g. 5000"
                  autoFocus
                />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setSilverEditItem(null)}>Cancel</Button>
              <Button onClick={() => {
                if (!silverEditItem) return;
                updateCartItem(silverEditItem.sku, {
                  metalWeightG: parseFloat(editWeight) || silverEditItem.metalWeightG,
                  silverRatePerGram: parseFloat(editRate) || undefined,
                  isCustomPrice: useManualPrice,
                  customPrice: useManualPrice ? (parseFloat(editManualPrice) || 0) : undefined,
                });
                setSilverEditItem(null);
              }}>Apply</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
