
"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { SampleImageInput } from '@/components/shared/sample-image-input';
import { PLATING_TYPES } from '@/lib/store';
import { describeMetal } from '@/lib/materials';
import { SizePicker } from '@/components/shared/size-picker';
import { KarigarPicker } from '@/components/karigar/karigar-picker';
import { DeliveryFields, EMPTY_DELIVERY, knownAddressesFor } from '@/components/shared/delivery-fields';
import { KARAT_VALUES as karatValues, METAL_TYPES as metalTypeValues, metalLabel, karatsFor, metalHasKarat } from '@/lib/materials';
import { useAppStore, Settings, KaratValue, DeliveryInfo, calculateProductCosts, Order, OrderItem, Customer, MetalType, Product, Karigar, staticCategories, CUSTOMER_SOURCES, TAKEN_BY, CUSTOMER_SOURCE_LABELS } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { FormSection, PriceModeToggle } from '@/components/shared/piece-form';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Loader2, DollarSign, Weight, Zap, Diamond, Gem as GemIcon, FileText, Printer, PencilRuler, PlusCircle, Trash2, Camera, Link as LinkIcon, Hand, List, Upload, X, User, Phone, MessageSquare, Percent, Save, Ban, Search, Briefcase, Lock , ChevronRight, TicketPercent, Truck, CalendarClock, ScanLine } from 'lucide-react';
import { CustomerAutocomplete } from '@/components/customer/customer-autocomplete';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';
import Image from 'next/image';
import 'react-phone-number-input/style.css'
import { Label } from '@/components/ui/label';
import { cn, normalizePhoneNumber } from '@/lib/utils';
import { CategoryPicker } from '@/components/shared/category-picker';
import { AmountInput } from '@/components/ui/amount-input';
import { Switch } from '@/components/ui/switch';
import { addDays, differenceInCalendarDays, format as formatDate, parseISO, startOfDay } from 'date-fns';
import { DEFAULT_PROMISE_DAYS, URGENT_WINDOW_DAYS } from '@/lib/order-timing';
import { PageBack } from '@/components/shared/page-back';
import { PhoneField } from '@/components/ui/phone-field';
import { useFormDraft, DraftRestoreBanner } from '@/components/shared/use-form-draft';
import { STORE_CONFIG } from '@/lib/store-config';
import { OrderScanner } from '@/components/order/order-scanner';
import type { OrderDraft } from '@/lib/vision/order-draft';
import { TakenByPicker } from '@/components/shared/taken-by-picker';

// Extend jsPDF interface for the autoTable plugin
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
     lastAutoTable: {
      finalY?: number;
    };
  }
}


/**
 * Karat only means something for gold. The blank-item template seeds '21k' so
 * the select has a value if the user switches metal to gold — but if the item
 * is saved as silver/platinum/palladium that leftover must not be persisted,
 * or it shows up as a meaningless "21K" everywhere the item is displayed.
 */
function stripMeaninglessKarat<T extends { metalType?: string; karat?: unknown }>(item: T): T {
  const o = item as Record<string, unknown>;
  let next: Record<string, unknown> = o;
  // Karat only means something for gold.
  if (o.metalType !== 'gold') {
    const { karat, ...rest } = next;
    next = rest;
  }
  // Plating only applies to silver — don't persist it on a gold piece.
  if (o.metalType !== 'silver') {
    const { platingType, platingNote, nickelFree, ...rest } = next;
    next = rest;
  }
  return next as T;
}

// Schema for a single custom order item
const orderItemSchema = z.object({
  itemCategory: z.string().optional(),
  description: z.string().min(3, "Description is required"),
  karat: z.enum(karatValues).optional(),
  estimatedWeightG: z.coerce.number().min(0).default(0),
  wastagePercentage: z.coerce.number().min(0, "Wastage must be non-negative").default(0),
  makingCharges: z.coerce.number().min(0).default(0),
  diamondCharges: z.coerce.number().min(0).default(0),
  stoneCharges: z.coerce.number().min(0).default(0),
  sampleImageDataUri: z.string().optional(),
  referenceSku: z.string().optional(),
  sampleGiven: z.boolean().default(false),
  hasDiamonds: z.boolean().default(false),
  hasStones: z.boolean().default(false),
  stoneWeightG: z.coerce.number().min(0).default(0),
  stoneDetails: z.string().optional(),
  diamondDetails: z.string().optional(),
  // Still required — an item cannot be saved without one — but new rows are
  // seeded with the store's default metal rather than left blank. See the
  // blank-item factory below for why this was empty for a while.
  metalType: z.enum(metalTypeValues, { required_error: 'Choose the metal' }),
  isCompleted: z.boolean().default(false),
  karigarId: z.string().optional(),
  isManualPrice: z.boolean().default(false),
  manualPrice: z.coerce.number().min(0).default(0),
  // Optional size (e.g. "10 Indian / 5 US") for rings, bracelets and similar items
  size: z.string().optional(),
  // Internal-only note; never printed on estimates/invoices
  platingType: z.string().optional(),
  platingNote: z.string().optional(),
  nickelFree: z.boolean().default(false),
  adminNote: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.isManualPrice) {
    if (data.manualPrice <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Manual price must be greater than 0", path: ['manualPrice'] });
  } else {
    if (data.estimatedWeightG <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Weight must be a positive number", path: ['estimatedWeightG'] });
  }
});

// Schema for the main form which contains multiple items
/** yyyy-MM-dd for N days from today -- what <input type="date"> wants. */
const promiseIn = (days: number) => formatDate(addDays(startOfDay(new Date()), days), 'yyyy-MM-dd');

/**
 * The quick promises. Seven, ten and fourteen days are what the counter actually
 * says to a customer; a date picker was making people work out which day of the
 * month that landed on, every time, for an answer that is one of three numbers.
 */
const QUICK_PROMISES = [7, 10, 14] as const;

const orderFormSchema = z.object({
    items: z.array(orderItemSchema).min(1, "You must add at least one item to the estimate."),
    goldRate18k: z.coerce.number().min(0),
    palladiumRate18k: z.coerce.number().min(0).default(0),
    palladiumRate12k: z.coerce.number().min(0).default(0),
    goldRate21k: z.coerce.number().min(0),
    goldRate22k: z.coerce.number().min(0),
    goldRate24k: z.coerce.number().min(0),
    hideRates: z.boolean().default(false),
    discountAmount: z.coerce.number().min(0).default(0),
    advancePayment: z.coerce.number().min(0).default(0),
    advanceInExchangeDescription: z.string().optional(),
    advanceInExchangeValue: z.coerce.number().min(0).default(0),
    customerId: z.string().optional(),
    customerName: z.string().optional(),
    customerContact: z.string().optional(),
    source: z.enum(CUSTOMER_SOURCES).optional(),
    takenBy: z.enum(TAKEN_BY).optional(),
    promisedDate: z.string().optional(),
}).refine(data => {
    const goldItems = data.items.filter(item => item.metalType === 'gold');
    if (goldItems.length === 0) return true; // No gold items, so no gold rate needed

    const has18k = goldItems.some(item => item.karat === '18k');
    if (has18k && data.goldRate18k <= 0) {
        return false;
    }
    const has21k = goldItems.some(item => item.karat === '21k');
     if (has21k && data.goldRate21k <= 0) {
        return false;
    }
    const has22k = goldItems.some(item => item.karat === '22k');
     if (has22k && data.goldRate22k <= 0) {
        return false;
    }
    const has24k = goldItems.some(item => item.karat === '24k');
     if (has24k && data.goldRate24k <= 0) {
        return false;
    }

    return true;
}, {
    message: "A positive gold rate is required for each gold karat type present in the order.",
    path: ["goldRate21k"], // Arbitrarily attach to one field for form-level error display
});


type OrderItemData = z.infer<typeof orderItemSchema>;
type OrderFormData = z.infer<typeof orderFormSchema>;

type EnrichedOrderFormData = OrderFormData & {
    id: string; // The generated order ID
    subtotal: number;
    grandTotal: number;
    items: (OrderItemData & { metalCost: number; totalEstimate: number; wastageCost: number; })[];
};

const WALK_IN_CUSTOMER_VALUE = "__WALK_IN__";

const ProductSearchDialog: React.FC<{ onAddProduct: (product: Product) => void }> = ({ onAddProduct }) => {
    const products = useAppStore(state => state.products);
    const [searchTerm, setSearchTerm] = useState('');
    const [open, setOpen] = useState(false);

    const filteredProducts = useMemo(() => {
        if (!searchTerm) return [];
        return products.filter(p => 
            p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
            p.sku.toLowerCase().includes(searchTerm.toLowerCase())
        ).slice(0, 50); // Limit results for performance
    }, [products, searchTerm]);

    const handleSelectProduct = (product: Product) => {
        onAddProduct(product);
        setSearchTerm('');
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button type="button" variant="secondary">
                    <PlusCircle className="mr-2 h-4 w-4"/> Add from Inventory
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Add Product from Inventory</DialogTitle>
                    <DialogDescription>
                        Search for an existing product to add it as a template for a new custom order item.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-4 space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                        <Input
                            placeholder="Search by name or SKU..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                         aria-label="Search by name or SKU"/>
                    </div>
                    <ScrollArea className="h-[40vh] border rounded-md">
                        {filteredProducts.length > 0 ? (
                            <div className="p-2">
                                {filteredProducts.map(product => (
                                    <button
                                        key={product.sku}
                                        onClick={() => handleSelectProduct(product)}
                                        className="w-full text-left p-2 rounded-md hover:bg-muted flex items-center gap-3"
                                    >
                                        <Image src={product.imageUrl || `https://placehold.co/40x40.png`} alt={product.name} width={40} height={40} className="rounded-md object-cover border" data-ai-hint="product jewelry" />
                                        <div>
                                            <p className="font-medium">{product.name}</p>
                                            <p className="text-xs text-muted-foreground">{product.sku}</p>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <p className="p-4 text-center text-sm text-muted-foreground">
                                {searchTerm ? 'No products found.' : 'Start typing to search...'}
                            </p>
                        )}
                    </ScrollArea>
                </div>
                <DialogFooter>
                    <DialogClose asChild><Button type="button" variant="outline">Close</Button></DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};


interface OrderFormProps {
    order?: Order;
}

/** Map a cart line onto an order item. Same piece, different destination:
 *  the cart bills it now, an order sends it to the bench first. */
function cartItemToOrderItem(p: Product) {
  return {
    itemCategory: p.categoryId || undefined,
    description: p.name || '',
    karat: p.metalType === 'gold' ? p.karat : undefined,
    estimatedWeightG: p.metalWeightG || 0,
    wastagePercentage: p.wastagePercentage || 0,
    makingCharges: p.makingCharges || 0,
    diamondCharges: p.diamondCharges || 0,
    stoneCharges: p.stoneCharges || 0,
    referenceSku: p.sku,
    sampleGiven: false,
    hasDiamonds: !!p.hasDiamonds,
    hasStones: !!p.hasStones,
    stoneWeightG: p.stoneWeightG || 0,
    stoneDetails: p.stoneDetails || undefined,
    diamondDetails: p.diamondDetails || undefined,
    metalType: (p.metalType || STORE_CONFIG.defaultMetal) as MetalType,
    isCompleted: false,
    isManualPrice: !!p.isCustomPrice,
    manualPrice: p.isCustomPrice ? (p.customPrice || 0) : 0,
    size: p.size || undefined,
    platingType: p.platingType || undefined,
    platingNote: p.platingNote || undefined,
    nickelFree: !!p.nickelFree,
  };
}

/** Every figure in the order panel is written the same way. */
const money = (n: number) =>
  'PKR ' + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * One labelled group inside the order panel.
 *
 * The panel was a single flat column headed "Summary" holding the customer,
 * their contact, the referral source, gold rates, delivery, the discount, two
 * kinds of advance payment and the totals — everything the left column had no
 * room for. Nothing said where one concern ended and the next began.
 */
const PanelSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <section className="space-y-2.5">
    <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
      {icon}{title}
    </h3>
    {children}
  </section>
);

export const OrderForm: React.FC<OrderFormProps & { seedFromCart?: boolean }> = ({ order, seedFromCart }) => {
  const { toast } = useToast();
  const router = useRouter();
  const { settings, customers, karigars, isSettingsLoading, isCustomersLoading, isKarigarsLoading, loadSettings, loadCustomers, loadKarigars, addOrder, updateOrder, clearCart } = useAppStore();
  const cartItems = useAppStore(state => state.cart);
  // Past orders supply the addresses this customer has been delivered to.
  const orders = useAppStore(state => state.orders);
  const isEditMode = !!order;

  useEffect(() => {
    loadSettings();
    loadCustomers();
    loadKarigars();
  }, [loadSettings, loadCustomers, loadKarigars]);

  // Items carried over from the cart, so "create an order" reuses this form
  // rather than a second, divergent order-creation path.
  // Only one item is expanded at a time: twenty fields per piece across a
  // five-piece order is otherwise a hundred fields of uninterrupted scrolling.
  const [openItem, setOpenItem] = React.useState(0);
  // Delivery is held outside the zod form: it is a self-contained block with
  // its own validity, and threading it through the item schema buys nothing.
  const [delivery, setDelivery] = React.useState<DeliveryInfo>(order?.delivery ?? EMPTY_DELIVERY);

  const seededItems = React.useMemo(
    () => (seedFromCart && !order ? cartItems.map(cartItemToOrderItem) : []),
    [seedFromCart, order, cartItems],
  );

  const form = useForm<OrderFormData>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      items: seededItems,
      goldRate18k: 0, goldRate21k: 0, goldRate22k: 0, goldRate24k: 0,
      palladiumRate18k: 0, palladiumRate12k: 0,
      discountAmount: 0,
      advancePayment: 0,
      advanceInExchangeDescription: '',
      advanceInExchangeValue: 0,
      customerId: WALK_IN_CUSTOMER_VALUE,
      customerName: '',
      customerContact: '',
      source: undefined,
      takenBy: undefined,
      // Fourteen days unless something else is agreed. Blank meant the order was only
      // chased once it was a week old, which is rarely what anyone said at the counter.
      promisedDate: promiseIn(DEFAULT_PROMISE_DAYS),
    },
  });
  
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  useEffect(() => {
    const rates = order?.ratesApplied || settings;
    if (order) {
      form.reset({
        items: order.items.map(item => ({
            ...item,
            itemCategory: item.itemCategory || '',
            karat: item.karat || undefined,
            sampleImageDataUri: item.sampleImageDataUri || '',
            referenceSku: item.referenceSku || '',
            stoneDetails: item.stoneDetails || '',
            diamondDetails: item.diamondDetails || '',
            karigarId: item.karigarId || '',
            platingType: item.platingType || '', platingNote: item.platingNote || '',
            nickelFree: !!item.nickelFree,
            adminNote: item.adminNote || '',
        })),
        goldRate18k: rates.goldRatePerGram18k || 0,
        palladiumRate18k: rates.palladiumRatePerGram18k || 0,
        palladiumRate12k: rates.palladiumRatePerGram12k || 0,
        goldRate21k: rates.goldRatePerGram21k || 0,
        goldRate22k: rates.goldRatePerGram22k || 0,
        goldRate24k: rates.goldRatePerGram24k || 0,
        hideRates: !!order.hideRates,
        discountAmount: Number(order.discountAmount) || 0,
        advancePayment: Number(order.advancePayment) || 0,
        advanceInExchangeDescription: order.advanceInExchangeDescription || '',
        advanceInExchangeValue: Number(order.advanceInExchangeValue) || 0,
        customerId: order.customerId || WALK_IN_CUSTOMER_VALUE,
        customerName: order.customerName || '',
        customerContact: normalizePhoneNumber(order.customerContact) || '',
        source: order.source,
        takenBy: order.takenBy,
        promisedDate: order.promisedDate || '',
      });
    } else if (!isEditMode && settings.goldRatePerGram21k > 0) {
      form.reset({
        ...form.getValues(),
        goldRate18k: settings.goldRatePerGram18k,
        palladiumRate18k: settings.palladiumRatePerGram18k,
        palladiumRate12k: settings.palladiumRatePerGram12k,
        goldRate21k: settings.goldRatePerGram21k,
        goldRate22k: settings.goldRatePerGram22k,
        goldRate24k: settings.goldRatePerGram24k,
      });
    }
  }, [order, settings, form, isEditMode]);


  const formValues = form.watch();

  // An unfinished order is kept on this device and offered back. Editing is
  // skipped: that record already exists, so there is nothing to lose.
  const { draft, discard, done } = useFormDraft({
    kind: 'order',
    id: isEditMode ? (order?.id || 'edit') : 'new',
    value: formValues,
    enabled: settings?.autoDraftForms !== false,
    skip: isEditMode,
  });

  const restoreDraft = React.useCallback(() => {
    if (!draft?.data) return;
    form.reset(draft.data as never);
    discard();
    toast({ title: 'Draft restored', description: 'Picking up where you left off.' });
  }, [draft, form, discard, toast]);
  const selectedCustomerId = form.watch('customerId');

  useEffect(() => {
    if (selectedCustomerId && selectedCustomerId !== WALK_IN_CUSTOMER_VALUE) {
        const customer = customers.find(c => c.id === selectedCustomerId);
        if (customer) {
            form.setValue('customerName', customer.name);
            form.setValue('customerContact', normalizePhoneNumber(customer.phone) || '');
            // Default the order source to the customer's saved source if not already set
            if (customer.source && !form.getValues('source')) {
                form.setValue('source', customer.source);
            }
        }
    }
  }, [selectedCustomerId, customers, form]);

  /** Price one item, exactly the way the subtotal below does. */
  const priceOfItem = React.useCallback((item: OrderFormData['items'][number], rates: Partial<Settings>) => {
    if (item.isManualPrice) return Number(item.manualPrice) || 0;
    if (!item.estimatedWeightG || item.estimatedWeightG <= 0) return 0;
    return calculateProductCosts({
      categoryId: '',
      metalType: item.metalType, karat: item.karat, metalWeightG: item.estimatedWeightG,
      wastagePercentage: item.metalType === 'silver' ? 0 : item.wastagePercentage,
      makingCharges: item.makingCharges, hasDiamonds: item.hasDiamonds,
      diamondCharges: item.diamondCharges, stoneCharges: item.stoneCharges, miscCharges: 0,
      stoneWeightG: item.stoneWeightG, hasStones: item.hasStones,
    }, rates).totalPrice;
  }, []);

  const liveEstimate = useMemo(() => {
    let subtotal = 0;
    const ratesForCalc = { 
        goldRatePerGram18k: formValues.goldRate18k || 0,
        goldRatePerGram21k: formValues.goldRate21k || 0,
        palladiumRatePerGram18k: formValues.palladiumRate18k || 0,
        palladiumRatePerGram12k: formValues.palladiumRate12k || 0,
        goldRatePerGram22k: formValues.goldRate22k || 0,
        goldRatePerGram24k: formValues.goldRate24k || 0,
        palladiumRatePerGram: settings.palladiumRatePerGram,
        platinumRatePerGram: settings.platinumRatePerGram,
        silverRatePerGram: settings.silverRatePerGram,
    };

    (formValues.items || []).forEach(item => {
        if (item.isManualPrice) {
            subtotal += Number(item.manualPrice) || 0;
            return;
        }

        const { estimatedWeightG, karat, makingCharges, diamondCharges, stoneCharges, hasDiamonds, wastagePercentage, metalType, stoneWeightG, hasStones } = item;
        if (!estimatedWeightG || estimatedWeightG <= 0) return;

        const productForCalc = {
          categoryId: '',
          metalType, karat, metalWeightG: estimatedWeightG,
          wastagePercentage: metalType === 'silver' ? 0 : wastagePercentage,
          makingCharges, hasDiamonds,
          diamondCharges, stoneCharges, miscCharges: 0,
          stoneWeightG: stoneWeightG,
          hasStones: hasStones,
        };

        const costs = calculateProductCosts(productForCalc, ratesForCalc);
        subtotal += costs.totalPrice;
    });

    // Never more than the subtotal — a discount cannot turn a sale into a debt.
    const discount = Math.max(0, Math.min(subtotal, Number(formValues.discountAmount) || 0));
    const totalAdvance = (Number(formValues.advancePayment) || 0) + (Number(formValues.advanceInExchangeValue) || 0);
    const grandTotal = subtotal - discount - totalAdvance;

    return { subtotal, discount, grandTotal };
  }, [formValues, settings]);


  const onSubmit = async (data: OrderFormData) => {
    const { subtotal, discount, grandTotal } = liveEstimate;
    /**
     * The rates this order is priced at, stamped onto it so it reads the same later.
     *
     * The four gold rates come from the form, which is the whole point of showing them
     * there: whatever is on screen when the piece is quoted is what the customer was
     * told. The other metals have no field, so on an EDIT they must come from the order's
     * own stamp rather than from Settings — re-reading Settings here quietly repriced
     * every silver or platinum line in an old order at today's rate, months after it was
     * agreed, with nothing on the screen to say so.
     */
    const prior = order?.ratesApplied;
    const ratesForOrder: Partial<Settings> = {
        goldRatePerGram18k: data.goldRate18k || 0,
        goldRatePerGram21k: data.goldRate21k || 0,
        goldRatePerGram22k: data.goldRate22k || 0,
        goldRatePerGram24k: data.goldRate24k || 0,
        palladiumRatePerGram: prior?.palladiumRatePerGram ?? settings.palladiumRatePerGram,
        palladiumRatePerGram18k: data.palladiumRate18k || 0,
        palladiumRatePerGram12k: data.palladiumRate12k || 0,
        platinumRatePerGram: prior?.platinumRatePerGram ?? settings.platinumRatePerGram,
        silverRatePerGram: prior?.silverRatePerGram ?? settings.silverRatePerGram,
    };

    const enrichedItems: OrderItem[] = data.items.map((item) => {
        if (item.isManualPrice) {
            return stripMeaninglessKarat({ ...item, metalCost: 0, wastageCost: 0, totalEstimate: item.manualPrice || 0 });
        }
        const { estimatedWeightG, karat, makingCharges, diamondCharges, stoneCharges, hasDiamonds, wastagePercentage, isCompleted, metalType, hasStones, stoneWeightG, karigarId } = item;
        const productForCalc = {
          categoryId: '',
          metalType, karat, metalWeightG: estimatedWeightG,
          wastagePercentage: metalType === 'silver' ? 0 : wastagePercentage,
          makingCharges, hasDiamonds,
          diamondCharges, stoneCharges, miscCharges: 0,
          hasStones, stoneWeightG
        };
        const costs = calculateProductCosts(productForCalc, ratesForOrder);
        return stripMeaninglessKarat({ ...item, isCompleted: isCompleted, metalType: item.metalType, karigarId: karigarId, metalCost: costs.metalCost, wastageCost: costs.wastageCost, totalEstimate: costs.totalPrice });
    });

    if (isEditMode && order) {
        const isWalkIn = data.customerId === WALK_IN_CUSTOMER_VALUE;
        const finalCustomerId = isWalkIn ? undefined : data.customerId;

        let finalCustomerName = data.customerName;
        if (!isWalkIn && finalCustomerId) {
            const customer = customers.find(c => c.id === finalCustomerId);
            if (customer) {
                finalCustomerName = customer.name;
            }
        }
        
        const updatedOrderData: Partial<Order> = {
            ...data,
            customerId: finalCustomerId,
            customerName: finalCustomerName || 'Walk-in Customer', // Ensure name is not undefined
            items: enrichedItems,
            ratesApplied: ratesForOrder,
            ...(data.hideRates ? { hideRates: true } : {}),
            subtotal,
            discountAmount: discount,
            grandTotal,
            // Written either way, unlike the create path. Omitting it here
            // meant delivery details added to an existing order were dropped
            // on save without a word — and unticking the box has to clear what
            // is stored, not leave the old address behind. null rather than
            // undefined, which cleanObject strips before the write.
            delivery: (delivery.required && delivery.address.trim() ? delivery : null) as unknown as undefined,
        };
        try {
            await updateOrder(order.id, updatedOrderData);
            toast({ title: "Order Updated", description: "The custom order has been successfully updated." });
            router.push(`/orders/${order.id}`);
        } catch (err) {
            console.error("Order update error:", err);
            toast({ title: "Error", description: "Failed to update the order. Please try again.", variant: "destructive" });
        }
    } else {
        const finalCustomerId = data.customerId === WALK_IN_CUSTOMER_VALUE ? undefined : data.customerId;
        let finalCustomerName = data.customerName;
        if (finalCustomerId) {
          const customer = customers.find(c => c.id === finalCustomerId);
          if (customer) finalCustomerName = customer.name;
        }

        const orderToSave: Omit<Order, 'id' | 'createdAt' | 'status'> = {
            items: enrichedItems,
            ratesApplied: ratesForOrder,
            ...(data.hideRates ? { hideRates: true } : {}),
            // Listed explicitly, unlike the edit path which spreads `data`. Leaving it out
            // here is how a field ends up saving on edit and vanishing on create.
            ...(data.takenBy ? { takenBy: data.takenBy } : {}),
            advancePayment: data.advancePayment,
            advanceInExchangeDescription: data.advanceInExchangeDescription,
            advanceInExchangeValue: data.advanceInExchangeValue,
            subtotal,
            discountAmount: discount,
            grandTotal,
            customerId: finalCustomerId,
            customerName: finalCustomerName,
            customerContact: data.customerContact,
            source: data.source,
            // Absent rather than '' when blank, so orderTiming falls through to
            // the age rule instead of trying to parse an empty date.
            ...(data.promisedDate ? { promisedDate: data.promisedDate } : {}),
            // Only recorded when actually being delivered, so an unticked box
            // does not litter every order with an empty delivery object.
            ...(delivery.required && delivery.address.trim() ? { delivery } : {}),
        };

        try {
            const newOrder = await addOrder(orderToSave);
            if (newOrder) {
                // The cart's contents have become the order; leaving them
                // behind would bill the same pieces a second time.
                if (seedFromCart) clearCart();
                done();
                toast({ title: `Order ${newOrder.id} Created`, description: "Custom order has been saved." });
                router.push(`/orders/${newOrder.id}`);
            } else {
                toast({ title: "Error", description: "Failed to save the custom order. Please try again.", variant: "destructive" });
            }
        } catch (err) {
            console.error("Order save error:", err);
            toast({ title: "Error", description: "An unexpected error occurred. Please try again.", variant: "destructive" });
        }
    }
  };
  
  if (isSettingsLoading || isCustomersLoading || isKarigarsLoading) {
    return (
      <div className="container mx-auto p-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading Form...</p>
      </div>
    );
  }

    const handleAddInventoryProduct = (product: Product) => {
        // A freshly added piece opens straight away — it is what you came to fill in.
        setOpenItem(fields.length);
        append({
            itemCategory: product.categoryId || '',
            description: product.name,
            karat: product.metalType !== 'silver' ? (product.karat || '21k') : undefined,
            estimatedWeightG: product.metalWeightG,
            wastagePercentage: product.wastagePercentage,
            makingCharges: product.makingCharges,
            diamondCharges: product.diamondCharges,
            stoneCharges: product.stoneCharges,
            sampleImageDataUri: product.imageUrl || '',
            referenceSku: product.sku,
            sampleGiven: false,
            hasDiamonds: product.hasDiamonds,
            stoneDetails: product.stoneDetails || '',
            diamondDetails: product.diamondDetails || '',
            metalType: product.metalType,
            isCompleted: false,
            stoneWeightG: product.stoneWeightG || 0,
            hasStones: product.hasStones || false,
            karigarId: '',
            isManualPrice: false,
            manualPrice: 0,
            platingType: '', platingNote: '', nickelFree: false,
        adminNote: '',
        });
    };

  const [scannerOpen, setScannerOpen] = React.useState(false);

  /**
   * Take what was read off a photo and put it in the form.
   *
   * Everything lands as a normal, editable field — there is no "scanned" state a piece can
   * be in. Lines are APPENDED rather than replacing what is already there, because the
   * usual second photo is the other half of the same set, not a correction of the first.
   *
   * Prices are deliberately not computed here. The slip's making charge goes in, the metal
   * rate is whatever the form already holds, and the total is the form's own arithmetic —
   * a figure read off handwriting must never quietly become a price nobody checked.
   */
  const applyScan = (scan: OrderDraft, photoDataUri: string) => {
    if (scan.customer?.pinned) {
      form.setValue('customerId', scan.customer.pinned.id);
      form.setValue('customerName', scan.customer.pinned.name);
    } else if (scan.customer?.heard) {
      // Nobody pinned: carry the name through as a walk-in rather than losing it.
      form.setValue('customerId', WALK_IN_CUSTOMER_VALUE);
      form.setValue('customerName', scan.customer.heard);
    }
    if (scan.customerPhone) form.setValue('customerContact', normalizePhoneNumber(scan.customerPhone) || scan.customerPhone);
    if (scan.advancePayment != null) form.setValue('advancePayment', scan.advancePayment);

    const karigarId = scan.karigar?.pinned?.id ?? '';
    const lines = scan.items?.length ? scan.items : [{}];
    lines.forEach((it, i) => {
      setOpenItem(fields.length + i);
      append({
        itemCategory: it.itemCategory || '',
        description: it.description || '',
        karat: it.karat ? (`${Math.round(it.karat)}k` as KaratValue) : '21k',
        estimatedWeightG: it.weightG ?? 0,
        wastagePercentage: 10,
        makingCharges: it.makingCharges ?? 0,
        diamondCharges: 0,
        stoneCharges: 0,
        // The slip itself, kept on the first piece as the reference picture.
        sampleImageDataUri: i === 0 ? photoDataUri : '',
        referenceSku: '',
        sampleGiven: false,
        hasDiamonds: false,
        stoneDetails: it.stoneDetails || '',
        diamondDetails: '',
        metalType: STORE_CONFIG.defaultMetal as MetalType,
        isCompleted: false,
        hasStones: Boolean(it.stoneWeightG),
        stoneWeightG: it.stoneWeightG ?? 0,
        karigarId,
        isManualPrice: true,
        manualPrice: 0,
        platingType: '', platingNote: '', nickelFree: false,
        size: it.size || '',
        adminNote: [
          it.note,
          it.weightWasTola ? 'Weight converted from tola on the slip.' : null,
          scan.unreadable ? `Unread on the slip: ${scan.unreadable}` : null,
          scan.expectedDate ? `Slip says wanted by ${scan.expectedDate}.` : null,
        ].filter(Boolean).join(' ') || '',
      });
    });
  };

  const handleAddNewItem = () => {
    setOpenItem(fields.length);
    append({
        itemCategory: '',
        description: '',
        karat: '21k',
        estimatedWeightG: 0,
        wastagePercentage: 10,
        makingCharges: 0,
        diamondCharges: 0,
        stoneCharges: 0,
        sampleImageDataUri: '',
        referenceSku: '',
        sampleGiven: false,
        hasDiamonds: false,
        stoneDetails: '',
        diamondDetails: '',
        // Pre-answered from the store's own default rather than hardcoded, so
        // the silver shop starts on silver and the gold shop on gold.
        //
        // This was deliberately left unset for a while, because defaulting it
        // is what let 188 order items record as silver without anyone noticing
        // — manual pricing means the price never depends on the metal, so a
        // wrong one surfaces nowhere. The dropdown is still required and still
        // has to be changed for a gold piece; it just no longer starts empty.
        metalType: STORE_CONFIG.defaultMetal as MetalType,
        isCompleted: false,
        /**
         * A new piece starts on the shop's own metal at 21k, priced FROM THE RATE with
         * stones counted — because that is what almost every piece here is, and starting
         * on a manual price meant the weight, the karat and the stone charge were all
         * typed and then quietly ignored.
         *
         * Nothing is removed by this. Manual pricing, the other karats and the other
         * metals are all still one control away; this only decides where the form opens.
         */
        hasStones: true,
        stoneWeightG: 0,
        karigarId: '',
        isManualPrice: false,
        manualPrice: 0,
        platingType: '', platingNote: '', nickelFree: false,
        adminNote: '',
    });
  };

  return (
    <Form {...form}>
      <PageBack fallback="/orders" label="Back to orders" className="mb-2" />
      {draft && (
        <DraftRestoreBanner
          savedAt={draft.savedAt}
          noun="order"
          onRestore={restoreDraft}
          onDiscard={discard}
        />
      )}
      {/*
        Three cards, placed twice.

        On a phone they stack in the order the counter works: who it is for, what
        they want, what it costs. On a desktop the pieces take the wide column and
        the two smaller cards sit beside them, pricing pinned so the total and the
        Save button stay in view while the list scrolls. That is one DOM order with
        two placements -- grid coordinates on lg, natural flow below it -- rather
        than the same fields rendered twice and kept in step by hand.

        Before this the phone got the desktop's DOM: every piece first, the
        customer's name at the bottom, Save after everything. Backwards for the
        person typing it in.
      */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-[auto_1fr] gap-5 lg:gap-8 pb-24 lg:pb-0">

        {/* Who, and when. First on a phone. */}
        <Card className="lg:col-start-3 lg:row-start-1">
            <CardHeader className="pb-4">
                <CardTitle className="flex items-center text-base"><User className="mr-2 h-5 w-5"/>Order for</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
                    <PanelSection title="Customer" icon={<User className="h-3.5 w-3.5" />}>
                        <FormField control={form.control} name="takenBy" render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">Taken by <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                            <FormControl>
                              <TakenByPicker value={field.value} onChange={field.onChange} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                    <FormItem>
                        <FormLabel className="text-xs">Name</FormLabel>
                        <CustomerAutocomplete
                            customers={customers}
                            value={form.watch('customerName') || ''}
                            placeholder="Type customer name..."
                            onSelect={({ name, customerId, phone }) => {
                                form.setValue('customerName', name);
                                form.setValue('customerId', customerId || WALK_IN_CUSTOMER_VALUE);
                                if (phone !== undefined) form.setValue('customerContact', normalizePhoneNumber(phone));
                            }}
                        />
                        <FormMessage />
                    </FormItem>
                    <FormField
                        control={form.control}
                        name="customerContact"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs">Contact</FormLabel>
                            <FormControl>
                            <PhoneField
                                value={field.value || undefined}
                                onChange={v => field.onChange(v || '')}
                                onBlur={field.onBlur}
                                aria-label="Customer contact" />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="source"
                        render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs">How they found us <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                            <Select
                                value={field.value ?? '__none__'}
                                onValueChange={(v) => { if (v === '') return; field.onChange(v === '__none__' ? undefined : v); }}
                            >
                                <FormControl>
                                    <SelectTrigger><SelectValue placeholder="Referral source" /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    <SelectItem value="__none__">— Not specified —</SelectItem>
                                    {CUSTOMER_SOURCES.map((s) => (
                                        <SelectItem key={s} value={s}>{CUSTOMER_SOURCE_LABELS[s]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                        )}
                    />
                    </PanelSection>

                    <PanelSection title="Promised for" icon={<CalendarClock className="h-3.5 w-3.5" />}>
                    <FormField control={form.control} name="promisedDate" render={({ field }) => {
                      const chosen = field.value ? parseISO(field.value) : null;
                      const daysAway = chosen ? differenceInCalendarDays(startOfDay(chosen), startOfDay(new Date())) : null;
                      // Inside a bench week, or already behind. Shown here, at the moment of
                      // choosing, so the counter sees what it is committing the workshop to.
                      const urgent = daysAway !== null && daysAway <= URGENT_WINDOW_DAYS;
                      return (
                       <FormItem>
                            <div className="flex items-center justify-between gap-2">
                              <FormLabel className="text-xs">Date promised to the customer</FormLabel>
                              {urgent && (
                                <span className="inline-flex items-center rounded-sm bg-destructive px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-destructive-foreground leading-none">
                                  Urgent{daysAway !== null && daysAway < 0 ? ' · past' : daysAway === 0 ? ' · today' : ` · ${daysAway}d`}
                                </span>
                              )}
                            </div>
                            {/* The three answers the counter actually gives, as buttons. The
                                lit one is whichever the date currently matches, so choosing
                                by hand and choosing by button read the same. */}
                            <div className="flex gap-1.5">
                              {QUICK_PROMISES.map(d => {
                                const on = field.value === promiseIn(d);
                                return (
                                  <Button key={d} type="button" size="sm" variant={on ? 'default' : 'outline'}
                                    className={cn('h-8 flex-1 tabular-nums', d <= URGENT_WINDOW_DAYS && !on && 'border-destructive/40 text-destructive')}
                                    onClick={() => field.onChange(promiseIn(d))} aria-pressed={on}>
                                    {d}d
                                  </Button>
                                );
                              })}
                            </div>
                            <FormControl><Input type="date" {...field} value={field.value || ''} className="mt-1.5" /></FormControl>
                            <FormDescription className="text-xs">
                              What the piece is chased against. Within {URGENT_WINDOW_DAYS} days is marked urgent.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                      );
                    }}/>
                    </PanelSection>

                    {/* Where it goes, beside when. Delivery sat in Pricing, which it is not. */}
                    <PanelSection title="Delivery" icon={<Truck className="h-3.5 w-3.5" />}>
                    <DeliveryFields
                      value={delivery}
                      onChange={setDelivery}
                      knownAddresses={knownAddressesFor(
                        selectedCustomerId && selectedCustomerId !== WALK_IN_CUSTOMER_VALUE ? selectedCustomerId : undefined,
                        customers.find(c => c.id === selectedCustomerId)?.address,
                        orders,
                      )}
                    />
                    </PanelSection>
            </CardContent>
        </Card>

        <div className="lg:col-start-1 lg:col-span-2 lg:row-start-1 lg:row-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <PencilRuler className="mr-3 h-6 w-6 text-primary"/>
                {isEditMode ? `Edit Order ${order?.id}` : 'Create Custom Order'}
              </CardTitle>
              <CardDescription>
                {isEditMode ? 'Update the details for this custom order.' : 'Add one or more items to generate a combined price estimate.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
                {/* No ScrollArea here any more. Radix lays its content out as a table
                    so it can scroll sideways, and a table sizes to its content -- the
                    Category select's longest option pushed it to 519px inside a 311px
                    card on a phone, and with only vertical scrolling enabled the
                    viewport simply clipped the rest. Every field on the right edge was
                    cut off. It was also a 60vh scroll box inside a page that scrolls,
                    which on a phone is two scrollbars fighting over one thumb. The list
                    flows now; on a desktop the pricing card is sticky beside it. */}
                <div>
                <div className="space-y-6">
                {/* Each item is a plain panel, not a Card: it already sits
                    inside the form's Card, and card-in-card reads as two
                    competing surfaces. */}
                {fields.map((field, index) => {
                    const it = (formValues.items || [])[index];
                    const open = openItem === index;
                    const rowPrice = it ? priceOfItem(it, {
                      goldRatePerGram18k: formValues.goldRate18k || 0,
                      goldRatePerGram21k: formValues.goldRate21k || 0,
                      goldRatePerGram22k: formValues.goldRate22k || 0,
                      goldRatePerGram24k: formValues.goldRate24k || 0,
                      palladiumRatePerGram: settings.palladiumRatePerGram,
                      platinumRatePerGram: settings.platinumRatePerGram,
                      silverRatePerGram: settings.silverRatePerGram,
                    }) : 0;
                    const spec = [
                      it?.metalType ? describeMetal(it.metalType, it.karat) : null,
                      it?.estimatedWeightG ? `${it.estimatedWeightG}g` : null,
                      it?.size || null,
                    ].filter(Boolean).join(' · ');
                    return (
                    <div key={field.id} className={cn('rounded-lg border bg-muted/30', open && 'ring-1 ring-primary/30')}>
                        {/* Collapsed, an item still says what it is and what it
                            costs — enough to spot the wrong one without opening it. */}
                        <div className="flex items-center gap-2 p-3">
                          <button type="button" onClick={() => setOpenItem(open ? -1 : index)}
                            className="flex items-center gap-3 min-w-0 flex-1 text-left">
                            <ChevronRight className={cn('h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                            <span className="text-xs font-mono text-muted-foreground flex-shrink-0">#{index + 1}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold truncate">
                                {it?.description?.trim() || <span className="text-muted-foreground font-normal">Untitled piece</span>}
                              </span>
                              {spec && <span className="block text-xs text-muted-foreground truncate">{spec}</span>}
                            </span>
                            {rowPrice > 0 && (
                              <span className="text-sm font-semibold tabular-nums flex-shrink-0">
                                PKR {rowPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                              </span>
                            )}
                          </button>
                          {fields.length > 1 && (
                            <Button type="button" variant="ghost" size="icon"
                              className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                              onClick={() => remove(index)} aria-label="Remove item">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                        <div className={cn('space-y-5 px-4 pb-4', !open && 'hidden')}>
                            {/*
                              One order of things, top to bottom: what the piece is, what it
                              costs, what the bench needs, and what it was copied from. Every
                              field that was here is still here under the same name with the
                              same rules; what changed is where it sits and what it is called.

                              It used to split the price across the workshop section -- in rate
                              mode the "Price" heading held one checkbox, then came the karigar
                              and the instructions, and only after those did weight, wastage and
                              making appear, under no heading at all. The Diamonds charge was
                              disabled by a box that sat beneath it. And the price mode was a
                              negated checkbox: ticked meant "not manual".
                            */}

                            {/* ── The piece ─────────────────────────────────────────── */}
                            <FormSection title="The piece" />
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <FormField control={form.control} name={`items.${index}.itemCategory`} render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Category</FormLabel>
                                        <CategoryPicker
                                          categories={staticCategories}
                                          value={field.value || ''}
                                          onChange={field.onChange}
                                          placeholder="Select category"
                                        />
                                        <FormMessage />
                                    </FormItem>
                                )}/>
                                <div className="md:col-span-2">
                                    <FormField control={form.control} name={`items.${index}.description`} render={({ field }) => (
                                        <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="e.g. Custom ring with ruby stone" {...field} rows={2}/></FormControl><FormMessage /></FormItem>
                                    )}/>
                                </div>
                            </div>

                            {/* Metal and karat directly under the name: after what it is, the
                                second thing anyone asks about a piece is what it is made of. */}
                            <div className="grid grid-cols-2 gap-3 md:gap-4">
                                <FormField control={form.control} name={`items.${index}.metalType`} render={({ field }) => (
                                    <FormItem><FormLabel>Metal</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                        <FormControl><SelectTrigger><SelectValue placeholder="Choose the metal" /></SelectTrigger></FormControl>
                                        <SelectContent>{metalTypeValues.map(m => <SelectItem key={m} value={m}>{metalLabel(m)}</SelectItem>)}</SelectContent>
                                    </Select><FormMessage /></FormItem>
                                )}/>
                                {/* Only for a metal that carries a karat, and only that metal's own
                                    karats, so 24k palladium cannot be chosen. */}
                                {metalHasKarat(form.watch(`items.${index}.metalType`)) &&
                                    <FormField control={form.control} name={`items.${index}.karat`} render={({ field }) => (
                                        <FormItem><FormLabel>Karat</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                            <SelectContent>{karatsFor(form.watch(`items.${index}.metalType`)).map(k => <SelectItem key={k} value={k}>{k.toUpperCase()}</SelectItem>)}</SelectContent>
                                        </Select><FormMessage /></FormItem>
                                    )}/>
                                }
                            </div>

                            {form.watch(`items.${index}.metalType`) === 'silver' && (
                              <div className="rounded-md border p-3 space-y-3">
                                <p className="text-sm font-medium">925 sterling silver finish</p>
                                <FormField control={form.control} name={`items.${index}.platingType`} render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Plating</FormLabel>
                                    <Select value={field.value || '__none__'} onValueChange={v => { if (v === '') return; field.onChange(v === '__none__' ? '' : v); }}>
                                      <FormControl><SelectTrigger><SelectValue placeholder="No plating" /></SelectTrigger></FormControl>
                                      <SelectContent>
                                        <SelectItem value="__none__">No plating</SelectItem>
                                        {PLATING_TYPES.map(pt => <SelectItem key={pt} value={pt}>{pt}</SelectItem>)}
                                      </SelectContent>
                                    </Select>
                                  </FormItem>
                                )}/>
                                {form.watch(`items.${index}.platingType`) === 'Other' && (
                                  <FormField control={form.control} name={`items.${index}.platingNote`} render={({ field }) => (
                                    <FormItem>
                                      <FormLabel className="text-xs">Describe the plating</FormLabel>
                                      <FormControl><Input placeholder="e.g. Rose gold plating" {...field} /></FormControl>
                                    </FormItem>
                                  )}/>
                                )}
                                <FormField control={form.control} name={`items.${index}.nickelFree`} render={({ field }) => (
                                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                    <FormLabel className="font-normal text-sm cursor-pointer">Nickel free</FormLabel>
                                  </FormItem>
                                )}/>
                              </div>
                            )}

                            {/* One SizePicker rather than seventy lines of inline Selects: the
                                order form had its own copy of the scale logic, so a ring size
                                here was a 51-row dropdown while the same field elsewhere had
                                already become a searchable grid. */}
                            <FormField control={form.control} name={`items.${index}.size`} render={({ field }) => (
                              <FormItem>
                                <SizePicker
                                  categoryId={form.watch(`items.${index}.itemCategory`)}
                                  value={field.value || ''}
                                  onChange={field.onChange}
                                />
                                <FormMessage />
                              </FormItem>
                            )}/>

                            {/* ── Price ─────────────────────────────────────────────── */}
                            <FormSection title="Price" />
                            {/* Two ways to price a piece, as two buttons rather than one
                                negated checkbox. Same boolean underneath -- isManualPrice --
                                so nothing about how the order is stored changes. */}
                            <FormField control={form.control} name={`items.${index}.isManualPrice`} render={({ field }) => (
                                <FormItem>
                                  <PriceModeToggle fixed={!!field.value} onChange={field.onChange} />
                                </FormItem>
                            )}/>

                            {form.watch(`items.${index}.isManualPrice`) ? (
                                <FormField control={form.control} name={`items.${index}.manualPrice`} render={({ field }) => (
                                    <FormItem><FormLabel>Price (PKR)</FormLabel><FormControl><AmountInput placeholder="The agreed total for this piece" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                            ) : (
                                <>
                                {/* Weight and wastage together: the two numbers the metal price is
                                    made from. Wastage does not apply to silver. */}
                                <div className="grid grid-cols-2 gap-3 md:gap-4">
                                    <FormField control={form.control} name={`items.${index}.estimatedWeightG`} render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Weight (g)</FormLabel>
                                            <FormControl><AmountInput {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}/>
                                    {form.watch(`items.${index}.metalType`) !== 'silver' && (
                                        <FormField control={form.control} name={`items.${index}.wastagePercentage`} render={({ field }) => (
                                            <FormItem><FormLabel>Wastage (%)</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
                                        )}/>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-3 md:gap-4">
                                    <FormField control={form.control} name={`items.${index}.makingCharges`} render={({ field }) => (
                                        <FormItem><FormLabel>Making (PKR)</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <FormField control={form.control} name={`items.${index}.stoneCharges`} render={({ field }) => (
                                        <FormItem><FormLabel>Stones (PKR)</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                </div>

                                {/* The box comes first and the fields it opens come under it. The
                                    Diamonds charge used to sit disabled ABOVE the box that enabled
                                    it, so the first thing you met was a field you could not type in. */}
                                <FormField control={form.control} name={`items.${index}.hasDiamonds`} render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                      <FormLabel className="font-normal text-sm cursor-pointer">Has diamonds</FormLabel>
                                    </FormItem>
                                )}/>
                                {form.watch(`items.${index}.hasDiamonds`) && (
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 pl-6 border-l-2 border-muted">
                                    <FormField control={form.control} name={`items.${index}.diamondCharges`} render={({ field }) => (
                                        <FormItem><FormLabel>Diamonds (PKR)</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <div className="md:col-span-2">
                                      <FormField control={form.control} name={`items.${index}.diamondDetails`} render={({ field }) => (
                                         <FormItem><FormLabel>Diamond details</FormLabel><FormControl><Textarea rows={2} placeholder="e.g. Centre 1ct VVS1, sides 12 × 0.05ct VS2" {...field} /></FormControl><FormMessage /></FormItem>
                                      )}/>
                                    </div>
                                  </div>
                                )}

                                <FormField control={form.control} name={`items.${index}.hasStones`} render={({ field }) => (
                                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                      <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                      <FormLabel className="font-normal text-sm cursor-pointer">Has other stones</FormLabel>
                                    </FormItem>
                                )}/>
                                {form.watch(`items.${index}.hasStones`) && (
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 pl-6 border-l-2 border-muted">
                                    <FormField control={form.control} name={`items.${index}.stoneWeightG`} render={({ field }) => (
                                        <FormItem><FormLabel>Stone weight (g)</FormLabel><FormControl><AmountInput placeholder="e.g. 0.5" {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <div className="md:col-span-2">
                                      <FormField control={form.control} name={`items.${index}.stoneDetails`} render={({ field }) => (
                                         <FormItem><FormLabel>Stone details</FormLabel><FormControl><Textarea rows={2} placeholder="e.g. 1 × ruby 2ct, 4 × sapphire 0.5ct" {...field} /></FormControl><FormMessage /></FormItem>
                                      )}/>
                                    </div>
                                  </div>
                                )}
                                </>
                            )}

                            {/* ── For the workshop ──────────────────────────────────── */}
                            <FormSection title="For the workshop" />
                            <FormField control={form.control} name={`items.${index}.adminNote`} render={({ field }) => (
                               <FormItem className="rounded-md border border-warning/40 bg-warning/10 p-3">
                                  <FormLabel className="flex items-center text-warning"><Lock className="mr-2 h-4 w-4"/>Instructions for the karigar</FormLabel>
                                  <FormControl><Textarea placeholder="Stones, plating, sizing, or other specifications" {...field} rows={2} /></FormControl>
                                  <FormDescription className="text-warning">Never printed on a customer estimate or invoice.</FormDescription>
                                  <FormMessage />
                               </FormItem>
                            )}/>
                            <FormField control={form.control} name={`items.${index}.karigarId`} render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Karigar</FormLabel>
                                  <KarigarPicker
                                    value={field.value || ''}
                                    onChange={field.onChange}
                                    clearLabel="No karigar yet"
                                    aria-label="Assign to karigar"
                                  />
                                  <FormMessage />
                                </FormItem>
                            )}/>
                            {/* Completion is a workshop fact, so it lives here and not among the
                                references it used to sit under. Edit mode only, as before. */}
                            {isEditMode && <FormField control={form.control} name={`items.${index}.isCompleted`} render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                  <FormLabel className="font-normal text-sm cursor-pointer">Piece is finished</FormLabel>
                                </FormItem>
                            )}/>}

                            {/* ── References ────────────────────────────────────────── */}
                            <FormSection title="References" hint="optional" />
                            <div>
                                <FormLabel>Sample picture</FormLabel>
                                <FormField control={form.control} name={`items.${index}.sampleImageDataUri`} render={({ field }) => (
                                    <SampleImageInput
                                        value={field.value}
                                        onChange={(dataUri) => form.setValue(`items.${index}.sampleImageDataUri`, dataUri, { shouldValidate: true, shouldDirty: true })}
                                        onRemove={() => form.setValue(`items.${index}.sampleImageDataUri`, '', { shouldValidate: true, shouldDirty: true })}
                                    />
                                )}/>
                            </div>
                            <FormField control={form.control} name={`items.${index}.referenceSku`} render={({ field }) => (
                               <FormItem><FormLabel>Reference SKU</FormLabel><FormControl><Input placeholder="e.g. RIN-123456" {...field} /></FormControl><FormMessage /></FormItem>
                            )}/>
                            <FormField control={form.control} name={`items.${index}.sampleGiven`} render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                                  <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                  <FormLabel className="font-normal text-sm cursor-pointer">Customer provided a physical sample</FormLabel>
                                </FormItem>
                            )}/>
                        </div>
                    </div>
                    );
                })}
                </div>
                </div>
            </CardContent>
            <CardFooter className="flex gap-2 flex-wrap">
                 <Button type="button" onClick={handleAddNewItem}>
                    <PlusCircle className="mr-2 h-4 w-4"/> Add piece
                </Button>
                <ProductSearchDialog onAddProduct={handleAddInventoryProduct} />
                <Button type="button" variant="outline" onClick={() => setScannerOpen(true)}>
                    <ScanLine className="mr-2 h-4 w-4"/> Scan a parchi
                </Button>
                <OrderScanner open={scannerOpen} onOpenChange={setScannerOpen} onAccept={applyScan} />
                <span className="text-xs text-muted-foreground ml-auto self-center">
                  {fields.length} piece{fields.length === 1 ? '' : 's'} on this order
                </span>
            </CardFooter>
          </Card>
        </div>
        
        {/* What it costs. Last on a phone; pinned beside the list on a desktop. */}
        <div className="lg:col-start-3 lg:row-start-2 lg:sticky lg:top-8 lg:self-start">
            <Card>
                <CardHeader className="pb-4">
                    <CardTitle className="flex items-center text-base"><List className="mr-2 h-5 w-5"/>Pricing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                    {(() => {
                      // Only the rates this order actually uses. Every karat of gold and
                      // both palladium grades used to show regardless -- six boxes for a
                      // 21k ring -- and a box that is on screen looks like a box that must
                      // be checked. The list follows the pieces: add an 18k item and the
                      // 18k rate appears; remove it and it goes.
                      const items = (formValues.items || []) as Array<{ metalType?: string; karat?: string }>;
                      const goldKarats = new Set(items.filter(i => i.metalType === 'gold').map(i => i.karat).filter(Boolean));
                      const pdKarats = new Set(items.filter(i => i.metalType === 'palladium').map(i => i.karat).filter(Boolean));
                      const hasPalladium = items.some(i => i.metalType === 'palladium');
                      if (goldKarats.size === 0 && !hasPalladium) return null;
                      const gold = ([['24k','goldRate24k'],['22k','goldRate22k'],['21k','goldRate21k'],['18k','goldRate18k']] as const).filter(([k]) => goldKarats.has(k));
                      const pd = ([['18k','palladiumRate18k'],['12k','palladiumRate12k']] as const).filter(([k]) => pdKarats.size === 0 || pdKarats.has(k));
                      return (
                    <PanelSection title="Metal rates (PKR / gram)" icon={<DollarSign className="h-3.5 w-3.5" />}>
                        {gold.length > 0 && (
                          <div className={cn('grid gap-x-4 gap-y-2 p-3 border rounded-md', gold.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                            {gold.map(([k, name]) => (
                              <FormField key={name} control={form.control} name={name} render={({ field }) => (<FormItem><FormLabel className="text-xs">Gold {k}</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>)}/>
                            ))}
                          </div>
                        )}
                        {hasPalladium && (
                          <div className={cn('grid gap-x-4 gap-y-2 p-3 border rounded-md', gold.length > 0 && 'mt-2', pd.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                            {pd.map(([k, name]) => (
                              <FormField key={name} control={form.control} name={name} render={({ field }) => (<FormItem><FormLabel className="text-xs">Palladium {k}</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>)}/>
                            ))}
                          </div>
                        )}
                        <FormDescription className="text-xs">
                          Applies to every piece on this order.{hasPalladium && ' A palladium rate left at zero falls back to the shop\u2019s flat palladium rate.'}
                        </FormDescription>

                        {/* The rates still price the order; this only decides whether the
                            paper says what they were. Some customers are quoted a piece and
                            not a gold price, and a rate line on the slip reopens a
                            conversation the counter has already closed. */}
                        <FormField control={form.control} name="hideRates" render={({ field }) => (
                            <FormItem className="mt-3 flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                                <div className="space-y-0.5">
                                    <FormLabel className="text-xs font-medium cursor-pointer">Leave rates off the printed bill</FormLabel>
                                    <FormDescription className="text-2xs">Prices stay the same. The slip and the invoice just won&apos;t show the per-gram rate.</FormDescription>
                                </div>
                                <FormControl>
                                    <Switch checked={!!field.value} onCheckedChange={field.onChange} aria-label="Leave rates off the printed bill" />
                                </FormControl>
                            </FormItem>
                        )}/>
                    </PanelSection>
                      );
                    })()}

                    <PanelSection title="Payment" icon={<TicketPercent className="h-3.5 w-3.5" />}>
                    <FormField control={form.control} name="discountAmount" render={({ field }) => (
                       <FormItem>
                            <FormLabel className="text-xs">Discount (PKR)</FormLabel>
                            <FormControl><AmountInput {...field} placeholder="0" /></FormControl>
                            <FormDescription className="text-xs">
                              Carried onto the invoice when this order is finalised.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}/>

                    <FormField control={form.control} name="advancePayment" render={({ field }) => (
                       <FormItem>
                            <FormLabel className="text-xs">Advance paid (cash)</FormLabel>
                            <FormControl><AmountInput {...field} /></FormControl><FormMessage />
                        </FormItem>
                    )}/>
                    
                    <div className="p-3 border rounded-md bg-muted/30">
                        <p className="text-xs font-medium mb-2">Advance in exchange (gold / diamonds)</p>
                        <div className="space-y-2">
                            <FormField control={form.control} name="advanceInExchangeDescription" render={({ field }) => (
                               <FormItem><FormLabel className="text-xs">What was received</FormLabel><FormControl><Textarea placeholder="e.g., Old gold ring (21k, ~5.2g)" {...field} rows={2} /></FormControl><FormMessage /></FormItem>
                            )}/>
                            <FormField control={form.control} name="advanceInExchangeValue" render={({ field }) => (
                               <FormItem><FormLabel className="text-xs">Its value (PKR)</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                            )}/>
                        </div>
                    </div>
                    </PanelSection>

                    {/* The arithmetic, laid out as a running deduction: what the
                        pieces come to, what comes off, and what is left. Each
                        line names where its figure was entered. */}
                    <div className="rounded-lg border bg-muted/40 overflow-hidden">
                        <dl className="divide-y text-sm">
                            <div className="flex justify-between items-baseline gap-3 px-3 py-2">
                                <dt className="text-muted-foreground">
                                    Items
                                    <span className="block text-2xs">{(formValues.items || []).length} piece{(formValues.items || []).length === 1 ? '' : 's'}</span>
                                </dt>
                                <dd className="font-medium tabular-nums">{money(liveEstimate.subtotal)}</dd>
                            </div>

                            {liveEstimate.discount > 0 && (
                              <div className="flex justify-between items-baseline gap-3 px-3 py-2">
                                <dt className="text-muted-foreground">Discount</dt>
                                <dd className="font-medium tabular-nums text-destructive">− {money(liveEstimate.discount)}</dd>
                              </div>
                            )}

                            {(Number(formValues.advancePayment) || 0) > 0 && (
                              <div className="flex justify-between items-baseline gap-3 px-3 py-2">
                                <dt className="text-muted-foreground">Advance paid</dt>
                                <dd className="font-medium tabular-nums text-destructive">− {money(Number(formValues.advancePayment) || 0)}</dd>
                              </div>
                            )}

                            {(Number(formValues.advanceInExchangeValue) || 0) > 0 && (
                              <div className="flex justify-between items-baseline gap-3 px-3 py-2">
                                <dt className="text-muted-foreground">
                                    Taken in exchange
                                    {formValues.advanceInExchangeDescription && (
                                      <span className="block text-2xs truncate max-w-[11rem]">{formValues.advanceInExchangeDescription}</span>
                                    )}
                                </dt>
                                <dd className="font-medium tabular-nums text-destructive">− {money(Number(formValues.advanceInExchangeValue) || 0)}</dd>
                              </div>
                            )}
                        </dl>

                        <div className="flex justify-between items-baseline gap-3 px-3 py-3 bg-primary/5 border-t">
                            <span className="font-semibold">Balance due</span>
                            <span className="text-xl font-bold text-primary tabular-nums">{money(liveEstimate.grandTotal)}</span>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex-col gap-2">
                    <Button type="button" variant="outline" onClick={() => router.back()} className="w-full">
                        <Ban className="mr-2 h-4 w-4" /> Cancel
                    </Button>
                    <Button type="submit" size="lg" className="w-full" disabled={form.formState.isSubmitting} aria-label="Save">
                        {form.formState.isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <Save className="mr-2 h-5 w-5" />}
                         {form.formState.isSubmitting ? "Saving..." : (isEditMode ? 'Save Changes' : 'Save Order')}
                    </Button>
                </CardFooter>
            </Card>
        </div>

        {/* On a phone the Save button was the last thing on a long page. This keeps it
            under the thumb with the running total beside it. Inside the <form>, so it
            submits the same way; fixed, so it does not scroll away. Right padding leaves
            the voice button its corner. */}
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2.5 pr-20 pb-[calc(0.625rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                    <p className="text-2xs uppercase tracking-wide text-muted-foreground leading-none">Total</p>
                    <p className="text-base font-semibold tabular-nums truncate">
                        PKR {liveEstimate.grandTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                </div>
                <Button type="submit" size="lg" className="shrink-0" disabled={form.formState.isSubmitting} aria-label="Save">
                    {form.formState.isSubmitting ? <Loader2 className="mr-2 h-5 w-5 animate-spin"/> : <Save className="mr-2 h-5 w-5" />}
                    {form.formState.isSubmitting ? 'Saving…' : (isEditMode ? 'Save' : 'Create')}
                </Button>
            </div>
        </div>
      </form>
    </Form>
  );
};
