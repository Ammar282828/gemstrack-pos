

"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { EditCartItemDialog, blankCartItem } from '@/components/cart/edit-cart-item-dialog';
import { DeliveryFields, EMPTY_DELIVERY, knownAddressesFor } from '@/components/shared/delivery-fields';
import { useRouter } from 'next/navigation';
import { useAppStore, Customer, Settings, InvoiceItem, Invoice as InvoiceType, calculateProductCosts, Product, MetalType, KaratValue, DeliveryInfo, PAYMENT_TYPES, PaymentType, SalePayment } from '@/lib/store';
import { describeMetal } from '@/lib/materials';
import { Textarea } from '@/components/ui/textarea';
import { doc as fsDoc, getDoc as fsGetDoc } from 'firebase/firestore';
import { db as fsDb } from '@/lib/firebase';
import { INPUT_TO_RATE, ratesToKeep, type RateInputKey } from '@/lib/rates';
import { RateStaleNotice } from '@/components/rates/rate-chip';
import { CustomerAutocomplete } from '@/components/customer/customer-autocomplete';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, ShoppingCart, FileText, ClipboardList, Percent, Loader2, Check, Banknote, Edit, ArrowLeft, PlusCircle, Ban, CheckCircle, Camera, TriangleAlert, Lock, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import 'react-phone-number-input/style.css';
import { normalizePhoneNumber } from '@/lib/utils';
import { stockSku } from '@/lib/sku';
import { useSearchParams } from 'next/navigation';
import { ProductForm } from '@/components/product/product-form';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AmountInput } from '@/components/ui/amount-input';
import { ExchangeRows, type ExchangeRow, blankExchangeRow, rowsFromExchanges, exchangesFromRows, exchangeRowsTotal } from '@/components/shared/exchange-rows';
import { invoiceExchanges } from '@/lib/exchange';
import { FormSkeleton } from '@/components/shared/skeletons';
import { PhoneField } from '@/components/ui/phone-field';
import { useWorkDraft } from '@/components/drafts/use-work-drafts';
import { DraftsShortcut } from '@/components/drafts/draft-list';
import { SALE_DEFAULT_FIELDS, summarizeSale } from '@/lib/work-drafts';
import { resolveSaleCustomer } from '@/lib/walk-in';
import { TakenByPicker } from '@/components/shared/taken-by-picker';
import { Switch } from '@/components/ui/switch';
import { BillScanner, type ScannedBill } from '@/components/cart/bill-scanner';
import { reconcile, billLineToProduct, type BillLine } from '@/lib/vision/bill-draft';
import { takeHandoff } from '@/lib/voice/handoff';
import { STORE_CONFIG } from '@/lib/store-config';
import type { TakenBy } from '@/lib/store';
import { useMe } from '@/hooks/use-me';


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
/** This device's unfinished sale: the id of its draft in Drafts. */
const SALE_DRAFT_KEY = 'gemstrack:sale-draft';

/** One "Payment received" row in the cart, as typed (the amount stays a string until the invoice is written). */
interface SalePaymentRow { id: string; amount: string; method: PaymentType; reference: string }
const blankSalePayment = (method: PaymentType = 'Cash'): SalePaymentRow =>
  ({ id: Math.random().toString(36).slice(2, 9), amount: '', method, reference: '' });

// A temporary structure to hold the real-time calculated invoice preview
type EstimatedInvoice = {
    subtotal: number;
    grandTotal: number;
    items: (InvoiceItem & { originalPrice: number })[];
};


/**
 * While the cart holds an invoice being edited, its id (localStorage, beside the persisted cart): a
 * reload re-opens the edit instead of taking its pieces for a sale in progress, and a new sale that
 * finds it set empties the cart — those pieces belong to an invoice that exists.
 */
const EDIT_MARKER = 'gemstrack:cart-editing';
const readMarker = () => { try { return localStorage.getItem(EDIT_MARKER); } catch { return null; } };
const writeMarker = (id: string | null) => { try { if (id) localStorage.setItem(EDIT_MARKER, id); else localStorage.removeItem(EDIT_MARKER); } catch { /* private mode */ } };
/** A sale's pieces set aside while an invoice is edited, put back by the next new sale (a safety net
 *  under Drafts, which may not have written the last second before the edit opened). */
const HELD_KEY = 'gemstrack:cart-held';

/**
 * The sale form: a new sale (`/invoices/new`) or an invoice being changed (`/invoices/<id>/edit`).
 * Saving opens the invoice at `/invoices/<id>` (components/invoice/invoice-viewer.tsx), which never
 * touches the cart. It used to be all one page at `/cart`, which now only redirects (the audit of
 * 2026-10-01).
 */
export function SalePage({ editInvoiceId }: { editInvoiceId?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();

  const appReady = useAppReady();
  const { cartItemsFromStore, customers, settings, allInvoices, hasInvoicesLoaded, products, removeFromCart, clearCart, generateInvoice: generateInvoiceAction, loadCartFromInvoice, updateCartItem, updateSettings, addToCart, addProductToCart, loadCustomers, loadGeneratedInvoices, loadProducts } = useAppStore(state => ({
    cartItemsFromStore: state.cart,
    customers: state.customers,
    settings: state.settings,
    allInvoices: state.generatedInvoices,
    // A list that was refused counts as read: the invoice is then read by itself (and a refusal says so).
    hasInvoicesLoaded: state.hasInvoicesLoaded || !!state.invoicesError,
    products: state.products,
    removeFromCart: state.removeFromCart,
    clearCart: state.clearCart,
    generateInvoice: state.generateInvoice,
    loadCartFromInvoice: state.loadCartFromInvoice,
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
  
  const [rateInputs, setRateInputs] = useState<RateInputs>({
    gold18k: '', gold21k: '', gold22k: '', gold24k: '', palladium: '', palladium18k: '', palladium12k: '', platinum: '', silver: ''
  });
  // Where each box's figure came from (lib/rates.ts). Typed by hand: the only rates a new invoice
  // writes back to the shop's. Held (typed, or read off a scanned bill): no longer follows Settings.
  // Everything else tracks the shop's live rates.
  const [typedRates, setTypedRates] = useState<ReadonlySet<RateInputKey>>(() => new Set());
  const [heldRates, setHeldRates] = useState<ReadonlySet<RateInputKey>>(() => new Set());
  
  const [discountAmountInput, setDiscountAmountInput] = useState<string>('0');


  // A new sale starts as the signed-in person's (lib/people.ts); the picker shows it and changes it.
  const me = useMe();
  const [takenBy, setTakenBy] = useState<TakenBy | undefined>(me);
  // Print the bill without the per-gram rates. Pricing is unaffected; see Invoice.hideRates.
  const [hideRates, setHideRates] = useState(false);
  // See Invoice.internalNote: for the shop, never for the customer.
  const [internalNote, setInternalNote] = useState('');
  // Gold (or anything) taken in exchange — the same rows as on an order (lib/exchange.ts).
  const [exchangeRows, setExchangeRows] = useState<ExchangeRow[]>(() => [blankExchangeRow()]);
  // Payments taken as the invoice is written (the owner, 2026-09-25: "add payments as we make
  // the invoice"). One row to start; more for a bill paid part cash, part card. Blank rows
  // are ignored; generateInvoice files the rest in the invoice's payment history.
  const [salePayments, setSalePayments] = useState<SalePaymentRow[]>(() => [blankSalePayment()]);
  const [isEditingEstimate, setIsEditingEstimate] = useState(false);
  const isEditingEstimateRef = React.useRef(false);

  const [isGeneratingEstimate, setIsGeneratingEstimate] = useState(false);
  const editingInvoiceOriginalRef = React.useRef<InvoiceType | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | undefined>(undefined);
  // Editing while a sale is in progress and Drafts are off: the sale would be lost, so ask first.
  const [editBlocked, setEditBlocked] = useState<InvoiceType | null>(null);
  
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
      toast({ title: 'Already on this invoice', description: `${found.name} is already on this invoice.` });
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
    // The paper's own rate and discount, so its lines come to its figures (vision/bill-draft.ts, billRates).
    const rates = Object.entries(bill.rates).filter(([k]) => k in rateInputs) as [keyof RateInputs, number][];
    if (rates.length) {
      setRateInputs(prev => ({ ...prev, ...Object.fromEntries(rates.map(([k, v]) => [k, v.toFixed(2)])) }));
      // The paper's rate prices this bill; it is never the shop's rate for tomorrow.
      setHeldRates(prev => new Set([...prev, ...rates.map(([k]) => k)]));
      setTypedRates(prev => new Set([...prev].filter(k => !rates.some(([r]) => r === k))));
    }
    if (bill.discount && !(parseFloat(discountAmountInput) > 0)) setDiscountAmountInput(String(bill.discount));
    // What the paper says was paid goes into the payment rows, unless some are typed already.
    const paidOnBill = bill.amountPaid && bill.amountPaid > 0 ? bill.amountPaid : null;
    if (paidOnBill) setSalePayments(rows => (rows.some(r => parseFloat(r.amount) > 0) ? rows : [{ ...blankSalePayment(), amount: String(paidOnBill) }]));
    toast({
      title: `${bill.items.length} line${bill.items.length === 1 ? '' : 's'} added`,
      description: [
        rates.length ? `At the bill’s rate: ${rates.map(([k, v]) => `${k.replace(/^gold/, '')} ${Math.round(v).toLocaleString()}/g`).join(', ')}.` : '',
        bill.discount ? `Discount ${bill.discount.toLocaleString()} from the bill.` : '',
        paidOnBill ? `Paid PKR ${paidOnBill.toLocaleString()} is filled in as cash — change it if it was paid another way.` : '',
        'Check them against the bill before invoicing.',
      ].filter(Boolean).join(' '),
    });
  };

  /**
   * Filled in by voice (lib/voice/commands.ts new_sale): pieces from stock by their tags, pieces
   * described as a bill's lines are, the customer, the discount and what was paid. It lands as a
   * scanned bill does; nothing is invoiced until Create.
   */
  const voiceTaken = useRef(false);
  useEffect(() => {
    if (searchParams.get('voice') !== '1' || editInvoiceId || voiceTaken.current || !appReady) return;
    voiceTaken.current = true;
    const v = takeHandoff<{ customerId: string | null; skus: string[]; lines: BillLine[]; discount: number | null; paid: number | null; method: string | null }>('sale');
    if (!v) return;
    const blank = blankCartItem();
    const items = (v.lines ?? []).map((line, i) => ({
      ...(billLineToProduct(line, blank as unknown as Record<string, unknown>, STORE_CONFIG.defaultMetal) as unknown as Product),
      sku: `VOICE-${Date.now().toString(36).toUpperCase()}-${i + 1}`,
    }));
    for (const sku of v.skus ?? []) if (!useAppStore.getState().cart.some(c => c.sku === sku)) addToCart(sku);
    acceptScannedBill({ items, customerId: v.customerId ?? undefined, writtenTotal: null, amountPaid: v.paid, rates: {}, discount: v.discount });
    if (v.paid && v.method && (PAYMENT_TYPES as readonly string[]).includes(v.method)) {
      setSalePayments(rows => rows.map((r, i) => (i === 0 ? { ...r, method: v.method as PaymentType } : r)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady, searchParams, editInvoiceId]);

  // Line-item editor — every attribute of the line, any metal.
  const [editItem, setEditItem] = useState<Product | null>(null);
  // Most pieces here are made to order and never existed in inventory, so
  // billing starts by describing the piece rather than looking one up.
  const [newItem, setNewItem] = useState<Product | null>(null);
  // ?scan=bill opens Read a written bill at once (New sale's link).
  const [billScanOpen, setBillScanOpen] = useState(() => searchParams.get('scan') === 'bill');
  // What the scanned bill said it came to. Kept so the cart can check its own
  // arithmetic against the paper's, which is how a missed line gets caught.
  const [scannedBillTotal, setScannedBillTotal] = useState<number | null>(null);
  // Most sales are handed over at the counter, so this stays off until ticked.
  const [delivery, setDelivery] = useState<DeliveryInfo>(EMPTY_DELIVERY);

  // Leaving an edit any way at all (Cancel, Back, a link) empties the cart: its pieces are the
  // invoice's, never a new sale's.
  const editStarted = useRef(false);
  useEffect(() => {
    return () => {
      if (isEditingEstimateRef.current) {
        clearCart();
        writeMarker(null);
        isEditingEstimateRef.current = false;
        editStarted.current = false;
      }
    };
    // clearCart is stable (Zustand action ref), safe to include
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // /invoices/<id>/edit: the invoice into the cart once it is here — from the live list, or read by
  // itself when the list doesn't hold it.
  const [editSource, setEditSource] = useState<InvoiceType | null | undefined>(undefined);
  useEffect(() => {
    if (!editInvoiceId || !appReady || !hasInvoicesLoaded || editSource !== undefined) return;
    const inList = allInvoices.find(inv => inv.id === editInvoiceId);
    if (inList) { setEditSource(inList); return; }
    let gone = false;
    fsGetDoc(fsDoc(fsDb, 'invoices', editInvoiceId))
      .then(snap => { if (!gone) setEditSource(snap.exists() ? ({ ...(snap.data() as InvoiceType), id: snap.id }) : null); })
      .catch(() => { if (!gone) setEditSource(null); });
    return () => { gone = true; };
  }, [editInvoiceId, appReady, hasInvoicesLoaded, allInvoices, editSource]);
  const startEditRef = useRef<(inv: InvoiceType) => void>(() => {});
  useEffect(() => {
    if (!editInvoiceId || !editSource || editStarted.current) return;
    // The cart holds a sale in progress when it has pieces and no invoice's edit marked them.
    const saleInProgress = useAppStore.getState().cart.length > 0 && !readMarker();
    if (saleInProgress && settings?.autoDraftForms === false) { setEditBlocked(editSource); return; }
    editStarted.current = true;
    if (saleInProgress) {
      try { localStorage.setItem(HELD_KEY, JSON.stringify(useAppStore.getState().cart)); } catch { /* Drafts still has it */ }
      toast({ title: 'The sale in progress is kept', description: 'It comes back in New sale once this is saved.' });
    }
    startEditRef.current(editSource);
  }, [editInvoiceId, editSource, settings?.autoDraftForms, toast]);
  // A new sale that finds an edit's pieces in the cart (a tab closed mid-edit) starts empty; one that
  // finds a sale set aside for an edit takes its pieces back (before Drafts is read, so they aren't
  // added twice).
  useEffect(() => {
    if (editInvoiceId || !appReady) return;
    if (readMarker()) { writeMarker(null); clearCart(); }
    let held: Product[] | null = null;
    try { held = JSON.parse(localStorage.getItem(HELD_KEY) || 'null'); localStorage.removeItem(HELD_KEY); } catch { /* none */ }
    if (Array.isArray(held) && held.length && useAppStore.getState().cart.length === 0) held.forEach(p => addProductToCart(p));
  }, [appReady, editInvoiceId, clearCart, addProductToCart]);


  useEffect(() => {
    // Only sync rates from settings for a new sale. An edit's rates are the invoice's own (startEdit),
    // and on /invoices/<id>/edit this never runs at all: the invoice is loaded by an effect in the
    // same commit as this one, whose state still read "not editing", and this used to put today's
    // rate back over the invoice's.
    // A box typed here or read off a scanned bill keeps its figure: this runs on every settings
    // change (another device's invoice moves lastInvoiceNumber), and used to wipe a rate typed mid-sale.
    if (appReady && settings && !isEditingEstimate && !editInvoiceId && !isEditingEstimateRef.current) {
      const fromSettings: RateInputs = {
        gold18k: (settings.goldRatePerGram18k || 0).toFixed(2),
        gold21k: (settings.goldRatePerGram21k || 0).toFixed(2),
        gold22k: (settings.goldRatePerGram22k || 0).toFixed(2),
        gold24k: (settings.goldRatePerGram24k || 0).toFixed(2),
        palladium: (settings.palladiumRatePerGram || 0).toFixed(2),
        palladium18k: (settings.palladiumRatePerGram18k || 0).toFixed(2),
        palladium12k: (settings.palladiumRatePerGram12k || 0).toFixed(2),
        platinum: (settings.platinumRatePerGram || 0).toFixed(2),
        silver: (settings.silverRatePerGram || 0).toFixed(2),
      };
      setRateInputs(prev => {
        const next = { ...fromSettings };
        for (const k of heldRates) next[k] = prev[k];
        return next;
      });
    }
  }, [appReady, settings, isEditingEstimate, heldRates, editInvoiceId]);
  
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
    setTypedRates(prev => (prev.has(metal) ? prev : new Set([...prev, metal])));
    setHeldRates(prev => (prev.has(metal) ? prev : new Set([...prev, metal])));
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
    const parsedExchange = exchangeRowsTotal(exchangeRows);
    const grandTotal = currentSubtotal - parsedDiscountAmount - parsedExchange;

    return {
        subtotal: currentSubtotal,
        grandTotal: grandTotal,
        items: estimatedItems,
    };
  }, [appReady, settings, cartItemsFromStore, rateInputs, discountAmountInput, exchangeRows, cartMetalInfo]);

  // ── A new sale, kept in Drafts as it is typed (components/drafts/use-work-drafts.ts) ──
  // Only a new sale: never an invoice on screen, an estimate being changed, or an invoice opened here
  // from an order or the list — those exist already. The pieces go in too, so a sale started on one
  // device is finished on another; this device remembers which draft its cart is.
  const saleDraftValue = useMemo(() => ({
    walkInCustomerName, walkInCustomerPhone, discountAmountInput, exchangeRows, internalNote, salePayments,
    selectedCustomerId, takenBy, hideRates, delivery,
    cart: cartItemsFromStore, subtotal: estimatedInvoice?.subtotal ?? 0,
  }), [walkInCustomerName, walkInCustomerPhone, discountAmountInput, exchangeRows, internalNote, salePayments,
       selectedCustomerId, takenBy, hideRates, delivery, cartItemsFromStore, estimatedInvoice?.subtotal]);
  const saleCustomerName = selectedCustomerId && selectedCustomerId !== WALK_IN_CUSTOMER_VALUE
    ? customers.find(c => c.id === selectedCustomerId)?.name || '' : '';
  const saleDraft = useWorkDraft({
    kind: 'sale',
    enabled: settings?.autoDraftForms !== false,
    active: appReady && !isEditingEstimate && !editingInvoiceId && !editInvoiceId,
    value: saleDraftValue,
    summary: v => summarizeSale(v as unknown as Record<string, unknown>, saleCustomerName),
    ignore: SALE_DEFAULT_FIELDS,
    onId: id => { try { if (id) localStorage.setItem(SALE_DRAFT_KEY, id); else localStorage.removeItem(SALE_DRAFT_KEY); } catch { /* private mode */ } },
  });
  /** A draft's fields back on screen; its pieces into the cart when `withCart`. */
  const applySaleDraft = useCallback((d: Record<string, unknown>, withCart: boolean) => {
    const text = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '');
    setWalkInCustomerName(text('walkInCustomerName'));
    setWalkInCustomerPhone(text('walkInCustomerPhone'));
    setDiscountAmountInput(text('discountAmountInput') || '0');
    // A draft from before the exchange rows had a description and two amounts.
    const legacy = d as { exchangeDescription?: string; exchangeAmount1Input?: string; exchangeAmount2Input?: string };
    if (Array.isArray(d.exchangeRows) && d.exchangeRows.length) setExchangeRows(d.exchangeRows as ExchangeRow[]);
    else if (legacy.exchangeDescription || legacy.exchangeAmount1Input) setExchangeRows(rowsFromExchanges(invoiceExchanges({ exchangeDescription: legacy.exchangeDescription, exchangeAmount1: parseFloat(legacy.exchangeAmount1Input || '') || 0, exchangeAmount2: parseFloat(legacy.exchangeAmount2Input || '') || 0 })));
    setInternalNote(text('internalNote'));
    if (Array.isArray(d.salePayments) && d.salePayments.length) setSalePayments(d.salePayments as SalePaymentRow[]);
    if (typeof d.selectedCustomerId === 'string') setSelectedCustomerId(d.selectedCustomerId);
    if (typeof d.takenBy === 'string') setTakenBy(d.takenBy as TakenBy);
    setHideRates(!!d.hideRates);
    if (d.delivery && typeof d.delivery === 'object') setDelivery(d.delivery as DeliveryInfo);
    if (withCart && Array.isArray(d.cart)) { clearCart(); (d.cart as Product[]).forEach(p => addProductToCart(p)); }
  }, [clearCart, addProductToCart]);
  // On arrival: ?draft=… continues that sale here (the cart becomes its pieces); otherwise this
  // device's own unfinished sale comes back as it was left.
  const draftParam = searchParams.get('draft');
  const arrived = useRef(false);
  useEffect(() => {
    if (!appReady || arrived.current || editInvoiceId || settings?.autoDraftForms === false) return;
    arrived.current = true;
    let stored: string | null = null;
    try { stored = localStorage.getItem(SALE_DRAFT_KEY); } catch { /* private mode */ }
    const target = draftParam || stored;
    if (!target) return;
    void saleDraft.load(target).then(d => {
      if (!d) {
        try { if (stored === target) localStorage.removeItem(SALE_DRAFT_KEY); } catch { /* fine */ }
        if (draftParam) toast({ title: 'That draft is no longer there', description: 'It was invoiced or discarded. This is a new sale.' });
        return;
      }
      applySaleDraft((d.data || {}) as Record<string, unknown>, !!draftParam || useAppStore.getState().cart.length === 0);
      if (draftParam) {
        router.replace('/invoices/new', { scroll: false });
        toast({ title: 'Sale continued', description: d.title !== 'No customer yet' ? `${d.title} — everything is as it was left.` : 'Everything is as it was left.' });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady, draftParam, editInvoiceId]);

  // What the payment rows come to. Editing an invoice, what it had already been paid
  // stays paid; these rows are added on top.
  const paidBefore = isEditingEstimate ? (editingInvoiceOriginalRef.current?.amountPaid || 0) : 0;
  const paidNow = salePayments.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
  const balanceAfterPayments = estimatedInvoice ? estimatedInvoice.grandTotal - paidBefore - paidNow : null;
  const overpaid = balanceAfterPayments !== null && balanceAfterPayments < -0.5;
  const setSalePayment = (id: string, patch: Partial<SalePaymentRow>) =>
    setSalePayments(rows => rows.map(r => (r.id === id ? { ...r, ...patch } : r)));
  // "Paid in full": the row takes whatever the others leave outstanding.
  const payRestWith = (id: string) => {
    if (!estimatedInvoice) return;
    const others = salePayments.filter(r => r.id !== id).reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0);
    const rest = Math.max(0, Math.round(estimatedInvoice.grandTotal - paidBefore - others));
    setSalePayment(id, { amount: rest ? String(rest) : '' });
  };


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
    if (overpaid) return 'The payments come to more than the total. Check the amounts received.';
    return null;
  }, [appReady, settings, cartItemsFromStore, rateInputs, cartMetalInfo, overpaid]);

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

    if (overpaid) {
      toast({ title: "More than the total", description: `The payments come to PKR ${(paidBefore + paidNow).toLocaleString()}, the invoice to PKR ${estimatedInvoice.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}.`, variant: "destructive" });
      return;
    }
    const paymentsNow: SalePayment[] = salePayments
      .map(r => ({ amount: parseFloat(r.amount) || 0, method: r.method, reference: r.method === 'Cash' ? '' : r.reference }))
      .filter(p => p.amount > 0);
    
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

    // Nobody named is a walk-in and makes no customer; a typed name or number is a person,
    // and a number already on file is that customer rather than a copy (lib/walk-in.ts).
    const saleCustomer = resolveSaleCustomer({
        selectedId: selectedCustomerId && selectedCustomerId !== WALK_IN_CUSTOMER_VALUE ? selectedCustomerId : undefined,
        typedName: walkInCustomerName,
        typedPhone: walkInCustomerPhone,
        customers,
    });
    const customerForInvoice = { id: saleCustomer.id, name: saleCustomer.name, phone: saleCustomer.phone };
    
    // NOTE: we do NOT delete the invoice before re-generating it. generateInvoice
    // uses transaction.set (overwrite) with the same ID, so the invoice is always
    // valid. Old hisaab cleanup is handled inside generateInvoice after the
    // transaction succeeds, so payment history can never be lost.

    const exchanges = exchangesFromRows(exchangeRows);

    // Decided before the save: the edit flags are cleared once it succeeds.
    const keptRates = ratesToKeep({ isNew: !isEditingEstimate, typed: typedRates, inputs: rateInputs, metals: cartMetalInfo.metals, current: settings });

    setIsGeneratingEstimate(true);
    let invoice;
    try {
      invoice = await generateInvoiceAction(customerForInvoice, ratesForInvoice, parsedDiscountAmount, exchanges, isEditingEstimate ? editingInvoiceId : undefined, delivery, takenBy, hideRates, internalNote, paymentsNow);
      // The sale is an invoice now: out of Drafts, and nothing written there again.
      if (invoice) { saleDraft.finish(); setSalePayments([blankSalePayment()]); setExchangeRows([blankExchangeRow()]); }
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

    // A rate typed by hand on a NEW invoice becomes the shop's rate — after the invoice, not
    // before it (the invoice is priced from ratesForInvoice in hand, and both write the settings
    // document). Never an edit's rates (the invoice's own, from the day it was written) and never
    // a scanned bill's (the paper's): re-saving a July invoice used to make July's rate today's.
    if (invoice && keptRates) {
      void updateSettings(keptRates, { source: `the cart (${invoice.id})` }).catch((err) => {
        console.error('[Cart handleGenerateInvoice] rates not persisted:', err);
        toast({
          title: "Rate not saved",
          description: "The invoice is saved. The rate you typed was not kept for next time — set it from the rate at the top.",
          variant: "destructive",
        });
      });
    }
    if (invoice) { setTypedRates(new Set()); setHeldRates(new Set()); }

    if (invoice) {
      const wasEdit = isEditingEstimateRef.current;
      setIsEditingEstimate(false);
      isEditingEstimateRef.current = false;
      setEditingInvoiceId(undefined);
      writeMarker(null);
      // The invoice on its own page: print, send, payments. An edit replaces its own address, so Back
      // doesn't return to a form whose pieces are gone.
      if (wasEdit) router.replace(`/invoices/${invoice.id}`); else router.push(`/invoices/${invoice.id}`);
      toast({
        title: "Invoice created",
        description: paymentsNow.length
          ? `${invoice.id}: PKR ${invoice.amountPaid.toLocaleString()} paid${invoice.balanceDue > 0 ? `, PKR ${invoice.balanceDue.toLocaleString()} still due` : ' — paid in full'}.`
          : `${invoice.id} is ready to print or send.`,
      });
    } else {
      toast({ title: "Could not create the invoice", description: "Check the figures and try again.", variant: "destructive" });
    }
  };

  const handleCancelEdit = () => {
    clearCart();
    writeMarker(null);
    setTypedRates(new Set()); setHeldRates(new Set());
    setIsEditingEstimate(false);
    isEditingEstimateRef.current = false;
    setEditingInvoiceId(undefined);
    // Back to the invoice, unchanged.
    router.push(`/invoices/${editInvoiceId ?? editingInvoiceOriginalRef.current?.id ?? ''}`);
  };

  const startEdit = (generatedInvoice: InvoiceType) => {
    editingInvoiceOriginalRef.current = generatedInvoice; // its id and what it had been paid
    setIsEditingEstimate(true);
    isEditingEstimateRef.current = true;
    clearCart(); // Ensure no stale items linger before loading invoice items
    writeMarker(generatedInvoice.id);
    loadCartFromInvoice(generatedInvoice);
    setSelectedCustomerId(generatedInvoice.customerId || WALK_IN_CUSTOMER_VALUE);
    setHideRates(!!generatedInvoice.hideRates);
    setInternalNote(generatedInvoice.internalNote || '');
    // Who made the sale stays theirs: editing never loaded it, so a re-save dropped it (and with
    // the signed-in default, would have handed the sale to whoever edited it).
    setTakenBy(generatedInvoice.takenBy as TakenBy | undefined);
    // Always restore customer name and phone regardless of walk-in vs registered customer
    setWalkInCustomerName(generatedInvoice.customerName || '');
    if (generatedInvoice.customerContact) {
        setWalkInCustomerPhone(generatedInvoice.customerContact);
    }
    // The invoice's own rates: held (they must not follow Settings) and never typed (never saved back).
    setTypedRates(new Set());
    setHeldRates(new Set(Object.keys(INPUT_TO_RATE) as RateInputKey[]));
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
    setExchangeRows(rowsFromExchanges(invoiceExchanges(generatedInvoice)));
    setEditingInvoiceId(generatedInvoice.id);
    setSalePayments([blankSalePayment()]);
  };
  startEditRef.current = startEdit;
  
  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <FormSkeleton fields={6} columns={2} />
      </div>
    );
  }

  // An edit, until its invoice is in the cart.
  if (editInvoiceId && !isEditingEstimate) {
    if (editSource === null) {
      return (
        <div className="container mx-auto p-4 text-center max-w-xl">
          <h2 className="text-xl font-semibold mt-8">Invoice {editInvoiceId} not found</h2>
          <Button asChild variant="outline" className="mt-4"><Link href="/invoices">All invoices</Link></Button>
        </div>
      );
    }
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <FormSkeleton fields={6} columns={2} />
        <AlertDialog open={!!editBlocked}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>A sale is in progress</AlertDialogTitle>
              <AlertDialogDescription>
                Drafts are off in Settings, so editing {editInvoiceId} here would discard the sale in the cart. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => router.push('/invoices/new')}>Keep the sale</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => {
                const inv = editBlocked;
                setEditBlocked(null);
                if (inv) { editStarted.current = true; startEdit(inv); }
              }}>Discard it and edit</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4 pb-28 lg:pb-8">
      {/* Other unfinished sales, until this one has something in it. */}
      {!saleDraft.id && !isEditingEstimate && !editInvoiceId && cartItemsFromStore.length === 0 && (
        <div className="mb-4"><DraftsShortcut kind="sale" /></div>
      )}

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
                  <div className="glass glass-popover absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
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
                <button type="button" className="hover:underline" onClick={() => setBillScanOpen(true)}>Read a written bill</button>
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
                                    {/* At the rates in the boxes, as the totals and the saved invoice are — not today's
                                        (an edit's own rate, a scanned bill's, one typed by hand). */}
                                    <span className="font-semibold tabular-nums whitespace-nowrap">PKR {(estimatedInvoice?.items.find(i => i.sku === item.sku)?.itemTotal ?? calculateProductCosts(item, settings).totalPrice).toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
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
                                <div className="glass glass-popover absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
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
                                title="Read a handwritten bill into this invoice">
                                <Camera className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Read a bill</span>
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
            <div className="lg:col-span-1 space-y-6">
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
                        {/* The shop's rate not set today: say so, never block the sale. */}
                        <RateStaleNotice />
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
                            <Label className="text-sm font-medium">Exchange / trade-in</Label>
                            <ExchangeRows rows={exchangeRows} onChange={setExchangeRows} />
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
                        <Separator />
                        {/* Payment received — taken as the invoice is written, and filed in its
                            payment history with it (generateInvoice). A bill paid part cash, part
                            card is two rows. Nothing typed means nothing paid yet. */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <Label className="flex items-center"><Banknote className="mr-2 h-4 w-4"/>Payment received</Label>
                                {paidBefore > 0 && <span className="text-xs text-muted-foreground tabular-nums">Paid before: PKR {paidBefore.toLocaleString()}</span>}
                            </div>
                            {salePayments.map((row, i) => (
                              <div key={row.id} className="space-y-2 rounded-md border p-2.5">
                                <div className="flex items-center gap-2">
                                  <AmountInput value={row.amount}
                                    onValueChange={v => setSalePayment(row.id, { amount: v === undefined ? '' : String(v) })}
                                    placeholder="Amount (PKR)" className="flex-1 text-right" aria-label={`Payment ${i + 1}, amount`} />
                                  <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!estimatedInvoice}
                                    onClick={() => payRestWith(row.id)}>
                                    {salePayments.length > 1 ? 'The rest' : 'Paid in full'}
                                  </Button>
                                  {salePayments.length > 1 && (
                                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label={`Remove payment ${i + 1}`}
                                      onClick={() => setSalePayments(rows => rows.filter(r => r.id !== row.id))}>
                                      <X className="h-4 w-4"/>
                                    </Button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <Select value={row.method} onValueChange={v => setSalePayment(row.id, { method: v as PaymentType })}>
                                    <SelectTrigger aria-label={`Payment ${i + 1}, paid by`}><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      {PAYMENT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  <Input value={row.method === 'Cash' ? '' : row.reference} disabled={row.method === 'Cash'}
                                    onChange={e => setSalePayment(row.id, { reference: e.target.value })}
                                    placeholder={row.method === 'Cheque' ? 'Cheque no.' : row.method === 'Card' ? 'Last 4 digits' : row.method === 'Bank Transfer' ? 'Reference' : 'No reference'}
                                    aria-label={`Payment ${i + 1}, reference`} />
                                </div>
                              </div>
                            ))}
                            <Button type="button" variant="ghost" size="sm" className="w-full"
                              onClick={() => setSalePayments(rows => [...rows, blankSalePayment(rows[rows.length - 1]?.method === 'Cash' ? 'Card' : 'Cash')])}>
                              <Plus className="mr-2 h-4 w-4"/> Add another payment
                            </Button>
                            {balanceAfterPayments !== null && (paidNow > 0 || paidBefore > 0) ? (
                              <div className={`flex justify-between font-semibold ${overpaid ? 'text-destructive' : ''}`}>
                                <span>{overpaid ? 'More than the total by' : balanceAfterPayments <= 0.5 ? 'Paid in full' : 'Balance due'}</span>
                                <span className="tabular-nums">
                                  {overpaid ? `PKR ${Math.abs(balanceAfterPayments).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                                    : balanceAfterPayments <= 0.5 ? <CheckCircle className="inline h-4 w-4" aria-label="Paid in full"/>
                                    : `PKR ${balanceAfterPayments.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                                </span>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">Leave it empty if nothing is paid yet — a payment can still be recorded after.</p>
                            )}
                        </div>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-2">
                         <Button size="lg" className="w-full" onClick={handleGenerateInvoice} disabled={!estimatedInvoice || isGeneratingEstimate || overpaid}>
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
        <div className="glass-bar lg:hidden fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2.5 pr-20 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-2xs uppercase tracking-wide text-muted-foreground leading-none">Total</p>
                    <p className="text-base font-semibold tabular-nums truncate">
                        PKR {estimatedInvoice ? estimatedInvoice.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '…'}
                    </p>
                    {balanceAfterPayments !== null && paidNow > 0 && (
                      <p className={`text-2xs tabular-nums truncate ${overpaid ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {overpaid ? 'Paid more than the total' : balanceAfterPayments <= 0.5 ? 'Paid in full' : `Due PKR ${balanceAfterPayments.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                      </p>
                    )}
                </div>
                <Button size="lg" className="shrink-0" onClick={handleGenerateInvoice} disabled={!estimatedInvoice || isGeneratingEstimate || overpaid}>
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
