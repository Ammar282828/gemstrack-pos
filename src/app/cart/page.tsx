

"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { whatsAppLink } from '@/lib/whatsapp';
import Image from 'next/image';
import Link from 'next/link';
import { EditCartItemDialog, blankCartItem } from '@/components/cart/edit-cart-item-dialog';
import { DeliveryFields, EMPTY_DELIVERY, knownAddressesFor } from '@/components/shared/delivery-fields';
import { useRouter } from 'next/navigation';
import { useAppStore, Customer, Settings, InvoiceItem, Invoice as InvoiceType, calculateProductCosts, Product, MetalType, KaratValue, staticCategories , DeliveryInfo , PAYMENT_TYPES, PaymentType } from '@/lib/store';
import { metalLabel, describeMetal, describeSettings, describeDelivery, describePlating } from '@/lib/materials';
import { STORE_CONFIG, STORE_LOGO_URL, STORE_LOGO_ASPECT } from '@/lib/store-config';
import { CustomerAutocomplete } from '@/components/customer/customer-autocomplete';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Plus, Minus, ShoppingCart, FileText, ClipboardList, Printer, User, XCircle, Settings as SettingsIcon, Percent, Info, Loader2, MessageSquare, Check, Banknote, Edit, ArrowLeft, PlusCircle, CalendarIcon, List, RotateCcw, Ban, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { drawDocHeader, drawDocFooter, tableStyles, drawRowRule, alignHeadCell, label, drawTotals, type TotalRow } from '@/lib/pdf-chrome';

/** Shared by the table and by alignHeadCell, which needs the same object. */
const INVOICE_COLUMNS = {
  0: { cellWidth: 7, halign: 'center' },
  1: { cellWidth: 'auto' },
  2: { cellWidth: 9, halign: 'right' },
  3: { cellWidth: 22, halign: 'right' },
  4: { cellWidth: 22, halign: 'right' },
} as const;
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import 'react-phone-number-input/style.css';
import { normalizePhoneNumber, openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { getInvoiceAdjustmentsAmount } from '@/lib/financials';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'next/navigation';
import { ProductForm } from '@/components/product/product-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { AmountInput } from '@/components/ui/amount-input';
import { FormSkeleton } from '@/components/shared/skeletons';
import { PhoneField } from '@/components/ui/phone-field';
import { useFormDraft, DraftRestoreBanner } from '@/components/shared/use-form-draft';
import { drawItemCell, itemCellHeight, type ItemBlock } from '@/lib/invoice-item-cell';

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
  const router = useRouter();
  console.log("[GemsTrack] CartPage: Rendering START");
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const preloadedInvoiceId = searchParams.get('invoice_id');
  const paymentLockRef = React.useRef(false);

  const appReady = useAppReady();
  const { cartItemsFromStore, customers, settings, allInvoices, products, removeFromCart, clearCart, generateInvoice: generateInvoiceAction, addHisaabEntry, updateInvoicePayment, refundInvoicePartial, updateInvoiceDiscount, loadCartFromInvoice, deleteInvoice, updateCartItem, updateSettings, addToCart, addProductToCart, loadCustomers, loadGeneratedInvoices, loadProducts } = useAppStore(state => ({
    cartItemsFromStore: state.cart,
    customers: state.customers,
    settings: state.settings,
    allInvoices: state.generatedInvoices,
    products: state.products,
    removeFromCart: state.removeFromCart,
    clearCart: state.clearCart,
    generateInvoice: state.generateInvoice,
    addHisaabEntry: state.addHisaabEntry,
    updateInvoicePayment: state.updateInvoicePayment,
    refundInvoicePartial: state.refundInvoicePartial,
    updateInvoiceDiscount: state.updateInvoiceDiscount,
    loadCartFromInvoice: state.loadCartFromInvoice,
    deleteInvoice: state.deleteInvoice,
    updateCartItem: state.updateCartItem,
    updateSettings: state.updateSettings,
    addToCart: state.addToCart,
    addProductToCart: state.addProductToCart,
    loadCustomers: state.loadCustomers,
    loadGeneratedInvoices: state.loadGeneratedInvoices,
    loadProducts: state.loadProducts,
  }));

  useEffect(() => {
    if(appReady) {
      loadCustomers();
      loadGeneratedInvoices();
      loadProducts();
    }
  }, [appReady, loadCustomers, loadGeneratedInvoices, loadProducts]);


  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);
  const [walkInCustomerName, setWalkInCustomerName] = useState('');
  const [walkInCustomerPhone, setWalkInCustomerPhone] = useState('');
  const [generatedInvoice, setGeneratedInvoice] = useState<InvoiceType | null>(null);
  
  const [rateInputs, setRateInputs] = useState<RateInputs>({
    gold18k: '', gold21k: '', gold22k: '', gold24k: '', palladium: '', platinum: '', silver: ''
  });
  
  const [discountAmountInput, setDiscountAmountInput] = useState<string>('0');

  const [exchangeDescription, setExchangeDescription] = useState('');
  const [exchangeAmount1Input, setExchangeAmount1Input] = useState<string>('');
  const [exchangeAmount2Input, setExchangeAmount2Input] = useState<string>('');
  // Everything typed around the cart — who it is for, the discount, anything
  // taken in exchange. The items themselves already survive a reload via the
  // store; this is the rest of the sale.
  const invoiceDraftValue = useMemo(() => ({
    walkInCustomerName, walkInCustomerPhone, discountAmountInput,
    exchangeDescription, exchangeAmount1Input, exchangeAmount2Input,
  }), [walkInCustomerName, walkInCustomerPhone, discountAmountInput,
       exchangeDescription, exchangeAmount1Input, exchangeAmount2Input]);


  
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isEditingDiscount, setIsEditingDiscount] = useState(false);
  const [editDiscountInput, setEditDiscountInput] = useState<string>('');
  const [isSavingDiscount, setIsSavingDiscount] = useState(false);
  const [isEditingEstimate, setIsEditingEstimate] = useState(false);
  const isEditingEstimateRef = React.useRef(false);

  const { draft: invoiceDraft, discard: discardInvoiceDraft, done: invoiceDraftDone } = useFormDraft({
    kind: 'invoice',
    id: 'new',
    value: invoiceDraftValue,
    enabled: settings?.autoDraftForms !== false,
    // Editing an existing estimate already has its data saved.
    skip: isEditingEstimate,
  });

  const restoreInvoiceDraft = () => {
    const d = invoiceDraft?.data as typeof invoiceDraftValue | undefined;
    if (!d) return;
    setWalkInCustomerName(d.walkInCustomerName || '');
    setWalkInCustomerPhone(d.walkInCustomerPhone || '');
    setDiscountAmountInput(d.discountAmountInput || '0');
    setExchangeDescription(d.exchangeDescription || '');
    setExchangeAmount1Input(d.exchangeAmount1Input || '');
    setExchangeAmount2Input(d.exchangeAmount2Input || '');
    discardInvoiceDraft();
    toast({ title: 'Draft restored', description: 'Picking up where you left off.' });
  };

  const [isGeneratingEstimate, setIsGeneratingEstimate] = useState(false);
  const editingInvoiceOriginalRef = React.useRef<InvoiceType | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | undefined>(undefined);
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [refundMode, setRefundMode] = useState<'full' | 'partial'>('full');
  const [partialRefundAmount, setPartialRefundAmount] = useState<string>('');
  const [partialRefundReason, setPartialRefundReason] = useState<string>('');
  const [pendingPreloadedInvoice, setPendingPreloadedInvoice] = useState<InvoiceType | null>(null);
  const [isCartClearWarningOpen, setIsCartClearWarningOpen] = useState(false);
  
  const [editingCartItem, setEditingCartItem] = useState<Product | undefined>(undefined);
  const [isNewProductDialogOpen, setIsNewProductDialogOpen] = useState(false);

  const [skuInput, setSkuInput] = useState('');
  const [skuSuggestions, setSkuSuggestions] = useState<Product[]>([]);
  const [skuDropdownOpen, setSkuDropdownOpen] = useState(false);
  const skuInputRef = React.useRef<HTMLInputElement>(null);

  const handleSkuInputChange = (value: string) => {
    setSkuInput(value);
    const tokens = value.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      setSkuSuggestions([]);
      setSkuDropdownOpen(false);
      return;
    }
    const matches = products
      .filter(p => !cartItemsFromStore.find(i => i.sku === p.sku))
      .filter(p => {
        const sku = p.sku.toUpperCase();
        const name = p.name.toUpperCase();
        return tokens.every(t => sku.includes(t) || name.includes(t));
      })
      .slice(0, 8);
    setSkuSuggestions(matches);
    setSkuDropdownOpen(matches.length > 0);
  };

  const handleAddBySku = (skuOverride?: string) => {
    const sku = (skuOverride ?? skuInput).trim().toUpperCase();
    setSkuDropdownOpen(false);
    setSkuSuggestions([]);
    if (!sku) return;
    const found = products.find(p => p.sku === sku);
    if (!found) {
      // Not an error: an unrecognised code usually means a new piece.
      const draft = blankCartItem();
      setNewItem({ ...draft, name: skuOverride ? '' : (skuInput.trim() || '') });
      setSkuInput('');
      toast({ title: 'Not in inventory', description: 'Opening a new item so you can bill it directly.' });
      return;
    }
    if (cartItemsFromStore.find(i => i.sku === sku)) {
      toast({ title: 'Already in cart', description: `${found.name} is already in the cart.` });
      setSkuInput('');
      return;
    }
    addToCart(sku);
    toast({ title: 'Added to cart', description: found.name });
    setSkuInput('');
  };

  // Line-item editor — every attribute of the line, any metal.
  const [editItem, setEditItem] = useState<Product | null>(null);
  // Most pieces here are made to order and never existed in inventory, so
  // billing starts by describing the piece rather than looking one up.
  const [newItem, setNewItem] = useState<Product | null>(null);
  // Most sales are handed over at the counter, so this stays off until ticked.
  const [delivery, setDelivery] = useState<DeliveryInfo>(EMPTY_DELIVERY);
  // Cash by default — most of the counter trade is cash, and the alternatives
  // only matter when reconciling against a bank statement later.
  const [paymentMethod, setPaymentMethod] = useState<PaymentType>('Cash');
  const [paymentRef, setPaymentRef] = useState('');

  const phoneForm = useForm<PhoneForm>();

  // If the user navigates away (back button) while editing an estimate, the cart
  // was loaded with invoice items but never cleared. Wipe it on unmount.
  useEffect(() => {
    return () => {
      if (isEditingEstimateRef.current) {
        clearCart();
      }
    };
    // clearCart is stable (Zustand action ref), safe to include
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  useEffect(() => {
    if (preloadedInvoiceId && !isEditingEstimate) {
        const invoice = allInvoices.find(inv => inv.id === preloadedInvoiceId);
        if (invoice) {
            // If current sale has items, warn before silently wiping them
            if (cartItemsFromStore.length > 0) {
                setPendingPreloadedInvoice(invoice);
                setIsCartClearWarningOpen(true);
            } else {
                setGeneratedInvoice(invoice);
                clearCart();
            }
        }
    }
    // NOTE: cartItemsFromStore.length is intentionally excluded from the deps below.
    // Including it caused a race condition: loadCartFromInvoice (Zustand, sync) would
    // update cart length, the effect would re-fire before React committed
    // isEditingEstimate=true, and clearCart() would wipe the just-loaded items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadedInvoiceId, allInvoices, clearCart, isEditingEstimate]);


  useEffect(() => {
    // Only sync rates from settings when NOT editing an existing estimate.
    // When editing, rates are loaded from the invoice by handleEditEstimate.
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
    const parsedExchange1 = parseFloat(exchangeAmount1Input) || 0;
    const parsedExchange2 = parseFloat(exchangeAmount2Input) || 0;
    const grandTotal = currentSubtotal - parsedDiscountAmount - parsedExchange1 - parsedExchange2;

    return {
        subtotal: currentSubtotal,
        grandTotal: grandTotal,
        items: estimatedItems,
    };
  }, [appReady, settings, cartItemsFromStore, rateInputs, discountAmountInput, exchangeAmount1Input, exchangeAmount2Input, cartMetalInfo]);


  const handleGenerateInvoice = async () => {
    if (isGeneratingEstimate) return; // Prevent double-submit
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
    
    // NOTE: we do NOT delete the invoice before re-generating it. generateInvoice
    // uses transaction.set (overwrite) with the same ID, so the invoice is always
    // valid. Old hisaab cleanup is handled inside generateInvoice after the
    // transaction succeeds, so payment history can never be lost.

    const exchangeInfo = (exchangeDescription.trim() || parseFloat(exchangeAmount1Input) || parseFloat(exchangeAmount2Input))
        ? { description: exchangeDescription.trim(), amount1: parseFloat(exchangeAmount1Input) || 0, amount2: parseFloat(exchangeAmount2Input) || 0 }
        : undefined;

    setIsGeneratingEstimate(true);
    let invoice;
    try {
      invoice = await generateInvoiceAction(customerForInvoice, ratesForInvoice, parsedDiscountAmount, exchangeInfo, isEditingEstimate ? editingInvoiceId : undefined, delivery);
      if (invoice) invoiceDraftDone();
    } finally {
      setIsGeneratingEstimate(false);
    }

    if (invoice) {
      setGeneratedInvoice(invoice);
      if(invoice.customerContact) {
          phoneForm.setValue('phone', normalizePhoneNumber(invoice.customerContact));
      }
      setIsEditingEstimate(false);
      isEditingEstimateRef.current = false;
      setEditingInvoiceId(undefined);
      toast({ title: "Estimate Generated", description: `Estimate ${invoice.id} created successfully.` });
    } else {
      toast({ title: "Estimate Generation Failed", description: "Could not generate the estimate. Please check inputs and logs.", variant: "destructive" });
    }
  };

  const handleCancelEdit = () => {
    clearCart();
    setIsEditingEstimate(false);
    isEditingEstimateRef.current = false;
    setEditingInvoiceId(undefined);
    // Restore the invoice view the user came from
    if (editingInvoiceOriginalRef.current) {
      setGeneratedInvoice(editingInvoiceOriginalRef.current);
      editingInvoiceOriginalRef.current = null;
    }
  };

  const handleEditEstimate = () => {
    if (!generatedInvoice) return;
    editingInvoiceOriginalRef.current = generatedInvoice; // cache for cancel
    setIsEditingEstimate(true);
    isEditingEstimateRef.current = true;
    clearCart(); // Ensure no stale items linger before loading invoice items
    loadCartFromInvoice(generatedInvoice);
    setSelectedCustomerId(generatedInvoice.customerId || WALK_IN_CUSTOMER_VALUE);
    // Always restore customer name and phone regardless of walk-in vs registered customer
    setWalkInCustomerName(generatedInvoice.customerName || '');
    if (generatedInvoice.customerContact) {
        setWalkInCustomerPhone(generatedInvoice.customerContact);
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
    setExchangeDescription(generatedInvoice.exchangeDescription || '');
    setExchangeAmount1Input(generatedInvoice.exchangeAmount1 ? String(generatedInvoice.exchangeAmount1) : '');
    setExchangeAmount2Input(generatedInvoice.exchangeAmount2 ? String(generatedInvoice.exchangeAmount2) : '');
    setEditingInvoiceId(generatedInvoice.id);
    setGeneratedInvoice(null);
  };
  
    const handleRecordPayment = async (overrideAmount?: number) => {
    if (!generatedInvoice) return;
    const amount = overrideAmount ?? parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Invalid Amount", description: "Please enter a positive payment amount.", variant: "destructive" });
      return;
    }
     if (amount > generatedInvoice.balanceDue) {
      toast({ title: "Overpayment", description: `Payment cannot exceed the balance due of PKR ${generatedInvoice.balanceDue.toLocaleString()}.`, variant: "destructive" });
      return;
    }

    // A ref, not the isSubmitting state: React batches state updates, so a fast
    // double-click can fire this twice before the disabled prop re-renders.
    // That is exactly how INV-000257 ended up with two identical payments 1.3
    // seconds apart.
    if (paymentLockRef.current) return;
    paymentLockRef.current = true;

    setIsSubmittingPayment(true);
    try {
      const updatedInvoice = await updateInvoicePayment(generatedInvoice.id, amount, new Date().toISOString(), paymentMethod, paymentRef);
      if (updatedInvoice) {
        setGeneratedInvoice(updatedInvoice); // Update local state with the new invoice data
        setPaymentAmount('');
        setPaymentRef('');
        toast({ title: "Payment Recorded", description: `PKR ${amount.toLocaleString()} by ${paymentMethod}.` });
      } else {
        throw new Error("Failed to get updated invoice from the store.");
      }
    } catch (error) {
      toast({ title: "Error", description: "Failed to record payment.", variant: "destructive" });
    } finally {
      paymentLockRef.current = false;
      setIsSubmittingPayment(false);
    }
  };

  const handleSaveDiscount = async () => {
    if (!generatedInvoice) return;
    const amount = parseFloat(editDiscountInput) || 0;
    if (amount < 0) {
      toast({ title: "Invalid", description: "Discount cannot be negative.", variant: "destructive" });
      return;
    }
    if (amount > generatedInvoice.subtotal) {
      toast({ title: "Invalid", description: "Discount cannot exceed subtotal.", variant: "destructive" });
      return;
    }
    setIsSavingDiscount(true);
    try {
      const updated = await updateInvoiceDiscount(generatedInvoice.id, amount);
      if (updated) {
        setGeneratedInvoice(updated);
        setIsEditingDiscount(false);
        toast({ title: "Discount Updated", description: `Discount set to PKR ${amount.toLocaleString()}.` });
      } else {
        throw new Error("Failed to update discount.");
      }
    } catch {
      toast({ title: "Error", description: "Failed to update discount.", variant: "destructive" });
    } finally {
      setIsSavingDiscount(false);
    }
  };

  const handleSendWhatsApp = async (invoiceToSend: InvoiceType) => {
    const whatsAppNumber = phoneForm.getValues('phone');
    if (!whatsAppNumber) {
      toast({ title: "No Phone Number", description: "Please enter a customer's phone number.", variant: "destructive" });
      return;
    }

    let message = `Dear ${invoiceToSend.customerName || 'Customer'},\n\n`;
    message += `Here is your estimate from ${settings.shopName}.\n\n`;
    message += `*Estimate ID:* ${invoiceToSend.id}\n`;
    message += `*Total Amount:* PKR ${invoiceToSend.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
    if (invoiceToSend.amountPaid > 0) {
      message += `*Amount Paid:* PKR ${invoiceToSend.amountPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n`;
      message += `*Balance Due:* PKR ${invoiceToSend.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    } else {
      message += `*Amount Due:* PKR ${invoiceToSend.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    }
    message += `Thank you for your business.`;

    // Try Web Share API with PDF file (iOS 15+ / Android Chrome 86+)
    if (typeof navigator !== 'undefined' && navigator.canShare) {
      try {
        const doc = await buildInvoicePDF(invoiceToSend);
        if (doc) {
          const blob = doc.output('blob') as Blob;
          const file = new File([blob], `Estimate-${invoiceToSend.id}.pdf`, { type: 'application/pdf' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: `Estimate ${invoiceToSend.id}`, text: message });
            toast({ title: "Shared", description: "Estimate PDF shared successfully." });
            return;
          }
        }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return; // user dismissed share sheet
        console.error('Share failed, falling back to WhatsApp link:', e);
      }
    }

    // Fallback for desktop: open wa.me with a pre-composed text + link
    const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://gemstrack-pos.web.app';
    message += `\n\nView estimate: ${appUrl}/view-invoice/${invoiceToSend.id}`;
    // Country code and leading-zero handling live in one place; the raw
    // digit strip that used to be here produced wa.me/0300… , a dead link.
    const whatsappUrl = whatsAppLink(whatsAppNumber, message);
    window.open(whatsappUrl, '_blank');
    toast({ title: "Redirecting to WhatsApp", description: "Your message is ready to be sent." });
  };


  const buildInvoicePDF = async (invoiceToPrint: InvoiceType): Promise<jsPDF | null> => {
    if (typeof window === 'undefined') return null;

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
          const img = new window.Image();
          img.onload = () => { logoNaturalW = img.naturalWidth; logoNaturalH = img.naturalHeight; resolve(); };
          img.onerror = () => resolve();
          img.src = logoDataUrl!;
        });
      } catch (e) {
        console.error("Error loading logo:", e);
      }
    }

    const drawHeader = (pageNum: number) => drawDocHeader(doc, {
      pageWidth, pageHeight, margin, title: 'Estimate',
      logoDataUrl, logoFormat,
      logoAspect: logoNaturalH > 0 ? logoNaturalW / logoNaturalH : STORE_LOGO_ASPECT,
      pageNum,
    });

    drawHeader(1);
    
    let infoY = 28;
    label(doc, 'Bill to', margin, infoY);
    label(doc, 'Estimate details', pageWidth / 2, infoY);

    doc.setLineWidth(0.2);
    doc.line(margin, infoY + 1.5, pageWidth - margin, infoY + 1.5);

    infoY += 6;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    doc.setFontSize(8);

    let customerInfo = "Walk-in Customer";
    const customer = invoiceToPrint.customerId ? customers.find(c => c.id === invoiceToPrint.customerId) : null;
    const phone = customer?.phone || invoiceToPrint.customerContact || '';
    const email = customer?.email || '';
    if (invoiceToPrint.customerName) {
        customerInfo = `${invoiceToPrint.customerName}\n`;
    }
    if (phone) customerInfo += `Phone: ${phone}\n`;
    if (email) customerInfo += `Email: ${email}`;
    doc.text(customerInfo, margin, infoY, { lineHeightFactor: 1.4 });

    // Where it is going, when it is being delivered. The address the customer
    // gave was never printed, so whoever packed the piece had to go and find
    // it in the order.
    const deliveryLines: string[] = describeDelivery(invoiceToPrint.delivery);
    if (deliveryLines.length) {
      const dy = infoY + (customerInfo.split('\n').length * 4) + 2;
      label(doc, 'Deliver to', margin, dy);
      doc.setFont('helvetica', 'normal').setFontSize(8);
      doc.text(deliveryLines.join('\n'), margin, dy + 4, { lineHeightFactor: 1.4 });
    }

    let invoiceDetails = `Estimate #: ${invoiceToPrint.id}\n`;
    invoiceDetails += `Date: ${new Date(invoiceToPrint.createdAt).toLocaleDateString()}`;
    doc.text(invoiceDetails, pageWidth / 2, infoY, { lineHeightFactor: 1.4 });
    
    const rates = (invoiceToPrint.ratesApplied || {}) as Record<string, number>;
    const itemsToPrint = Array.isArray(invoiceToPrint.items) ? invoiceToPrint.items : Object.values(invoiceToPrint.items as {[key: string]: InvoiceItem});
    const hasGoldItems = itemsToPrint.some((i: InvoiceItem) => i.metalType === 'gold');
    let ratesApplied: string[] = [];
    if (hasGoldItems) {
      if (rates.goldRatePerGram24k) ratesApplied.push(`24k: ${rates.goldRatePerGram24k.toLocaleString()}/g`);
      if (rates.goldRatePerGram22k) ratesApplied.push(`22k: ${rates.goldRatePerGram22k.toLocaleString()}/g`);
      if (rates.goldRatePerGram21k) ratesApplied.push(`21k: ${rates.goldRatePerGram21k.toLocaleString()}/g`);
      if (rates.goldRatePerGram18k) ratesApplied.push(`18k: ${rates.goldRatePerGram18k.toLocaleString()}/g`);
    }

    if (ratesApplied.length > 0) {
        doc.setFontSize(6.5);
        doc.setTextColor(150);
        doc.text(ratesApplied.join(' | '), pageWidth / 2 + 2, infoY + 10, { lineHeightFactor: 1.4 });
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

    itemsToPrint.forEach((item: InvoiceItem, index) => {
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
        const weightPart = item.metalWeightG > 0 ? `, Wt: ${(item.metalWeightG || 0).toFixed(2)}g` : '';
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

    doc.autoTable({
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
                    data.cell.styles.minCellHeight = itemCellHeight(doc, block, descColWidth);
                }
            }
        },
        didDrawCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 1) {
                const block = itemBlocks[data.row.index];
                if (block) drawItemCell(doc, block, data.cell, descColWidth);
            }
            drawRowRule(doc, data, 4, { margin, pageWidth });
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
            margin: { left: margin, right: margin },
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
    const adjustmentsAmount = getInvoiceAdjustmentsAmount(invoiceToPrint);

    const money = (n: number) => `PKR ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const totalRows: TotalRow[] = [{ label: 'Subtotal', value: money(invoiceToPrint.subtotal) }];
      if (invoiceToPrint.discountAmount > 0) totalRows.push({ label: 'Discount', value: `- ${money(invoiceToPrint.discountAmount)}`, tone: 'ink' });
      if (adjustmentsAmount !== 0) totalRows.push({ label: 'Adjustments', value: money(adjustmentsAmount) });
      if (invoiceToPrint.exchangeAmount1 || invoiceToPrint.exchangeAmount2) {
      totalRows.push({ label: invoiceToPrint.exchangeDescription ? `Exchange (${invoiceToPrint.exchangeDescription})` : 'Exchange', value: '', tone: 'ink' });
        if (invoiceToPrint.exchangeAmount1) totalRows.push({ label: '', value: `- ${money(invoiceToPrint.exchangeAmount1)}` });
        if (invoiceToPrint.exchangeAmount2) totalRows.push({ label: '', value: `- ${money(invoiceToPrint.exchangeAmount2)}` });
    }
      drawTotals(doc, {
      pageWidth, pageHeight, margin, startY: currentY, onNewPage: drawHeader,
      rows: totalRows,
      total: { label: 'Grand Total', value: money(invoiceToPrint.grandTotal) },
      after: invoiceToPrint.amountPaid > 0 ? [{ label: 'Amount Paid', value: `- ${money(invoiceToPrint.amountPaid)}` }] : [],
      closing: invoiceToPrint.amountPaid > 0 ? { label: 'Balance Due', value: money(invoiceToPrint.balanceDue) } : undefined,
    });

    drawDocFooter(doc, {
      pageWidth, pageHeight, margin,
      whatsappQr: document.getElementById('wa-qr-code') as HTMLCanvasElement | null,
      instagramQr: document.getElementById('insta-qr-code') as HTMLCanvasElement | null,
    });

    return doc;
  };

  const printInvoice = async (invoiceToPrint: InvoiceType) => {
    // Anything that threw while drawing became an unhandled rejection: the
    // button did nothing and said nothing.
    try {
      await printInvoiceInner(invoiceToPrint);
    } catch (e) {
      console.error('[GemsTrack] invoice PDF failed', e);
      toast({
        title: 'Could not create the PDF',
        description: e instanceof Error ? e.message : 'Something went wrong while drawing it.',
        variant: 'destructive',
      });
    }
  };

  const printInvoiceInner = async (invoiceToPrint: InvoiceType) => {
    const iOSWin = openPDFWindowForIOS();
    const doc = await buildInvoicePDF(invoiceToPrint);
    if (!doc) {
      toast({ title: "Error", description: "PDF generation is only available in the browser.", variant: "destructive" });
      if (iOSWin) iOSWin.close();
      return;
    }
    await savePDF(doc, `Invoice-${invoiceToPrint.id}.pdf`, iOSWin);
  };

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <FormSkeleton fields={6} columns={2} />
      </div>
    );
  }

  const handleRefundInvoice = async () => {
    if (!generatedInvoice) return;
    setIsRefunding(true);
    try {
      if (refundMode === 'full') {
        await deleteInvoice(generatedInvoice.id, false); // false = restore stock
        toast({ title: 'Invoice Refunded', description: `Invoice ${generatedInvoice.id} has been deleted and items returned to stock.` });
        setGeneratedInvoice(null);
      } else {
        const amt = parseFloat(partialRefundAmount);
        if (!(amt > 0)) {
          toast({ title: 'Invalid amount', description: 'Enter a refund amount greater than 0.', variant: 'destructive' });
          return;
        }
        const updated = await refundInvoicePartial(generatedInvoice.id, amt, partialRefundReason || undefined);
        if (updated) {
          setGeneratedInvoice(updated);
          toast({ title: 'Partial refund recorded', description: `PKR ${amt.toLocaleString()} refunded on Invoice ${generatedInvoice.id}.` });
          setPartialRefundAmount('');
          setPartialRefundReason('');
        } else {
          toast({ title: 'Error', description: 'Failed to record partial refund.', variant: 'destructive' });
          return;
        }
      }
      setIsRefundDialogOpen(false);
    } catch {
      toast({ title: 'Error', description: 'Failed to process refund.', variant: 'destructive' });
    } finally {
      setIsRefunding(false);
    }
  };

  // If viewing a generated invoice, show the finalized view
  if (generatedInvoice) {
    return (
      <div className="bg-muted min-h-screen p-4 sm:p-8">
        <div style={{ display: 'none' }}>
          <img id="shop-logo" src={STORE_LOGO_URL} crossOrigin="anonymous" alt="" loading="lazy" decoding="async" />
          <QRCode id="wa-qr-code" value={STORE_CONFIG.whatsappUrl} size={128} />
          <QRCode id="insta-qr-code" value={STORE_CONFIG.instagramUrl} size={128} />
        </div>
        <Card className="max-w-4xl mx-auto shadow-lg">
           <CardHeader>
            <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4">
                <div className="min-w-0">
                    {/* You reach this page by opening an existing invoice, so
                        "created successfully" was announcing something that had
                        not just happened. The identifier leads, and the line
                        under it says what is actually owed. */}
                    <CardTitle className="text-2xl font-bold font-mono">{generatedInvoice.id}</CardTitle>
                    <CardDescription className="mt-1">
                      {generatedInvoice.customerName || 'Walk-in Customer'}
                      {' · '}
                      {new Date(generatedInvoice.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </CardDescription>
                    <div className="flex items-center gap-2 mt-2">
                      {(generatedInvoice.balanceDue || 0) > 0 ? (
                        <Badge variant="outline" className="text-destructive border-destructive/40 bg-destructive/5">
                          PKR {(generatedInvoice.balanceDue || 0).toLocaleString()} due
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-success border-success/40 bg-success/5">Paid in full</Badge>
                      )}
                      {generatedInvoice.status === 'Refunded' && <Badge variant="destructive">Refunded</Badge>}
                    </div>
                </div>
                 <div className="flex gap-2 flex-col sm:flex-row">
                    <Button variant="outline" onClick={handleEditEstimate}>
                      <Edit className="mr-2 h-4 w-4"/> Edit Estimate
                    </Button>
                     <Button onClick={() => printInvoice(generatedInvoice)}>
                      <Printer className="mr-2 h-4 w-4"/> Print
                    </Button>
                    <Button variant="outline" onClick={() => setIsRefundDialogOpen(true)} className="border-destructive text-destructive hover:bg-destructive/10">
                      <RotateCcw className="mr-2 h-4 w-4"/> Refund
                    </Button>
                 </div>
            </div>
           </CardHeader>
           <CardContent className="space-y-6">
                <div className="p-4 border rounded-md bg-background">
                    {(() => {
                      const shipTo = describeDelivery(generatedInvoice.delivery);
                      if (!shipTo.length) return null;
                      return (
                        <>
                          <div className="mb-4">
                            <p className="text-2xs uppercase tracking-wide text-muted-foreground">Deliver to</p>
                            {shipTo.map(l => <p key={l} className="text-sm">{l}</p>)}
                          </div>
                          <Separator/>
                        </>
                      );
                    })()}
                    {/* Item cards, not a two-column table. The screen was
                        showing less than the printed invoice: name, size, SKU
                        and a total, while the PDF carried the metal, the
                        weight, the stones and the cost breakdown. */}
                    <div className="space-y-3 mt-4">
                      {generatedInvoice.items.map((item, index) => {
                        const spec: [string, string][] = [];
                        spec.push(['Metal', describeMetal(item.metalType, item.karat)]);
                        if ((item.metalWeightG ?? 0) > 0) spec.push(['Weight', `${item.metalWeightG}g`]);
                        if (item.size) spec.push(['Size', item.size]);
                        const finish = describePlating(item);
                        if (finish) spec.push(['Finish', finish]);
                        if ((item.stoneWeightG ?? 0) > 0) spec.push(['Stone weight', `${item.stoneWeightG}g`]);
                        if (item.sku) spec.push(['SKU', item.sku]);

                        const costs: [string, number][] = [];
                        if ((item.metalCost ?? 0) > 0) costs.push(['Metal', item.metalCost]);
                        if ((item.wastageCost ?? 0) > 0) costs.push([`Wastage (${item.wastagePercentage}%)`, item.wastageCost]);
                        if ((item.makingCharges ?? 0) > 0) costs.push(['Making', item.makingCharges]);
                        if ((item.diamondChargesIfAny ?? 0) > 0) costs.push(['Diamonds', item.diamondChargesIfAny]);
                        if ((item.stoneChargesIfAny ?? 0) > 0) costs.push(['Stones', item.stoneChargesIfAny]);
                        if ((item.miscChargesIfAny ?? 0) > 0) costs.push(['Misc', item.miscChargesIfAny]);

                        return (
                          <div key={item.sku ?? index} className="rounded-lg border p-3">
                            <div className="flex items-baseline justify-between gap-3">
                              <div className="min-w-0">
                                {item.itemCategory && (
                                  <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    {staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory}
                                  </span>
                                )}
                                <p className="font-semibold truncate">{item.name}</p>
                              </div>
                              <span className="font-semibold tabular-nums flex-shrink-0">
                                PKR {item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            </div>

                            <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-sm">
                              {spec.map(([label, value]) => (
                                <div key={label} className="min-w-0">
                                  <dt className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                                  <dd className="truncate" title={value}>{value}</dd>
                                </div>
                              ))}
                            </dl>

                            {/* The same lines the printed invoice carries, so
                                the screen and the paper agree. */}
                            {describeSettings(item).filter(l => !l.startsWith('Finish:') && !l.startsWith('Stone weight:')).map(line => (
                              <p key={line} className="text-xs mt-1.5 text-muted-foreground">{line}</p>
                            ))}

                            {costs.length > 0 && (
                              <div className="mt-2 pt-2 border-t flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
                                {costs.map(([label, amount]) => (
                                  <span key={label} className="tabular-nums">
                                    {label} {amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                     <Separator className="mt-4"/>
                     <div className="pt-4 space-y-2 text-right">
                        <div className="flex justify-end items-center gap-4"><span className="text-muted-foreground">Subtotal:</span> <span className="w-32 font-medium">PKR {generatedInvoice.subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                        <div className="flex justify-end items-center gap-2">
                          <span className="text-muted-foreground">Discount:</span>
                          {isEditingDiscount ? (
                            <div className="flex items-center gap-1">
                              <AmountInput
                                value={editDiscountInput}
                                onValueChange={v => setEditDiscountInput(v === undefined ? '' : String(v))}
                                className="w-32 text-right h-8"
                                aria-label="Discount"
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveDiscount(); if (e.key === 'Escape') setIsEditingDiscount(false); }}
                              />
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleSaveDiscount} disabled={isSavingDiscount} aria-label="Confirm">
                                {isSavingDiscount ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setIsEditingDiscount(false)}>
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              className="w-32 font-medium text-right hover:underline cursor-pointer"
                              onClick={() => { setEditDiscountInput(String(generatedInvoice.discountAmount)); setIsEditingDiscount(true); }}
                            >
                              {generatedInvoice.discountAmount > 0 ? `- PKR ${generatedInvoice.discountAmount.toLocaleString(undefined, {minimumFractionDigits: 2})}` : 'Add discount'}
                            </button>
                          )}
                        </div>
                        {getInvoiceAdjustmentsAmount(generatedInvoice) !== 0 && <div className="flex justify-end items-center gap-4"><span className="text-muted-foreground">Adjustments:</span> <span className="w-32 font-medium">PKR {getInvoiceAdjustmentsAmount(generatedInvoice).toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>}
                        <div className="flex justify-end items-center gap-4 text-lg font-bold"><span className="text-muted-foreground">Grand Total:</span> <span className="w-32">PKR {generatedInvoice.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                     </div>
                </div>

                <Separator />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                         <h3 className="font-semibold text-lg">Send to Customer</h3>
                         <div className="space-y-2">
                            <Label htmlFor="whatsapp-number">Customer WhatsApp Number</Label>
                             <PhoneField
                                value={phoneForm.watch('phone') || undefined}
                                onChange={(val) => phoneForm.setValue('phone', val || '')}
                                aria-label="WhatsApp number"
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
                            <AmountInput 
                                id="payment-amount" 
                                placeholder={`Balance due: ${generatedInvoice.balanceDue.toLocaleString()}`}
                                value={paymentAmount}
                                onValueChange={v => setPaymentAmount(v === undefined ? '' : String(v))}
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <Label className="text-xs">Paid by</Label>
                            <Select value={paymentMethod} onValueChange={v => setPaymentMethod(v as PaymentType)}>
                              <SelectTrigger aria-label="Payment method"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {PAYMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs">
                              {paymentMethod === 'Cheque' ? 'Cheque no.'
                                : paymentMethod === 'Card' ? 'Last 4 digits'
                                : paymentMethod === 'Bank Transfer' ? 'Reference' : 'Note'}
                            </Label>
                            <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
                              placeholder="Optional" aria-label="Payment reference"
                              disabled={paymentMethod === 'Cash'} />
                          </div>
                        </div>

                        <Button 
                            className="w-full"
                            disabled={!paymentAmount || isSubmittingPayment || generatedInvoice.balanceDue <= 0}
                            onClick={() => handleRecordPayment()}
                        >
                            {isSubmittingPayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <Banknote className="mr-2 h-4 w-4"/>}
                            Submit Payment
                        </Button>

                        {generatedInvoice.balanceDue > 0 && (
                          <Button
                            variant="secondary"
                            className="w-full"
                            disabled={isSubmittingPayment}
                            onClick={() => handleRecordPayment(generatedInvoice.balanceDue)}
                          >
                            {isSubmittingPayment
                              ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                              : <CheckCircle className="mr-2 h-4 w-4"/>}
                            Mark Paid — PKR {generatedInvoice.balanceDue.toLocaleString()}
                          </Button>
                        )}
                    </div>
                </div>
                 {generatedInvoice.paymentHistory && generatedInvoice.paymentHistory.length > 0 && (
                     <div>
                        <h3 className="text-lg font-semibold flex items-center mb-2"><List className="mr-2 h-5 w-5"/>Payment History</h3>
                        <div className="rounded-lg border overflow-hidden">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead><CalendarIcon className="h-4 w-4 inline-block mr-1"/> Date</TableHead>
                                            <TableHead>Method</TableHead>
                                            <TableHead className="hidden sm:table-cell">Notes</TableHead>
                                            <TableHead className="text-right">Amount (PKR)</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {generatedInvoice.paymentHistory.map((p, index) => (
                                            <TableRow key={index}>
                                                <TableCell>{format(new Date(p.date), 'PP')}</TableCell>
                                                <TableCell>
                                                  {/* Older records predate payment types and have no method. */}
                                                  {p.method
                                                    ? <Badge variant="outline" className="text-2xs">{p.method}</Badge>
                                                    : <span className="text-muted-foreground text-xs">—</span>}
                                                  {p.reference && <span className="block text-2xs text-muted-foreground mt-0.5">{p.reference}</span>}
                                                </TableCell>
                                                <TableCell className="hidden sm:table-cell">{p.notes || 'Payment received'}</TableCell>
                                                <TableCell className="text-right font-medium">{p.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                        </div>
                        <Alert variant="default" className="mt-4 bg-success/10 border-success/30 text-success">
                            <Check className="h-4 w-4 text-success"/>
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
      {invoiceDraft && (
        <DraftRestoreBanner
          savedAt={invoiceDraft.savedAt}
          noun="invoice"
          onRestore={restoreInvoiceDraft}
          onDiscard={discardInvoiceDraft}
        />
      )}
      {/* Warn before clearing an active sale when a preloaded invoice link is opened */}
      <AlertDialog open={isCartClearWarningOpen} onOpenChange={setIsCartClearWarningOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear current sale?</AlertDialogTitle>
            <AlertDialogDescription>
              You have items in your current sale. Opening this invoice will discard them. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingPreloadedInvoice(null)}>Keep current sale</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
              if (pendingPreloadedInvoice) {
                clearCart();
                setGeneratedInvoice(pendingPreloadedInvoice);
                setPendingPreloadedInvoice(null);
              }
              setIsCartClearWarningOpen(false);
            }}>
              Discard &amp; Open Invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isRefundDialogOpen} onOpenChange={setIsRefundDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund Invoice {(generatedInvoice as InvoiceType | null)?.id}</AlertDialogTitle>
            <AlertDialogDescription>
              {refundMode === 'full'
                ? 'A full refund deletes the invoice, removes all hisaab entries, and returns all items to stock. This cannot be undone.'
                : 'A partial refund records a negative payment on this invoice and issues a matching refund on Shopify. The invoice stays in your records.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={refundMode === 'full' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRefundMode('full')}
                disabled={isRefunding}
              >Full refund</Button>
              <Button
                type="button"
                variant={refundMode === 'partial' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRefundMode('partial')}
                disabled={isRefunding}
              >Partial refund</Button>
            </div>

            {refundMode === 'partial' && (
              <div className="space-y-2 pt-2">
                <Label htmlFor="refund-amount">Refund amount (PKR)</Label>
                <AmountInput
                  id="refund-amount"
                  inputMode="decimal"
                  placeholder="e.g. 1500"
                  value={partialRefundAmount}
                  onValueChange={v => setPartialRefundAmount(v === undefined ? '' : String(v))}
                  disabled={isRefunding}
                />
                <Label htmlFor="refund-reason">Reason (optional)</Label>
                <Input
                  id="refund-reason"
                  placeholder="e.g. damaged item"
                  value={partialRefundReason}
                  onChange={e => setPartialRefundReason(e.target.value)}
                  disabled={isRefunding}
                />
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRefunding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRefundInvoice}
              disabled={isRefunding || (refundMode === 'partial' && !(parseFloat(partialRefundAmount) > 0))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRefunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
              {refundMode === 'full' ? 'Yes, Refund Invoice' : 'Record Partial Refund'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {cartItemsFromStore.length === 0 ? (
          <Card className="max-w-2xl mx-auto">
            <CardHeader className="text-center">
              <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground" />
              <CardTitle className="text-2xl mt-4">Add the first piece</CardTitle>
              <CardDescription>
                Add some products to the cart from the Products page or by using the QR scanner to create an estimate.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Describing the piece is the common case here; scanning an
                  already-tagged product is the exception. */}
              <Button className="w-full" size="lg" onClick={() => setNewItem(blankCartItem())}>
                <PlusCircle className="mr-2 h-5 w-5" />New item
              </Button>
              <p className="text-xs text-muted-foreground text-center -mt-1">
                Bills the piece without touching your inventory.
              </p>
              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={() => setIsNewProductDialogOpen(true)}>
                  New item + stock it
                </Button>
                <Button className="flex-1" variant="outline" asChild>
                  <Link href="/scan">Scan</Link>
                </Button>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    ref={skuInputRef}
                    placeholder="Search by SKU or product name..."
                    value={skuInput}
                    onChange={e => handleSkuInputChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddBySku(); if (e.key === 'Escape') setSkuDropdownOpen(false); }}
                    onBlur={() => setTimeout(() => setSkuDropdownOpen(false), 150)}
                    onFocus={() => skuSuggestions.length > 0 && setSkuDropdownOpen(true)}
                   aria-label="Search by SKU or product name"/>
                  {skuDropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                      {skuSuggestions.map(p => (
                        <button
                          key={p.sku}
                          type="button"
                          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent text-sm"
                          onMouseDown={() => handleAddBySku(p.sku)}
                        >
                          <span className="font-mono font-semibold text-xs text-muted-foreground shrink-0">{p.sku}</span>
                          <span className="truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button variant="secondary" onClick={() => handleAddBySku()}>
                  <PlusCircle className="h-4 w-4 mr-1"/> Add
                </Button>
                <Button variant="outline" onClick={() => setIsNewProductDialogOpen(true)}>
                  New
                </Button>
              </div>
            </CardContent>
          </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center"><Link href="/new" aria-label="Back"><ArrowLeft className="mr-4 h-5 w-5"/></Link> New Invoice</CardTitle>
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
                                                {item.size && <p className="text-xs text-muted-foreground">Size: {item.size}</p>}
                                                <p className="text-xs text-muted-foreground">{item.sku}</p>
                                                {item.metalType === 'silver' && item.isCustomPrice && (
                                                    <p className="text-xs text-warning font-medium">Manual: PKR {item.customPrice?.toLocaleString()}</p>
                                                )}
                                                {item.metalType === 'silver' && !item.isCustomPrice && item.silverRatePerGram && (
                                                    <p className="text-xs text-blue-500">Rate: {item.silverRatePerGram}/g · {item.metalWeightG}g</p>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold">PKR {calculateProductCosts(item, settings).totalPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                                            <TableCell className="w-20">
                                                <div className="flex items-center gap-1">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setEditItem(item)}>
                                                        <Edit className="h-4 w-4"/>
                                                    </Button>
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
                    <CardFooter className="flex flex-col gap-3 items-stretch">
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                              <Input
                                ref={skuInputRef}
                                placeholder="Search by SKU or product name..."
                                value={skuInput}
                                onChange={e => handleSkuInputChange(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleAddBySku(); if (e.key === 'Escape') setSkuDropdownOpen(false); }}
                                onBlur={() => setTimeout(() => setSkuDropdownOpen(false), 150)}
                                onFocus={() => skuSuggestions.length > 0 && setSkuDropdownOpen(true)}
                               aria-label="Search by SKU or product name"/>
                              {skuDropdownOpen && (
                                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                                  {skuSuggestions.map(p => (
                                    <button
                                      key={p.sku}
                                      type="button"
                                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent text-sm"
                                      onMouseDown={() => handleAddBySku(p.sku)}
                                    >
                                      <span className="font-mono font-semibold text-xs text-muted-foreground shrink-0">{p.sku}</span>
                                      <span className="truncate">{p.name}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <Button variant="secondary" onClick={() => handleAddBySku()}>
                                <PlusCircle className="h-4 w-4 mr-1"/> Add
                            </Button>
                            {/* Two different intents that used to share one "New"
                                button: a one-off piece for this bill, versus a
                                product you want to keep in the catalogue. */}
                            <Button onClick={() => setNewItem(blankCartItem())}>
                                <PlusCircle className="h-4 w-4 mr-1"/> New item
                            </Button>
                            <Button variant="outline" onClick={() => setIsNewProductDialogOpen(true)}
                                title="Also saves the piece to your product inventory">
                                + Stock
                            </Button>
                        </div>
                        <Button variant="outline" onClick={clearCart} className="w-full">Clear All Items</Button>
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
                        <div className="space-y-2">
                            <Label>Customer Name</Label>
                            <CustomerAutocomplete
                                customers={customers}
                                value={walkInCustomerName}
                                placeholder="Type customer name..."
                                onSelect={({ name, customerId, phone }) => {
                                    setWalkInCustomerName(name);
                                    setSelectedCustomerId(customerId || WALK_IN_CUSTOMER_VALUE);
                                    if (phone !== undefined) setWalkInCustomerPhone(normalizePhoneNumber(phone));
                                }}
                            />
                        </div>
                        <div>
                            <Label>Contact <span className="text-muted-foreground text-xs">(Optional)</span></Label>
                            <PhoneField
                                value={walkInCustomerPhone || undefined}
                                onChange={(val) => setWalkInCustomerPhone(val || '')}
                                aria-label="Customer contact"
                            />
                        </div>
                        <Separator />
                        <div className="space-y-2">
                             <Label>Gold Rates (PKR)</Label>
                             <div className="grid grid-cols-2 gap-2">
                                {cartMetalInfo.karats.has('18k') && <div><Label className="text-xs">18k/gram</Label><Input value={rateInputs.gold18k} onChange={e => handleRateChange('gold18k', e.target.value)}  aria-label="18k/gram"/></div>}
                                {cartMetalInfo.karats.has('21k') && <div><Label className="text-xs">21k/gram</Label><Input value={rateInputs.gold21k} onChange={e => handleRateChange('gold21k', e.target.value)}  aria-label="21k/gram"/></div>}
                                {cartMetalInfo.karats.has('22k') && <div><Label className="text-xs">22k/gram</Label><Input value={rateInputs.gold22k} onChange={e => handleRateChange('gold22k', e.target.value)}  aria-label="22k/gram"/></div>}
                                {cartMetalInfo.karats.has('24k') && <div><Label className="text-xs">24k/gram</Label><Input value={rateInputs.gold24k} onChange={e => handleRateChange('gold24k', e.target.value)}  aria-label="24k/gram"/></div>}
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
                            <AmountInput id="discount" value={discountAmountInput}
                              onValueChange={v => setDiscountAmountInput(v === undefined ? '' : String(v))}
                              className="w-32 text-right" placeholder="0" aria-label="Discount" />
                        </div>
                        <div className="space-y-2 p-3 border rounded-md bg-muted/40">
                            <Label className="text-sm font-medium">Exchange / Trade-in</Label>
                            <Input placeholder="Description (e.g. Old 22k ring)" value={exchangeDescription} onChange={e => setExchangeDescription(e.target.value)}  aria-label="Exchange / Trade-in"/>
                            <div className="grid grid-cols-2 gap-2">
                                <AmountInput placeholder="Amount 1 (PKR)" value={exchangeAmount1Input} onValueChange={v => setExchangeAmount1Input(v === undefined ? '' : String(v))}  aria-label="Amount 1 (PKR)"/>
                                <AmountInput placeholder="Amount 2 (PKR)" value={exchangeAmount2Input} onValueChange={v => setExchangeAmount2Input(v === undefined ? '' : String(v))}  aria-label="Amount 2 (PKR)"/>
                            </div>
                        </div>
                        <Separator />

                        {/* Sits with the bill rather than the customer block:
                            whether a piece is delivered is part of the sale. */}
                        <DeliveryFields
                          value={delivery}
                          onChange={setDelivery}
                          knownAddresses={knownAddressesFor(
                            selectedCustomerId || undefined,
                            customers.find(c => c.id === selectedCustomerId)?.address,
                            allInvoices,
                          )}
                        />

                        <Separator />
                        <div className="flex justify-between font-bold text-xl"><span className="text-primary">Total</span><span>PKR {estimatedInvoice?.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2}) || '...'}</span></div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-2">
                         <Button size="lg" className="w-full" onClick={handleGenerateInvoice} disabled={!estimatedInvoice || isGeneratingEstimate}>
                            {isGeneratingEstimate ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <FileText className="mr-2 h-5 w-5"/>}
                            {isEditingEstimate ? 'Update Estimate' : 'Create Invoice'}
                        </Button>
                        {/* The same basket has two destinations: bill it now, or
                            send it to the bench as an order. Both continue on the
                            paths that already exist. */}
                        {!isEditingEstimate && (
                          <>
                            <Button size="lg" variant="outline" className="w-full"
                              disabled={cartItemsFromStore.length === 0}
                              onClick={() => router.push('/orders/add?fromCart=1')}>
                              <ClipboardList className="mr-2 h-5 w-5" />Create Order
                            </Button>
                            <p className="text-xs text-muted-foreground text-center">
                              Invoice bills it now. Order sends it to the workshop first, with an advance if taken.
                            </p>
                          </>
                        )}
                        {isEditingEstimate && (
                            <Button size="lg" variant="outline" className="w-full" onClick={handleCancelEdit}>
                                <Ban className="mr-2 h-5 w-5"/> Cancel Edit
                            </Button>
                        )}
                    </CardFooter>
                </Card>
            </div>
        </div>
      )}

      {/* New Product Dialog */}
      <Dialog open={isNewProductDialogOpen} onOpenChange={setIsNewProductDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New item, and keep it in stock</DialogTitle>
            <DialogDescription>
              Adds the piece to this bill <em>and</em> saves it to your product inventory.
              For a one-off you will not sell again, use <span className="font-medium">New item</span> instead.
            </DialogDescription>
          </DialogHeader>
          <ProductForm
            onProductCreated={(newProduct) => {
              addProductToCart(newProduct);
              setIsNewProductDialogOpen(false);
              toast({ title: 'Added to cart', description: `${newProduct.name} (${newProduct.sku})` });
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Silver Item Edit Dialog */}
      <EditCartItemDialog
        mode="create"
        item={newItem}
        settings={settings}
        onClose={() => setNewItem(null)}
        onSave={(_sku, patch) => {
          const product = { ...(newItem as Product), ...patch } as Product;
          addProductToCart(product);
          toast({ title: 'Added to bill', description: product.name });
        }}
      />

      <EditCartItemDialog
        item={editItem}
        settings={settings}
        onClose={() => setEditItem(null)}
        onSave={(sku, patch) => updateCartItem(sku, patch)}
      />
    </div>
  );
}
