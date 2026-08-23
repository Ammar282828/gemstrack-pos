
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
import { KARAT_VALUES as karatValues, METAL_TYPES as metalTypeValues, metalLabel } from '@/lib/materials';
import { useAppStore, Settings, KaratValue, DeliveryInfo, calculateProductCosts, Order, OrderItem, Customer, MetalType, Product, Karigar, staticCategories, CUSTOMER_SOURCES, CUSTOMER_SOURCE_LABELS } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Loader2, DollarSign, Weight, Zap, Diamond, Gem as GemIcon, FileText, Printer, PencilRuler, PlusCircle, Trash2, Camera, Link as LinkIcon, Hand, List, Upload, X, User, Phone, MessageSquare, Percent, Save, Ban, Search, Briefcase, Lock , ChevronRight, TicketPercent } from 'lucide-react';
import { CustomerAutocomplete } from '@/components/customer/customer-autocomplete';
import { useToast } from '@/hooks/use-toast';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import QRCode from 'qrcode.react';
import Image from 'next/image';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css'
import { Label } from '@/components/ui/label';
import { cn, normalizePhoneNumber } from '@/lib/utils';
import { CategoryPicker } from '@/components/shared/category-picker';
import { AmountInput } from '@/components/ui/amount-input';
import { PageBack } from '@/components/shared/page-back';

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
  metalType: z.enum(metalTypeValues).default('silver'),
  isCompleted: z.boolean().default(false),
  karigarId: z.string().optional(),
  isManualPrice: z.boolean().default(true),
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
const orderFormSchema = z.object({
    items: z.array(orderItemSchema).min(1, "You must add at least one item to the estimate."),
    goldRate18k: z.coerce.number().min(0),
    goldRate21k: z.coerce.number().min(0),
    goldRate22k: z.coerce.number().min(0),
    goldRate24k: z.coerce.number().min(0),
    discountAmount: z.coerce.number().min(0).default(0),
    advancePayment: z.coerce.number().min(0).default(0),
    advanceInExchangeDescription: z.string().optional(),
    advanceInExchangeValue: z.coerce.number().min(0).default(0),
    customerId: z.string().optional(),
    customerName: z.string().optional(),
    customerContact: z.string().optional(),
    source: z.enum(CUSTOMER_SOURCES).optional(),
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
    metalType: (p.metalType || 'silver') as MetalType,
    isCompleted: false,
    isManualPrice: true,
    manualPrice: p.isCustomPrice ? (p.customPrice || 0) : 0,
    size: p.size || undefined,
    platingType: p.platingType || undefined,
    platingNote: p.platingNote || undefined,
    nickelFree: !!p.nickelFree,
  };
}

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
      discountAmount: 0,
      advancePayment: 0,
      advanceInExchangeDescription: '',
      advanceInExchangeValue: 0,
      customerId: WALK_IN_CUSTOMER_VALUE,
      customerName: '',
      customerContact: '',
      source: undefined,
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
        goldRate21k: rates.goldRatePerGram21k || 0,
        goldRate22k: rates.goldRatePerGram22k || 0,
        goldRate24k: rates.goldRatePerGram24k || 0,
        discountAmount: Number(order.discountAmount) || 0,
        advancePayment: Number(order.advancePayment) || 0,
        advanceInExchangeDescription: order.advanceInExchangeDescription || '',
        advanceInExchangeValue: Number(order.advanceInExchangeValue) || 0,
        customerId: order.customerId || WALK_IN_CUSTOMER_VALUE,
        customerName: order.customerName || '',
        customerContact: normalizePhoneNumber(order.customerContact) || '',
        source: order.source,
      });
    } else if (!isEditMode && settings.goldRatePerGram21k > 0) {
      form.reset({
        ...form.getValues(),
        goldRate18k: settings.goldRatePerGram18k,
        goldRate21k: settings.goldRatePerGram21k,
        goldRate22k: settings.goldRatePerGram22k,
        goldRate24k: settings.goldRatePerGram24k,
      });
    }
  }, [order, settings, form, isEditMode]);


  const formValues = form.watch();
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
    const ratesForOrder: Partial<Settings> = {
        goldRatePerGram18k: data.goldRate18k || 0,
        goldRatePerGram21k: data.goldRate21k || 0,
        goldRatePerGram22k: data.goldRate22k || 0,
        goldRatePerGram24k: data.goldRate24k || 0,
        palladiumRatePerGram: settings.palladiumRatePerGram,
        platinumRatePerGram: settings.platinumRatePerGram,
        silverRatePerGram: settings.silverRatePerGram,
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
            subtotal,
            discountAmount: discount,
            grandTotal,
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
        metalType: 'silver',
        isCompleted: false,
        hasStones: false,
        stoneWeightG: 0,
        karigarId: '',
        isManualPrice: true,
        manualPrice: 0,
        platingType: '', platingNote: '', nickelFree: false,
        adminNote: '',
    });
  };

  return (
    <Form {...form}>
      <PageBack fallback="/orders" label="Back to orders" className="mb-2" />
      <form onSubmit={form.handleSubmit(onSubmit)} className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
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
                <ScrollArea className="h-[60vh] pr-4 -mr-4">
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
                        <div className={cn('space-y-4 px-4 pb-4', !open && 'hidden')}>
                            <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70 pt-1">The piece</p>
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <FormField control={form.control} name={`items.${index}.itemCategory`} render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Category</FormLabel>
                                        <CategoryPicker
                                          categories={staticCategories}
                                          value={field.value || '' || ''}
                                          onChange={field.onChange}
                                          placeholder="Select category"
                                        />
                                        <FormMessage />
                                    </FormItem>
                                )}/>
                                <div className="md:col-span-2">
                                    <FormField control={form.control} name={`items.${index}.description`} render={({ field }) => (
                                        <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="e.g., Custom ring with ruby stone" {...field} rows={2}/></FormControl><FormMessage /></FormItem>
                                    )}/>
                                </div>
                            </div>

                            {form.watch(`items.${index}.metalType`) === 'silver' && (
                              <div className="rounded-md border p-3 space-y-3">
                                <p className="text-sm font-medium">925 Sterling Silver finish</p>
                                <FormField control={form.control} name={`items.${index}.platingType`} render={({ field }) => (
                                  <FormItem>
                                    <FormLabel className="text-xs">Plating</FormLabel>
                                    <Select value={field.value || '__none__'} onValueChange={v => field.onChange(v === '__none__' ? '' : v)}>
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

                            {/* One SizePicker rather than seventy lines of
                                inline Selects: the order form had its own copy
                                of the scale logic, so a ring size here was a
                                51-row dropdown while the same field elsewhere
                                had already become a searchable grid. */}
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

                            {/* Metal + Karat — always visible so they are recorded even in manual price mode */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <FormField control={form.control} name={`items.${index}.metalType`} render={({ field }) => (
                                    <FormItem><FormLabel>Metal</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value} defaultValue={field.value}>
                                        <FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                        <SelectContent>{metalTypeValues.map(m => <SelectItem key={m} value={m}>{metalLabel(m)}</SelectItem>)}</SelectContent>
                                    </Select><FormMessage /></FormItem>
                                )}/>
                                {form.watch(`items.${index}.metalType`) === 'gold' &&
                                    <FormField control={form.control} name={`items.${index}.karat`} render={({ field }) => (
                                        <FormItem><FormLabel className="flex items-center"><Zap className="mr-2 h-4 w-4"/>Karat</FormLabel>
                                        <Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue/></SelectTrigger></FormControl>
                                            <SelectContent>{karatValues.map(k => <SelectItem key={k} value={k}>{k.toUpperCase()}</SelectItem>)}</SelectContent>
                                        </Select><FormMessage /></FormItem>
                                    )}/>
                                }
                            </div>

                            <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70 pt-1">Price</p>
                            {/* Manual price mode (Primary) */}
                            {form.watch(`items.${index}.isManualPrice`) && (
                                <div className="space-y-4 p-3 border rounded-md bg-muted/30">
                                    <FormField control={form.control} name={`items.${index}.manualPrice`} render={({ field }) => (
                                        <FormItem><FormLabel className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/>Manual Price (PKR)</FormLabel><FormControl><AmountInput placeholder="Enter total price for this item" {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <div>
                                        <Label className="text-muted-foreground text-xs">Reference Rate per Gram (Optional)</Label>
                                        <p className="text-xs text-muted-foreground mb-1">For internal reference only — does not affect the price.</p>
                                        <AmountInput value="" placeholder="e.g., 275" className="mt-1" disabled aria-label="Reference Rate per Gram (Optional)"/>
                                    </div>
                                </div>
                            )}

                            {/* Rate & stone calculation toggle */}
                            <FormField control={form.control} name={`items.${index}.isManualPrice`} render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-3 bg-muted/30">
                                    <FormControl><Checkbox checked={!field.value} onCheckedChange={(checked) => field.onChange(!checked)} /></FormControl>
                                    <div className="space-y-0.5 leading-none">
                                        <FormLabel className="flex items-center cursor-pointer text-sm text-muted-foreground">Use Rate &amp; Stone Calculation Instead</FormLabel>
                                        <FormDescription className="text-xs">Calculate price from weight, rate, wastage, and charges.</FormDescription>
                                    </div>
                                </FormItem>
                            )}/>

                            <p className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70 pt-1">For the workshop</p>
                            {/* Instructions belong with what the bench needs,
                                not stranded between plating and size. */}
                            <FormField control={form.control} name={`items.${index}.adminNote`} render={({ field }) => (
                               <FormItem className="rounded-md border border-warning/40 bg-warning/10 p-3">
                                  <FormLabel className="flex items-center text-warning"><Lock className="mr-2 h-4 w-4"/>Instructions for the karigar</FormLabel>
                                  <FormControl><Textarea placeholder="Stones, plating, sizing, or other specifications" {...field} rows={2} /></FormControl>
                                  <FormDescription className="text-warning">Never printed on a customer estimate or invoice.</FormDescription>
                                  <FormMessage />
                               </FormItem>
                            )}/>
                            {/* Karigar always visible */}
                            <FormField
                                control={form.control}
                                name={`items.${index}.karigarId`}
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel className="flex items-center"><Briefcase className="mr-2 h-4 w-4"/>Assign to Karigar</FormLabel>
                                    <KarigarPicker
                                      value={field.value || ''}
                                      onChange={field.onChange}
                                      clearLabel="No karigar yet"
                                      aria-label="Assign to karigar"
                                    />
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Auto-calculated mode (Secondary) */}
                            {!form.watch(`items.${index}.isManualPrice`) && (
                                <>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <FormField control={form.control} name={`items.${index}.estimatedWeightG`} render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="flex items-center"><Weight className="mr-2 h-4 w-4"/>
                                                {form.watch(`items.${index}.metalType`) === 'silver' ? 'Weight (g) × 925 Sterling Silver Rate/g' : 'Est. Weight (g)'}
                                            </FormLabel>
                                            <FormControl><AmountInput {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}/>
                                </div>
                                {/* Hide wastage for silver */}
                                {form.watch(`items.${index}.metalType`) !== 'silver' && (
                                    <FormField control={form.control} name={`items.${index}.wastagePercentage`} render={({ field }) => (
                                        <FormItem><FormLabel className="flex items-center"><Percent className="mr-2 h-4 w-4"/>Wastage (%)</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                )}
                                <Separator />
                                <p className="font-medium text-sm">Additional Charges & Details</p>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <FormField control={form.control} name={`items.${index}.makingCharges`} render={({ field }) => (
                                        <FormItem><FormLabel className="flex items-center"><GemIcon className="mr-2 h-4 w-4"/>Making</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <FormField control={form.control} name={`items.${index}.diamondCharges`} render={({ field }) => (
                                        <FormItem><FormLabel className="flex items-center"><Diamond className="mr-2 h-4 w-4"/>Diamonds</FormLabel><FormControl><AmountInput {...field} disabled={!form.watch(`items.${index}.hasDiamonds`)} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                    <FormField control={form.control} name={`items.${index}.stoneCharges`} render={({ field }) => (
                                        <FormItem><FormLabel>Stones</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                                    )}/>
                                </div>
                                <div className="flex gap-4">
                                    <FormField control={form.control} name={`items.${index}.hasDiamonds`} render={({ field }) => (
                                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                        <div className="space-y-1 leading-none"><FormLabel className="flex items-center cursor-pointer">Item Contains Diamonds?</FormLabel></div></FormItem>
                                    )}/>
                                    <FormField control={form.control} name={`items.${index}.hasStones`} render={({ field }) => (
                                        <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                        <div className="space-y-1 leading-none"><FormLabel className="flex items-center cursor-pointer">Item Contains Other Stones?</FormLabel></div></FormItem>
                                    )}/>
                                </div>
                                {form.watch(`items.${index}.hasStones`) && <FormField control={form.control} name={`items.${index}.stoneWeightG`} render={({ field }) => (<FormItem><FormLabel>Stone Weight (grams)</FormLabel><FormControl><AmountInput placeholder="e.g., 0.5" {...field} /></FormControl><FormMessage /></FormItem>)}/>}
                                {form.watch(`items.${index}.hasStones`) && <FormField control={form.control} name={`items.${index}.stoneDetails`} render={({ field }) => (
                                   <FormItem><FormLabel className="flex items-center"><GemIcon className="mr-2 h-4 w-4"/>Stone Details</FormLabel><FormControl><Textarea placeholder="e.g., 1x Ruby (2ct), 4x Sapphire (0.5ct each)" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>}
                                {form.watch(`items.${index}.hasDiamonds`) &&
                                  <FormField control={form.control} name={`items.${index}.diamondDetails`} render={({ field }) => (
                                     <FormItem><FormLabel className="flex items-center"><Diamond className="mr-2 h-4 w-4"/>Diamond Details</FormLabel><FormControl><Textarea placeholder="e.g., Center: 1ct VVS1, Side: 12x 0.05ct VS2" {...field} /></FormControl><FormMessage /></FormItem>
                                  )}/>
                                }
                                </>
                            )}

                            <Separator />
                            <p className="font-medium text-sm">Reference Details (Optional)</p>
                             <div>
                                <FormLabel className="flex items-center"><Camera className="mr-2 h-4 w-4"/>Sample Picture</FormLabel>
                                <FormField control={form.control} name={`items.${index}.sampleImageDataUri`} render={({ field }) => (
                                    <SampleImageInput
                                        value={field.value}
                                        onChange={(dataUri) => form.setValue(`items.${index}.sampleImageDataUri`, dataUri, { shouldValidate: true, shouldDirty: true })}
                                        onRemove={() => form.setValue(`items.${index}.sampleImageDataUri`, '', { shouldValidate: true, shouldDirty: true })}
                                    />
                                )}/>
                             </div>

                            <FormField control={form.control} name={`items.${index}.referenceSku`} render={({ field }) => (
                               <FormItem><FormLabel className="flex items-center"><LinkIcon className="mr-2 h-4 w-4"/>Reference SKU</FormLabel><FormControl><Input placeholder="e.g., RIN-123456" {...field} /></FormControl><FormMessage /></FormItem>
                            )}/>

                            <FormField control={form.control} name={`items.${index}.sampleGiven`} render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                <div className="space-y-1 leading-none"><FormLabel className="flex items-center cursor-pointer"><Hand className="mr-2 h-4 w-4"/>Customer provided a physical sample</FormLabel></div></FormItem>
                            )}/>

                            {isEditMode && <FormField control={form.control} name={`items.${index}.isCompleted`} render={({ field }) => (
                                <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4"><FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                <div className="space-y-1 leading-none"><FormLabel className="flex items-center cursor-pointer">Item is Completed</FormLabel></div></FormItem>
                            )}/>}
                        </div>
                    </div>
                    );
                })}
                </div>
                </ScrollArea>
            </CardContent>
            <CardFooter className="flex gap-2 flex-wrap">
                 <Button type="button" onClick={handleAddNewItem}>
                    <PlusCircle className="mr-2 h-4 w-4"/> Add piece
                </Button>
                <ProductSearchDialog onAddProduct={handleAddInventoryProduct} />
                <span className="text-xs text-muted-foreground ml-auto self-center">
                  {fields.length} piece{fields.length === 1 ? '' : 's'} on this order
                </span>
            </CardFooter>
          </Card>
        </div>
        
        <div className="lg:col-span-1">
            <Card className="sticky top-8">
                <CardHeader>
                    <CardTitle className="flex items-center"><List className="mr-2 h-5 w-5"/>Summary</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <FormItem>
                        <FormLabel className="flex items-center"><User className="mr-2 h-4 w-4"/>Customer</FormLabel>
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
                            <FormLabel className="flex items-center"><Phone className="mr-2 h-4 w-4"/>Contact</FormLabel>
                            <FormControl>
                            <PhoneInput
                                value={field.value || undefined}
                                onChange={(val) => field.onChange(val || '')}
                                onBlur={field.onBlur}
                                defaultCountry="PK"
                                international
                                countryCallingCodeEditable={false}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&_.PhoneInputInput]:bg-transparent [&_.PhoneInputInput]:outline-none"
                            />
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
                            <FormLabel className="flex items-center"><Search className="mr-2 h-4 w-4"/>Source</FormLabel>
                            <Select
                                value={field.value ?? '__none__'}
                                onValueChange={(v) => field.onChange(v === '__none__' ? undefined : v)}
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
                            <FormDescription>Taheri spillover, referral, walk-in, etc.</FormDescription>
                            <FormMessage />
                        </FormItem>
                        )}
                    />

                    {(formValues.items || []).some(item => item.metalType === 'gold') && (
                    <div className="space-y-2">
                        <Label className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/>Gold Rates (PKR/gram)</Label>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 border rounded-md">
                            <FormField control={form.control} name="goldRate24k" render={({ field }) => (<FormItem><FormLabel className="text-xs">24k</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>)}/>
                            <FormField control={form.control} name="goldRate22k" render={({ field }) => (<FormItem><FormLabel className="text-xs">22k</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>)}/>
                            <FormField control={form.control} name="goldRate21k" render={({ field }) => (<FormItem><FormLabel className="text-xs">21k</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>)}/>
                            <FormField control={form.control} name="goldRate18k" render={({ field }) => (<FormItem><FormLabel className="text-xs">18k</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>)}/>
                        </div>
                        <FormDescription>This rate applies to all items in this estimate.</FormDescription>
                    </div>
                    )}

                    <DeliveryFields
                      value={delivery}
                      onChange={setDelivery}
                      knownAddresses={knownAddressesFor(
                        selectedCustomerId && selectedCustomerId !== WALK_IN_CUSTOMER_VALUE ? selectedCustomerId : undefined,
                        customers.find(c => c.id === selectedCustomerId)?.address,
                        orders,
                      )}
                    />

                    <FormField control={form.control} name="discountAmount" render={({ field }) => (
                       <FormItem>
                            <FormLabel className="flex items-center"><TicketPercent className="mr-2 h-4 w-4"/>Discount (PKR)</FormLabel>
                            <FormControl><AmountInput {...field} placeholder="0" /></FormControl>
                            <FormDescription className="text-xs">
                              Carried onto the invoice when this order is finalised.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}/>

                    <FormField control={form.control} name="advancePayment" render={({ field }) => (
                       <FormItem>
                            <FormLabel className="flex items-center"><DollarSign className="mr-2 h-4 w-4"/>Advance Payment (Cash)</FormLabel>
                            <FormControl><AmountInput {...field} /></FormControl><FormMessage />
                        </FormItem>
                    )}/>
                    
                    <div className="p-3 border rounded-md bg-muted/30">
                        <p className="font-semibold text-sm mb-2">Advance in Exchange (Gold/Diamonds)</p>
                        <div className="space-y-2">
                            <FormField control={form.control} name="advanceInExchangeDescription" render={({ field }) => (
                               <FormItem><FormLabel className="text-xs">Description of Items Received</FormLabel><FormControl><Textarea placeholder="e.g., Old gold ring (21k, ~5.2g)" {...field} rows={2} /></FormControl><FormMessage /></FormItem>
                            )}/>
                            <FormField control={form.control} name="advanceInExchangeValue" render={({ field }) => (
                               <FormItem><FormLabel className="text-xs">Estimated Value (PKR)</FormLabel><FormControl><AmountInput {...field} /></FormControl><FormMessage /></FormItem>
                            )}/>
                        </div>
                    </div>

                    <Separator/>
                    <div className="space-y-2 p-3 bg-muted/50 rounded-md">
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Subtotal:</span>
                            <span className="font-semibold text-base">PKR {liveEstimate.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        {liveEstimate.discount > 0 && (
                          <div className="flex justify-between items-center text-destructive">
                            <span className="text-muted-foreground">Discount:</span>
                            <span className="font-semibold text-base">- PKR {liveEstimate.discount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center text-destructive">
                            <span className="text-muted-foreground">Advance (Cash + Exchange):</span>
                            <span className="font-semibold text-base">- PKR {((Number(formValues.advancePayment) || 0) + (Number(formValues.advanceInExchangeValue) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between items-center text-xl font-bold">
                            <span>Balance Due:</span>
                            <span className="text-primary">PKR {liveEstimate.grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
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
      </form>
    </Form>
  );
};
