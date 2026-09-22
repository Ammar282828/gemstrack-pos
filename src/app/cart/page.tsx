

"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { whatsAppLink } from '@/lib/whatsapp';
import Image from 'next/image';
import Link from 'next/link';
import { EditCartItemDialog, blankCartItem } from '@/components/cart/edit-cart-item-dialog';
import { DeliveryFields, EMPTY_DELIVERY, knownAddressesFor } from '@/components/shared/delivery-fields';
import { useRouter } from 'next/navigation';
import { useAppStore, Customer, Settings, InvoiceItem, Invoice as InvoiceType, calculateProductCosts, Product, MetalType, KaratValue, DeliveryInfo, PAYMENT_TYPES, PaymentType } from '@/lib/store';
import { describeMetal, describeSettings, describeDelivery, describePlating } from '@/lib/materials';
import { categorySingular } from '@/lib/categories';
import { Textarea } from '@/components/ui/textarea';
import { STORE_CONFIG, storeLinksUrl, STORE_LOGO_URL } from '@/lib/store-config';
import { CustomerAutocomplete } from '@/components/customer/customer-autocomplete';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, Minus, ShoppingCart, FileText, ClipboardList, User, XCircle, Settings as SettingsIcon, Percent, Info, Loader2, MessageSquare, Check, Banknote, Edit, ArrowLeft, PlusCircle, CalendarIcon, List, RotateCcw, Ban, CheckCircle, Camera, TriangleAlert, Lock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { alignHeadCell, label } from '@/lib/pdf-chrome';

/** Shared by the table and by alignHeadCell, which needs the same object. */
const INVOICE_COLUMNS = {
  0: { cellWidth: 7, halign: 'center' },
  1: { cellWidth: 'auto' },
  2: { cellWidth: 9, halign: 'right' },
  3: { cellWidth: 22, halign: 'right' },
  4: { cellWidth: 22, halign: 'right' },
} as const;
import { saveInvoicePdf } from '@/lib/invoice-pdf';
import { PrintButton } from '@/components/shared/print-button';
import QRCode from 'qrcode.react';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import 'react-phone-number-input/style.css';
import { cn, normalizePhoneNumber } from '@/lib/utils';
import { getInvoiceAdjustmentsAmount, getInvoiceExchangeTotal } from '@/lib/financials';
import { stockSku } from '@/lib/sku';
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
import { TakenByPicker } from '@/components/shared/taken-by-picker';
import { Switch } from '@/components/ui/switch';
import { BillScanner, type ScannedBill } from '@/components/cart/bill-scanner';
import { reconcile } from '@/lib/vision/bill-draft';
import type { TakenBy } from '@/lib/store';


type RateInputs = {
    gold18k: string;
    palladium18k: string;
    palladium12k: string;
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
    gold18k: '', gold21k: '', gold22k: '', gold24k: '', palladium: '', palladium18k: '', palladium12k: '', platinum: '', silver: ''
  });
  
  const [discountAmountInput, setDiscountAmountInput] = useState<string>('0');

  const [exchangeDescription, setExchangeDescription] = useState('');

  const [takenBy, setTakenBy] = useState<TakenBy | undefined>(undefined);
  // Print the bill without the per-gram rates. Pricing is unaffected; see Invoice.hideRates.
  const [hideRates, setHideRates] = useState(false);
  // See Invoice.internalNote: for the shop, never for the customer.
  const [internalNote, setInternalNote] = useState('');
  const [exchangeAmount1Input, setExchangeAmount1Input] = useState<string>('');
  const [exchangeAmount2Input, setExchangeAmount2Input] = useState<string>('');
  // Everything typed around the cart — who it is for, the discount, anything
  // taken in exchange. The items themselves already survive a reload via the
  // store; this is the rest of the sale.
  const invoiceDraftValue = useMemo(() => ({
    walkInCustomerName, walkInCustomerPhone, discountAmountInput,
    exchangeDescription, exchangeAmount1Input, exchangeAmount2Input, internalNote,
  }), [walkInCustomerName, walkInCustomerPhone, discountAmountInput,
       exchangeDescription, exchangeAmount1Input, exchangeAmount2Input, internalNote]);


  
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
    setInternalNote(d.internalNote || '');
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

  /**
   * A photographed bill, landed in the cart.
   *
   * The lines arrive already sorted into priced and as-written by the scanner; from
   * here they are ordinary cart items and every control on this page works on them.
   * The bill's own total is kept aside rather than applied — the cart prices the
   * broken-down lines at today's rate, so the two figures are allowed to disagree and
   * the point is to show it when they do.
   */
  const acceptScannedBill = (bill: ScannedBill) => {
    bill.items.forEach(addProductToCart);
    if (bill.customerId) setSelectedCustomerId(bill.customerId);
    setScannedBillTotal(bill.writtenTotal);
    toast({
      title: `${bill.items.length} line${bill.items.length === 1 ? '' : 's'} added`,
      description: 'Check them against the bill before invoicing.',
    });
  };

  // Line-item editor — every attribute of the line, any metal.
  const [editItem, setEditItem] = useState<Product | null>(null);
  // Most pieces here are made to order and never existed in inventory, so
  // billing starts by describing the piece rather than looking one up.
  const [newItem, setNewItem] = useState<Product | null>(null);
  const [billScanOpen, setBillScanOpen] = useState(false);
  // What the scanned bill said it came to. Kept so the cart can check its own
  // arithmetic against the paper's, which is how a missed line gets caught.
  const [scannedBillTotal, setScannedBillTotal] = useState<number | null>(null);
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
        palladium18k: (settings.palladiumRatePerGram18k || 0).toFixed(2),
        palladium12k: (settings.palladiumRatePerGram12k || 0).toFixed(2),
        platinum: (settings.platinumRatePerGram || 0).toFixed(2),
        silver: (settings.silverRatePerGram || 0).toFixed(2),
      });
    }
  }, [appReady, settings, isEditingEstimate]);
  
  const cartMetalInfo = useMemo(() => {
    const metals = new Set<MetalType>();
    const karats = new Set<KaratValue>();
    // Palladium karats separately: both metals use 18k, and one shared set cannot say
    // whether an 18k in the cart is gold, palladium, or both.
    const palladiumKarats = new Set<KaratValue>();
    cartItemsFromStore.forEach(item => {
        metals.add(item.metalType);
        if (!item.karat) return;
        if (item.metalType === 'gold') karats.add(item.karat);
        else if (item.metalType === 'palladium') palladiumKarats.add(item.karat);
    });
    return { metals, karats, palladiumKarats };
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
        palladiumRatePerGram18k: parseFloat(rateInputs.palladium18k) || settings.palladiumRatePerGram18k,
        palladiumRatePerGram12k: parseFloat(rateInputs.palladium12k) || settings.palladiumRatePerGram12k,
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


  /**
   * Why the Create Invoice button is disabled, in words.
   *
   * The button is gated on `estimatedInvoice`, which silently becomes null when
   * a gold rate is missing — and rates initialise from settings as
   * `(rate || 0).toFixed(2)`, so an unset rate arrives as "0.00" and fails the
   * `rate <= 0` check. The explanation for that used to live inside
   * handleGenerateInvoice, which can never run while the button is disabled, so
   * nobody ever saw it. Surface it next to the button instead.
   */
  const invoiceBlockedReason = useMemo((): string | null => {
    if (!appReady || !settings) return null;
    if (settings.databaseLocked) return 'The database is locked. Unlock it in Settings to create invoices.';
    if (cartItemsFromStore.length === 0) return 'Add an item to the cart first.';

    const missing: string[] = [];
    cartMetalInfo.karats.forEach(k => {
      const rate = parseFloat(rateInputs[`gold${k}` as keyof RateInputs]);
      if (isNaN(rate) || rate <= 0) missing.push(k.toUpperCase());
    });
    if (missing.length > 0) {
      return `Enter a ${missing.join(' and ')} gold rate above — it is currently zero, so the total cannot be worked out.`;
    }
    return null;
  }, [appReady, settings, cartItemsFromStore, rateInputs, cartMetalInfo]);

  const handleGenerateInvoice = async () => {
    if (isGeneratingEstimate) return; // Prevent double-submit

    // The database lock is a deliberate admin switch, but every write path below
    // it just returns null. Without this the button looks broken rather than
    // locked: no toast, and nothing in the console either, because
    // generateInvoice bails before its first log line.
    if (settings?.databaseLocked) {
      toast({
        title: "Database is locked",
        description: "Invoicing is turned off while the database is locked. Unlock it in Settings to create invoices.",
        variant: "destructive",
      });
      return;
    }

    if (cartItemsFromStore.length === 0) {
      toast({ title: "Nothing to bill", description: "Add a piece before creating an invoice.", variant: "destructive" });
      return;
    }
    
    if (!estimatedInvoice) {
        toast({ title: "Check the figures", description: "A rate or amount is not a valid number.", variant: "destructive" });
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
            palladiumRatePerGram18k: parseFloat(rateInputs.palladium18k) || settings.palladiumRatePerGram18k,
        palladiumRatePerGram12k: parseFloat(rateInputs.palladium12k) || settings.palladiumRatePerGram12k,
        goldRatePerGram18k: parseFloat(rateInputs.gold18k) || settings.goldRatePerGram18k,
            goldRatePerGram21k: parseFloat(rateInputs.gold21k) || settings.goldRatePerGram21k,
            goldRatePerGram22k: parseFloat(rateInputs.gold22k) || settings.goldRatePerGram22k,
            goldRatePerGram24k: parseFloat(rateInputs.gold24k) || settings.goldRatePerGram24k,
        }),
        ...(cartMetalInfo.metals.has('palladium') && { palladiumRatePerGram: parseFloat(rateInputs.palladium) || settings.palladiumRatePerGram }),
        ...(cartMetalInfo.metals.has('platinum') && { platinumRatePerGram: parseFloat(rateInputs.platinum) || settings.platinumRatePerGram }),
        ...(cartMetalInfo.metals.has('silver') && { silverRatePerGram: parseFloat(rateInputs.silver) || settings.silverRatePerGram }),
    };

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
      invoice = await generateInvoiceAction(customerForInvoice, ratesForInvoice, parsedDiscountAmount, exchangeInfo, isEditingEstimate ? editingInvoiceId : undefined, delivery, takenBy, hideRates, internalNote);
      if (invoice) invoiceDraftDone();
    } catch (error) {
      console.error("[Cart handleGenerateInvoice] Failed:", error);
      toast({
        title: "Could not create the invoice",
        description: error instanceof Error ? error.message : "Something went wrong while saving. Please try again.",
        variant: "destructive",
      });
      return;
    } finally {
      setIsGeneratingEstimate(false);
    }

    // Keep the rates for next time — after the invoice, not before it.
    //
    // This used to be awaited first, which put a whole round-trip between the click and
    // anything happening, for a write nobody was waiting on: updateSettings merges into
    // local state immediately, so the screen is already right, and the invoice is priced
    // from ratesForInvoice in hand rather than from what is stored. It also writes the
    // same settings document the invoice transaction touches, so running the two at once
    // would trade the delay for a retry. After is both faster and safer.
    void updateSettings(ratesForInvoice).catch((err) => {
      console.error('[Cart handleGenerateInvoice] rates not persisted:', err);
      toast({
        title: "Rates not saved",
        description: "The invoice is saved. The new rates were not kept for next time — set them in Settings.",
        variant: "destructive",
      });
    });

    if (invoice) {
      setGeneratedInvoice(invoice);
      if(invoice.customerContact) {
          phoneForm.setValue('phone', normalizePhoneNumber(invoice.customerContact));
      }
      setIsEditingEstimate(false);
      isEditingEstimateRef.current = false;
      setEditingInvoiceId(undefined);
      toast({ title: "Invoice created", description: `${invoice.id} is ready to print or send.` });
    } else {
      toast({ title: "Could not create the invoice", description: "Check the figures and try again.", variant: "destructive" });
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
    setHideRates(!!generatedInvoice.hideRates);
    setInternalNote(generatedInvoice.internalNote || '');
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
        // The invoice's own stamp first, so reopening an old estimate reprices it at the
        // rates it was written with rather than today's.
        palladium18k: (generatedInvoice.ratesApplied.palladiumRatePerGram18k || settings.palladiumRatePerGram18k || 0).toFixed(2),
        palladium12k: (generatedInvoice.ratesApplied.palladiumRatePerGram12k || settings.palladiumRatePerGram12k || 0).toFixed(2),
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

  /**
   * Open WhatsApp to the customer, message written, estimate linked.
   *
   * This used to detour through the share sheet when the device had one: build the
   * PDF, hand it to navigator.share, and return -- so on a phone the button labelled
   * "Send via WhatsApp" opened the same sheet Print opens and never went near a chat.
   * The wa.me path only ran on desktop, and after an await, which a phone would have
   * refused as a popup anyway.
   *
   * Now it does what it says. Synchronously, so the tap's activation is still there
   * when window.open asks for it; the same shape as the order page and the ledger,
   * which never had the detour and always worked. The estimate goes as a link to its
   * own page rather than as an attached PDF -- wa.me cannot carry a file. Anyone who
   * wants the PDF in the chat has Print, whose sheet lists WhatsApp.
   */
  const handleSendWhatsApp = (invoiceToSend: InvoiceType) => {
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

    const appUrl = typeof window !== 'undefined' ? window.location.origin : STORE_CONFIG.appUrl;
    message += `\n\nView estimate: ${appUrl}/view-invoice/${invoiceToSend.id}`;
    // Country code and leading-zero handling live in one place; the raw
    // digit strip that used to be here produced wa.me/0300… , a dead link.
    window.open(whatsAppLink(whatsAppNumber, message), '_blank');
    toast({ title: "Opening WhatsApp", description: "The message is written — press send." });
  };


  const printInvoice = async (invoiceToPrint: InvoiceType, perPiece = false) => {
    // Anything that threw while drawing became an unhandled rejection: the
    // button did nothing and said nothing.
    try {
      const customer = invoiceToPrint.customerId ? customers.find(c => c.id === invoiceToPrint.customerId) : null;
      await saveInvoicePdf(invoiceToPrint, { customer, perPiece });
    } catch (e) {
      console.error('[GemsTrack] invoice PDF failed', e);
      toast({
        title: 'Could not create the PDF',
        description: e instanceof Error ? e.message : 'Something went wrong while drawing it.',
        variant: 'destructive',
      });
    }
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
          <QRCode id="links-qr-code" value={storeLinksUrl()} size={128} />
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
                      <Edit className="mr-2 h-4 w-4"/> Edit invoice
                    </Button>
                     <PrintButton
                      variant="default" size="default"
                      pieces={Array.isArray(generatedInvoice.items) ? generatedInvoice.items.length : Object.keys(generatedInvoice.items || {}).length}
                      onPrint={() => printInvoice(generatedInvoice)}
                      onPrintPerPiece={() => printInvoice(generatedInvoice, true)}
                    />
                    <Button variant="outline" onClick={() => setIsRefundDialogOpen(true)} className="border-destructive text-destructive hover:bg-destructive/10">
                      <RotateCcw className="mr-2 h-4 w-4"/> Refund
                    </Button>
                 </div>
            </div>
           </CardHeader>
           <CardContent className="space-y-6">
                {generatedInvoice.internalNote && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
                    <p className="font-semibold flex items-center text-warning"><Lock className="w-3.5 h-3.5 mr-1.5"/>For the shop <span className="ml-1.5 font-normal">(never printed)</span></p>
                    <p className="text-warning whitespace-pre-wrap mt-1">{generatedInvoice.internalNote}</p>
                  </div>
                )}
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
                        if (stockSku(item.sku)) spec.push(['SKU', item.sku]);

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
                                    {categorySingular(item.itemCategory) || item.itemCategory}
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
                        {/* The trade-in the customer brought in. It was already taken
                            off the total and printed on the bill, but never shown here,
                            so the figures on screen did not add up. */}
                        {getInvoiceExchangeTotal(generatedInvoice) > 0 && (
                          <div className="flex justify-end items-start gap-4">
                            <span className="text-muted-foreground text-right">
                              Exchange{generatedInvoice.exchangeDescription ? ` (${generatedInvoice.exchangeDescription})` : ''}:
                              {!!generatedInvoice.exchangeAmount1 && !!generatedInvoice.exchangeAmount2 && (
                                <span className="block text-xs">
                                  {generatedInvoice.exchangeAmount1.toLocaleString()} + {generatedInvoice.exchangeAmount2.toLocaleString()}
                                </span>
                              )}
                            </span>
                            <span className="w-32 font-medium flex-shrink-0">- PKR {getInvoiceExchangeTotal(generatedInvoice).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                          </div>
                        )}
                        {getInvoiceAdjustmentsAmount(generatedInvoice) !== 0 && <div className="flex justify-end items-center gap-4"><span className="text-muted-foreground">Adjustments:</span> <span className="w-32 font-medium">PKR {getInvoiceAdjustmentsAmount(generatedInvoice).toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>}
                        <div className="flex justify-end items-center gap-4 text-lg font-bold"><span className="text-muted-foreground">Grand Total:</span> <span className="w-32">PKR {generatedInvoice.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                        {generatedInvoice.amountPaid > 0 && (
                          <div className="flex justify-end items-center gap-4 text-success"><span>Paid:</span> <span className="w-32 font-medium">PKR {generatedInvoice.amountPaid.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                        )}
                        <div className={cn('flex justify-end items-center gap-4 font-semibold', generatedInvoice.balanceDue > 0 ? 'text-destructive' : 'text-muted-foreground')}><span>Balance due:</span> <span className="w-32">PKR {generatedInvoice.balanceDue.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></div>
                     </div>
                </div>

                <Separator />
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                         <h3 className="font-semibold text-lg">Send to customer</h3>
                         <div className="space-y-2">
                            <Label htmlFor="whatsapp-number">WhatsApp number</Label>
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
                        <h3 className="font-semibold text-lg">Record a payment</h3>
                        {generatedInvoice.balanceDue <= 0 ? (
                          <p className="text-sm text-muted-foreground">Nothing outstanding on this invoice.</p>
                        ) : (
                        <>
                        <div className="space-y-2">
                            <Label htmlFor="payment-amount">Amount received (PKR)</Label>
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
                            Record payment
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
                            Mark paid — PKR {generatedInvoice.balanceDue.toLocaleString()}
                          </Button>
                        )}
                        </>
                        )}
                    </div>
                </div>
                 {generatedInvoice.paymentHistory && generatedInvoice.paymentHistory.length > 0 && (
                     <div>
                        <h3 className="text-lg font-semibold flex items-center mb-2"><List className="mr-2 h-5 w-5"/>Payment history</h3>
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
                     </div>
                 )}

           </CardContent>
        </Card>
      </div>
    );
  }
  
  return (
    <div className="container mx-auto py-8 px-4 pb-28 lg:pb-8">
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
              <CardTitle className="text-2xl mt-4">New sale</CardTitle>
              <CardDescription>Describe the piece, or find it in stock.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* One button and one search. Six controls used to share this card;
                  the three used once a week are a line of links underneath. */}
              <Button className="w-full" size="lg" onClick={() => setNewItem(blankCartItem())}>
                <PlusCircle className="mr-2 h-5 w-5" />New item
              </Button>
              <div className="relative">
                <Input
                  ref={skuInputRef}
                  placeholder="Or search stock by SKU or name…"
                  value={skuInput}
                  onChange={e => handleSkuInputChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddBySku(); if (e.key === 'Escape') setSkuDropdownOpen(false); }}
                  onBlur={() => setTimeout(() => setSkuDropdownOpen(false), 150)}
                  onFocus={() => skuSuggestions.length > 0 && setSkuDropdownOpen(true)}
                  aria-label="Search stock by SKU or product name"/>
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
              <p className="text-center text-xs text-muted-foreground pt-1">
                <button type="button" className="hover:underline" onClick={() => setIsNewProductDialogOpen(true)}>New item + stock it</button>
                <span className="mx-1.5">·</span>
                <Link href="/scan" className="hover:underline">Scan a tag</Link>
                <span className="mx-1.5">·</span>
                <button type="button" className="hover:underline" onClick={() => setBillScanOpen(true)}>Photograph a bill</button>
              </p>
            </CardContent>
          </Card>
      ) : (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center">
                          <Link href="/new" aria-label="Back"><ArrowLeft className="mr-4 h-5 w-5"/></Link>
                          {isEditingEstimate && editingInvoiceOriginalRef.current ? `Editing ${editingInvoiceOriginalRef.current.id}` : 'New invoice'}
                        </CardTitle>
                        <CardDescription>{cartItemsFromStore.length} piece{cartItemsFromStore.length === 1 ? '' : 's'} on this bill.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ul className="divide-y">
                            {cartItemsFromStore.map(item => {
                                const spec = [
                                  describeMetal(item.metalType, item.karat),
                                  (item.metalWeightG ?? 0) > 0 ? `${item.metalWeightG}g` : null,
                                  item.size ? `Size ${item.size}` : null,
                                ].filter(Boolean).join(' · ');
                                return (
                                <li key={item.sku} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                                    <div className="min-w-0 flex-1">
                                        <p className="font-medium truncate">{item.name}</p>
                                        <p className="text-xs text-muted-foreground">{spec}</p>
                                        {stockSku(item.sku) && <p className="text-2xs font-mono text-muted-foreground">{item.sku}</p>}
                                        {item.isCustomPrice && (
                                            <p className="text-xs text-warning font-medium">Fixed price: PKR {item.customPrice?.toLocaleString()}</p>
                                        )}
                                        {item.metalType === 'silver' && !item.isCustomPrice && item.silverRatePerGram && (
                                            <p className="text-xs text-blue-500">Rate: {item.silverRatePerGram}/g</p>
                                        )}
                                    </div>
                                    <span className="font-semibold tabular-nums whitespace-nowrap">PKR {calculateProductCosts(item, settings).totalPrice.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                                    <div className="flex items-center -mr-2">
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setEditItem(item)} aria-label={`Edit ${item.name}`}>
                                            <Edit className="h-4 w-4"/>
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeFromCart(item.sku)} aria-label={`Remove ${item.name}`}>
                                            <Trash2 className="h-4 w-4"/>
                                        </Button>
                                    </div>
                                </li>
                                );
                            })}
                        </ul>
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
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
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
                            <Button variant="outline" onClick={() => setBillScanOpen(true)}
                                title="Read a handwritten bill into the cart">
                                <Camera className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Scan bill</span>
                            </Button>
                            <Button variant="ghost" size="sm" onClick={clearCart} className="ml-auto text-muted-foreground hover:text-destructive">
                                <Trash2 className="h-4 w-4 mr-1.5" />Clear all
                            </Button>
                        </div>
                    </CardFooter>
                </Card>

                {/* The same non-printed box the order form gives every piece:
                    a resize still owed, a stone to swap, how the balance will be
                    settled. On the invoice, never on the paper. */}
                <Card>
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center"><Lock className="mr-2 h-4 w-4 text-warning"/>For the shop</CardTitle>
                        <CardDescription>Never printed on the bill or sent to the customer.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Textarea value={internalNote} onChange={e => setInternalNote(e.target.value)} rows={2}
                          placeholder="Changes still to make, promises given, anything to remember about this sale"
                          aria-label="Notes for the shop" className="border-warning/40 bg-warning/10" />
                    </CardContent>
                </Card>
            </div>

             {/* Sidebar */}
            <div className="lg:col-span-1 lg:sticky top-8 space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Customer</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center justify-between">
                            <Label>Taken by <span className="text-muted-foreground text-xs">(optional)</span></Label>
                            <TakenByPicker value={takenBy} onChange={setTakenBy} className="w-32" />
                        </div>
                        <div className="space-y-2">
                            <Label>Name</Label>
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
                            <Label>Contact <span className="text-muted-foreground text-xs">(optional)</span></Label>
                            <PhoneField
                                value={walkInCustomerPhone || undefined}
                                onChange={(val) => setWalkInCustomerPhone(val || '')}
                                aria-label="Customer contact"
                            />
                        </div>
                        <Separator />
                        {/* With the customer, as on the order form: the address
                            is theirs, even if the charge is the bill's. */}
                        <DeliveryFields
                          value={delivery}
                          onChange={setDelivery}
                          knownAddresses={knownAddressesFor(
                            selectedCustomerId || undefined,
                            customers.find(c => c.id === selectedCustomerId)?.address,
                            allInvoices,
                          )}
                        />
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">Pricing</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {/* Only the rates this bill actually uses. A silver-only
                            bill prices per piece and has none. */}
                        {(cartMetalInfo.karats.size > 0 || cartMetalInfo.metals.has('palladium')) && (
                          <>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <Label>Rates (PKR per gram)</Label>
                                    {/* The rates still price the bill; this only decides whether
                                        the paper says what they were. */}
                                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer" title="Prices stay the same. The invoice just won't show the per-gram rate.">
                                    <span>Off the bill</span>
                                    <Switch checked={hideRates} onCheckedChange={setHideRates} aria-label="Leave rates off the printed bill" />
                                </label>
                                </div>
                                {cartMetalInfo.karats.size > 0 && (
                                  <div className="space-y-1">
                                    <p className="text-2xs uppercase tracking-wide text-muted-foreground">Gold</p>
                             <div className="grid grid-cols-2 gap-2">
                                {cartMetalInfo.karats.has('18k') && <div><Label className="text-xs">18k/gram</Label><Input value={rateInputs.gold18k} onChange={e => handleRateChange('gold18k', e.target.value)}  aria-label="18k/gram"/></div>}
                                {cartMetalInfo.karats.has('21k') && <div><Label className="text-xs">21k/gram</Label><Input value={rateInputs.gold21k} onChange={e => handleRateChange('gold21k', e.target.value)}  aria-label="21k/gram"/></div>}
                                {cartMetalInfo.karats.has('22k') && <div><Label className="text-xs">22k/gram</Label><Input value={rateInputs.gold22k} onChange={e => handleRateChange('gold22k', e.target.value)}  aria-label="22k/gram"/></div>}
                                {cartMetalInfo.karats.has('24k') && <div><Label className="text-xs">24k/gram</Label><Input value={rateInputs.gold24k} onChange={e => handleRateChange('gold24k', e.target.value)}  aria-label="24k/gram"/></div>}
                             </div>
                                  </div>
                                )}
                        {cartMetalInfo.metals.has('palladium') && (
                          <div className="space-y-2">
                             <p className="text-2xs uppercase tracking-wide text-muted-foreground">Palladium</p>
                             <div className="grid grid-cols-2 gap-2">
                                {cartMetalInfo.palladiumKarats.has('18k') && <div><Label className="text-xs">18k/gram</Label><Input value={rateInputs.palladium18k} onChange={e => handleRateChange('palladium18k', e.target.value)} aria-label="Palladium 18k/gram"/></div>}
                                {cartMetalInfo.palladiumKarats.has('12k') && <div><Label className="text-xs">12k/gram</Label><Input value={rateInputs.palladium12k} onChange={e => handleRateChange('palladium12k', e.target.value)} aria-label="Palladium 12k/gram"/></div>}
                                {cartMetalInfo.palladiumKarats.size === 0 && <div><Label className="text-xs">flat /gram</Label><Input value={rateInputs.palladium} onChange={e => handleRateChange('palladium', e.target.value)} aria-label="Palladium rate per gram"/></div>}
                             </div>
                          </div>
                        )}
                            </div>
                            <Separator />
                          </>
                        )}
                        <div className="flex justify-between gap-3"><span>Subtotal</span><span className="text-right tabular-nums">PKR {estimatedInvoice?.subtotal.toLocaleString(undefined, {minimumFractionDigits: 2}) || '...'}</span></div>
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
                        <div className="flex justify-between font-bold text-xl"><span className="text-primary">Total</span><span>PKR {estimatedInvoice?.grandTotal.toLocaleString(undefined, {minimumFractionDigits: 2}) || '...'}</span></div>
                        {/* The scanned bill's own total against this one. A gap is
                            usually a line missed on a crowded slip -- obvious to
                            whoever is holding the paper, invisible to everything else. */}
                        {scannedBillTotal !== null && estimatedInvoice && (() => {
                          const check = reconcile({ customer: null, grandTotal: scannedBillTotal }, estimatedInvoice.grandTotal);
                          if (!check.differs) return (
                            <p className="text-xs text-muted-foreground text-right">Matches the written bill.</p>
                          );
                          const gap = estimatedInvoice.grandTotal - scannedBillTotal;
                          return (
                            <Alert variant="destructive">
                              <TriangleAlert className="h-4 w-4" />
                              <AlertTitle>This does not match the bill</AlertTitle>
                              <AlertDescription>
                                The bill says PKR {scannedBillTotal.toLocaleString()}, this comes to{' '}
                                PKR {estimatedInvoice.grandTotal.toLocaleString(undefined, {maximumFractionDigits: 0})}
                                {' '}({gap > 0 ? '+' : ''}{Math.round(gap).toLocaleString()}). Check for a line that was missed.
                              </AlertDescription>
                            </Alert>
                          );
                        })()}
                    </CardContent>
                    <CardFooter className="flex flex-col gap-2">
                         <Button size="lg" className="w-full" onClick={handleGenerateInvoice} disabled={!estimatedInvoice || isGeneratingEstimate}>
                            {isGeneratingEstimate ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <FileText className="mr-2 h-5 w-5"/>}
                            {isEditingEstimate ? 'Update invoice' : 'Create invoice'}
                        </Button>
                        {/* A disabled button with no explanation reads as broken. */}
                        {invoiceBlockedReason && (
                          <p className="text-xs text-destructive text-center">{invoiceBlockedReason}</p>
                        )}
                        {/* The same basket has two destinations: bill it now, or
                            send it to the bench as an order. Both continue on the
                            paths that already exist. */}
                        {!isEditingEstimate && (
                          <>
                            <Button size="lg" variant="outline" className="w-full"
                              disabled={cartItemsFromStore.length === 0}
                              onClick={() => router.push('/orders/add?fromCart=1')}>
                              <ClipboardList className="mr-2 h-5 w-5" />Create order
                            </Button>
                            <p className="text-xs text-muted-foreground text-center">
                              Invoice bills it now. Order sends it to the workshop first, with an advance if taken.
                            </p>
                          </>
                        )}
                        {isEditingEstimate && (
                            <Button size="lg" variant="outline" className="w-full" onClick={handleCancelEdit}>
                                <Ban className="mr-2 h-5 w-5"/> Cancel editing
                            </Button>
                        )}
                    </CardFooter>
                </Card>
            </div>
        </div>
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2.5 pr-20 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-2xs uppercase tracking-wide text-muted-foreground leading-none">Total</p>
                    <p className="text-base font-semibold tabular-nums truncate">
                        PKR {estimatedInvoice ? estimatedInvoice.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '…'}
                    </p>
                </div>
                <Button size="lg" className="shrink-0" onClick={handleGenerateInvoice} disabled={!estimatedInvoice || isGeneratingEstimate}>
                    {isGeneratingEstimate ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <FileText className="mr-2 h-5 w-5"/>}
                    {isEditingEstimate ? 'Update invoice' : 'Create invoice'}
                </Button>
            </div>
        </div>
        </>
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

      <BillScanner open={billScanOpen} onOpenChange={setBillScanOpen} onAccept={acceptScannedBill} />
    </div>
  );
}
