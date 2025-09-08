
"use client";

import React, { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppStore, Settings, useAppReady, Product, Customer, Karigar, GOLD_COIN_CATEGORY_ID, MetalType, KaratValue, AVAILABLE_THEMES, ThemeKey, Order, OrderItem, calculateProductCosts, HisaabEntry } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Save, Building, Phone, Mail, Image as ImageIcon, MapPin, DollarSign, Shield, FileText, Loader2, Database, AlertTriangle, Users, Briefcase, Upload, Trash2, PlusCircle, TabletSmartphone, Palette, ClipboardList, Trash, Info, BookUser, Import } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import Image from 'next/image';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';

const themeKeys = AVAILABLE_THEMES.map(t => t.key) as [ThemeKey, ...ThemeKey[]];

const settingsSchema = z.object({
  goldRatePerGram: z.coerce.number().min(0, "Gold rate must be a positive number"),
  palladiumRatePerGram: z.coerce.number().min(0, "Palladium rate must be a positive number"),
  platinumRatePerGram: z.coerce.number().min(0, "Platinum rate must be a positive number"),
  silverRatePerGram: z.coerce.number().min(0, "Silver rate must be a positive number"),
  shopName: z.string().min(1, "Shop name is required"),
  shopAddress: z.string().optional(),
  shopContact: z.string().optional(),
  shopLogoUrl: z.string().optional(),
  shopLogoUrlBlack: z.string().optional(),
  lastInvoiceNumber: z.coerce.number().int().min(0, "Last invoice number must be a non-negative integer"),
  lastOrderNumber: z.coerce.number().int().min(0, "Last order number must be a non-negative integer"),
  allowedDeviceIds: z.array(z.object({ id: z.string().min(1, "Device ID cannot be empty.") })).optional(),
  theme: z.enum(themeKeys).default('default'),
});

type SettingsFormData = z.infer<typeof settingsSchema>;
type ProductDataForAdd = Omit<Product, 'sku' | 'qrCodeDataUrl'>;
type CustomerDataForAdd = Omit<Customer, 'id'>;
type KarigarDataForAdd = Omit<Karigar, 'id'>;
type OrderDataForAdd = Omit<Order, 'id' | 'createdAt' | 'status'>;
type HisaabDataForAdd = Omit<HisaabEntry, 'id'>;


const DUMMY_PRODUCTS_TO_SEED: ProductDataForAdd[] = [
  // Rings
  { name: 'Ruby Diamond Ring', categoryId: 'cat001', metalType: 'gold', karat: '22k', metalWeightG: 8.5, wastagePercentage: 10, makingCharges: 15000, hasDiamonds: true, diamondCharges: 75000, stoneCharges: 12000, miscCharges: 500, stoneDetails: "1x Ruby (center), 12x small diamonds", imageUrl: 'https://placehold.co/400x400.png', diamondDetails: 'Center: 0.5ct, Sides: 0.5ct total', hasStones: true, stoneWeightG: 0.8 },
  { name: 'Emerald Gold Ring', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 6.2, wastagePercentage: 10, makingCharges: 12000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 8000, miscCharges: 300, stoneDetails: "3x Emeralds", imageUrl: 'https://placehold.co/400x400.png', hasStones: true, stoneWeightG: 0.6 },
  { name: 'Solitaire Platinum Ring', categoryId: 'cat001', metalType: 'platinum', metalWeightG: 10, wastagePercentage: 5, makingCharges: 25000, hasDiamonds: true, diamondCharges: 150000, stoneCharges: 0, miscCharges: 1000, diamondDetails: '1ct Solitaire, VVS1', imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },

  // Bands
  { name: 'Classic Gold Band', categoryId: 'cat009', metalType: 'gold', karat: '22k', metalWeightG: 12.0, wastagePercentage: 8, makingCharges: 18000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },
  { name: 'Eternity Diamond Band', categoryId: 'cat009', metalType: 'gold', karat: '18k', metalWeightG: 9.8, wastagePercentage: 8, makingCharges: 16000, hasDiamonds: true, diamondCharges: 45000, stoneCharges: 0, miscCharges: 200, diamondDetails: "Eternity band, 1.5ct total", imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },

  // Bracelets
  { name: 'Heavy Gold Bracelet', categoryId: 'cat005', metalType: 'gold', karat: '21k', metalWeightG: 25.5, wastagePercentage: 12, makingCharges: 35000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 1500, imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },
  { name: 'Modern Palladium Bracelet', categoryId: 'cat005', metalType: 'palladium', metalWeightG: 20.0, wastagePercentage: 5, makingCharges: 30000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },

  // Tops (Earrings)
  { name: 'Diamond Stud Earrings', categoryId: 'cat002', metalType: 'gold', karat: '21k', metalWeightG: 5.1, wastagePercentage: 12, makingCharges: 9000, hasDiamonds: true, diamondCharges: 55000, stoneCharges: 0, miscCharges: 0, diamondDetails: '0.25ct each stud', imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },

  // Lockets
  { name: 'Traditional Gold Locket', categoryId: 'cat004', metalType: 'gold', karat: '22k', metalWeightG: 10.2, wastagePercentage: 10, makingCharges: 14000, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 400, imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },

  // Gold Coins (special category)
  { name: 'Gold Coin 10g', categoryId: GOLD_COIN_CATEGORY_ID, metalType: 'gold', karat: '24k', metalWeightG: 10, wastagePercentage: 0, makingCharges: 0, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },
  { name: 'Gold Coin 5g', categoryId: GOLD_COIN_CATEGORY_ID, metalType: 'gold', karat: '24k', metalWeightG: 5, wastagePercentage: 0, makingCharges: 0, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },
  { name: 'Gold Coin 8g (22k)', categoryId: GOLD_COIN_CATEGORY_ID, metalType: 'gold', karat: '22k', metalWeightG: 8.0, wastagePercentage: 0, makingCharges: 0, hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, imageUrl: 'https://placehold.co/400x400.png', hasStones: false, stoneWeightG: 0 },
];

const DUMMY_CUSTOMERS_TO_SEED: CustomerDataForAdd[] = [
    { name: "Ahmed Khan", phone: "0300-1234567", email: "ahmed.khan@example.com", address: "123 Main St, Karachi" },
    { name: "Fatima Ali", phone: "0321-7654321", email: "fatima.ali@example.com", address: "456 Park Ave, Lahore" },
    { name: "Bilal Sheikh", phone: "0333-1122334", email: "bilal.sheikh@example.com", address: "789 Ocean Blvd, Islamabad" },
];

const DUMMY_KARIGARS_TO_SEED: KarigarDataForAdd[] = [
    { name: "Ustad Saleem", contact: "0345-9876543", notes: "Specializes in intricate bridal sets." },
    { name: "Aslam Bhai", contact: "0312-3456789", notes: "Expert in modern platinum designs and repairs." },
];

const DUMMY_ORDERS_TO_SEED: Omit<OrderDataForAdd, 'subtotal' | 'grandTotal'>[] = [
    {
        customerName: "Ayesha Ahmed",
        customerContact: "0301-2233445",
        goldRate: 21500 * (24/21), // Example rate at time of order
        advancePayment: 50000,
        advanceGoldDetails: "5g old gold (21k) provided.",
        items: [
            { description: "Custom bridal necklace set", karat: "22k", estimatedWeightG: 45, makingCharges: 80000, diamondCharges: 150000, stoneCharges: 25000, sampleGiven: false, hasDiamonds: true, isCompleted: false, diamondDetails: "Full set with Polki diamonds", stoneDetails: "Ruby and emerald accents", wastagePercentage: 10, metalType: 'gold', hasStones: true, stoneWeightG: 5.0 },
            { description: "Matching groom's ring", karat: "21k", estimatedWeightG: 12, makingCharges: 15000, diamondCharges: 0, stoneCharges: 0, sampleGiven: true, hasDiamonds: false, isCompleted: false, referenceSku: "BND-000002", wastagePercentage: 10, metalType: 'gold', hasStones: false, stoneWeightG: 0 }
        ]
    },
    {
        customerName: "Zainab Ansari",
        goldRate: 21000 * (24/21),
        advancePayment: 20000,
        items: [
            { description: "Platinum band with custom engraving", karat: '18k', estimatedWeightG: 8, makingCharges: 20000, diamondCharges: 0, stoneCharges: 0, sampleGiven: false, hasDiamonds: false, isCompleted: true, stoneDetails: "Engraving: 'Z & R Forever'", wastagePercentage: 5, metalType: 'platinum', hasStones: false, stoneWeightG: 0 }
        ]
    }
];

const DUMMY_HISAAB_ENTRIES_TO_SEED: HisaabDataForAdd[] = [
    // Customer Entries
    { entityId: 'cust-1721921315802', entityType: 'customer', entityName: 'Ahmed Khan', date: new Date(Date.now() - 20 * 86400000).toISOString(), description: 'Invoice INV-000001', cashDebit: 150000, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0 },
    { entityId: 'cust-1721921315802', entityType: 'customer', entityName: 'Ahmed Khan', date: new Date(Date.now() - 19 * 86400000).toISOString(), description: 'Cash payment', cashDebit: 0, cashCredit: 100000, goldDebitGrams: 0, goldCreditGrams: 0 },
    { entityId: 'cust-1721921315802', entityType: 'customer', entityName: 'Ahmed Khan', date: new Date(Date.now() - 5 * 86400000).toISOString(), description: 'Invoice INV-000002', cashDebit: 75000, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0 },
    
    { entityId: 'cust-1721921315803', entityType: 'customer', entityName: 'Fatima Ali', date: new Date(Date.now() - 15 * 86400000).toISOString(), description: 'Invoice INV-000003', cashDebit: 320000, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0 },
    { entityId: 'cust-1721921315803', entityType: 'customer', entityName: 'Fatima Ali', date: new Date(Date.now() - 15 * 86400000).toISOString(), description: 'Full payment received', cashDebit: 0, cashCredit: 320000, goldDebitGrams: 0, goldCreditGrams: 0 },

    // Karigar Entries
    { entityId: 'karigar-1721921315890-g0g2l', entityType: 'karigar', entityName: 'Ustad Saleem', date: new Date(Date.now() - 30 * 86400000).toISOString(), description: 'Gold given for new set', cashDebit: 0, cashCredit: 0, goldDebitGrams: 50.0, goldCreditGrams: 0 },
    { entityId: 'karigar-1721921315890-g0g2l', entityType: 'karigar', entityName: 'Ustad Saleem', date: new Date(Date.now() - 10 * 86400000).toISOString(), description: 'Cash advance for expenses', cashDebit: 25000, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 0 },
    { entityId: 'karigar-1721921315890-g0g2l', entityType: 'karigar', entityName: 'Ustad Saleem', date: new Date(Date.now() - 2 * 86400000).toISOString(), description: 'Finished set received (48.5g net)', cashDebit: 0, cashCredit: 0, goldDebitGrams: 0, goldCreditGrams: 48.5 },
    
    { entityId: 'karigar-1721921315890-y58l9', entityType: 'karigar', entityName: 'Aslam Bhai', date: new Date(Date.now() - 8 * 86400000).toISOString(), description: 'Repair work charges', cashDebit: 0, cashCredit: 15000, goldDebitGrams: 0, goldCreditGrams: 0 },
];

const DataDeletionButton: React.FC<{
    action: () => Promise<void>;
    buttonText: string;
    description: string;
    children: React.ReactNode;
}> = ({ action, buttonText, description, children }) => {
    const { toast } = useToast();
    const [isLoading, setIsLoading] = useState(false);

    const handleAction = async () => {
        setIsLoading(true);
        try {
            await action();
            toast({ title: "Success", description: `${buttonText} action completed.` });
        } catch (error) {
            toast({ title: "Error", description: `Failed to complete ${buttonText.toLowerCase()} action.`, variant: "destructive" });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <AlertDialog>
            <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={isLoading}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : children}
                    {isLoading ? 'Processing...' : buttonText}
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5" />Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleAction} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                        Yes, I'm sure
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
};


export default function SettingsPage() {
  const { toast } = useToast();
  const appReady = useAppReady();
  const currentSettings = useAppStore(state => state.settings);
  const updateSettingsAction = useAppStore(state => state.updateSettings);
  const addProductAction = useAppStore(state => state.addProduct);
  const addCustomerAction = useAppStore(state => state.addCustomer);
  const addKarigarAction = useAppStore(state => state.addKarigar);
  const addOrderAction = useAppStore(state => state.addOrder);
  const addHisaabEntryAction = useAppStore(state => state.addHisaabEntry);
  const isSettingsLoading = useAppStore(state => state.isSettingsLoading);

  const {
    clearAllProducts,
    clearAllCustomers,
    clearAllKarigars,
    clearAllInvoices,
    clearAllOrders,
    clearAllData,
  } = useAppStore();

  const [isSeedingProducts, setIsSeedingProducts] = useState(false);
  const [isSeedingCustomers, setIsSeedingCustomers] = useState(false);
  const [isSeedingKarigars, setIsSeedingKarigars] = useState(false);
  const [isSeedingOrders, setIsSeedingOrders] = useState(false);
  const [isSeedingHisaab, setIsSeedingHisaab] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoPreviewBlack, setLogoPreviewBlack] = useState<string | null>(null);

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      goldRatePerGram: 0,
      palladiumRatePerGram: 0,
      platinumRatePerGram: 0,
      silverRatePerGram: 0,
      shopName: "",
      shopAddress: "",
      shopContact: "",
      shopLogoUrl: "",
      shopLogoUrlBlack: "",
      lastInvoiceNumber: 0,
      lastOrderNumber: 0,
      allowedDeviceIds: [],
      theme: 'default',
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "allowedDeviceIds",
  });

  React.useEffect(() => {
    if (appReady && currentSettings) {
      const deviceIdsForForm = Array.isArray(currentSettings.allowedDeviceIds) 
        ? currentSettings.allowedDeviceIds.map(id => ({ id })) 
        : [];
      
      const goldRate21k = currentSettings.goldRatePerGram * (21 / 24);

      form.reset({
        goldRatePerGram: parseFloat(goldRate21k.toFixed(2)),
        palladiumRatePerGram: currentSettings.palladiumRatePerGram,
        platinumRatePerGram: currentSettings.platinumRatePerGram,
        silverRatePerGram: currentSettings.silverRatePerGram || 0,
        shopName: currentSettings.shopName,
        shopAddress: currentSettings.shopAddress || "",
        shopContact: currentSettings.shopContact || "",
        shopLogoUrl: currentSettings.shopLogoUrl || "",
        shopLogoUrlBlack: currentSettings.shopLogoUrlBlack || "",
        lastInvoiceNumber: currentSettings.lastInvoiceNumber,
        lastOrderNumber: currentSettings.lastOrderNumber || 0,
        allowedDeviceIds: deviceIdsForForm,
        theme: currentSettings.theme || 'default',
      });
      if (currentSettings.shopLogoUrl) {
        setLogoPreview(currentSettings.shopLogoUrl);
      }
      if (currentSettings.shopLogoUrlBlack) {
        setLogoPreviewBlack(currentSettings.shopLogoUrlBlack);
      }
    }
  }, [currentSettings, form, appReady]);


  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>, isBlackVersion: boolean = false) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 200 * 1024) { // 200KB size limit
      toast({
        title: "File Too Large",
        description: "Please choose a logo file smaller than 200KB.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      if (isBlackVersion) {
        setLogoPreviewBlack(dataUrl);
        form.setValue('shopLogoUrlBlack', dataUrl, { shouldValidate: true, shouldDirty: true });
      } else {
        setLogoPreview(dataUrl);
        form.setValue('shopLogoUrl', dataUrl, { shouldValidate: true, shouldDirty: true });
      }
    };
    reader.readAsDataURL(file);
  };

  const onSubmit = async (data: SettingsFormData) => {
    try {
        const goldRate21k = data.goldRatePerGram;
        const goldRate24k = goldRate21k * (24 / 21);

        const settingsToSave: Partial<Settings> = {
            ...data,
            goldRatePerGram: goldRate24k,
            allowedDeviceIds: data.allowedDeviceIds?.map(item => item.id).filter(Boolean) || []
        };
        await updateSettingsAction(settingsToSave);
        toast({ title: "Settings Updated", description: "Your shop settings have been saved." });
    } catch (error) {
        toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" });
    }
  };

  const handleSeedProducts = async () => {
    if (DUMMY_PRODUCTS_TO_SEED.length === 0) {
        toast({ title: "No Data to Seed", description: "The dummy product list is empty.", variant: "default" });
        return;
    }
    setIsSeedingProducts(true);
    let successCount = 0;
    let errorCount = 0;

    toast({
      title: "Product Seeding Started",
      description: `Attempting to add ${DUMMY_PRODUCTS_TO_SEED.length} dummy products...`,
    });

    for (const productData of DUMMY_PRODUCTS_TO_SEED) {
      try {
        const newProduct = await addProductAction(productData);
        if (newProduct) {
          successCount++;
        } else {
          toast({
            title: "Product Seeding Error",
            description: `Failed to add product (Category ID: ${productData.categoryId}). The category might be missing.`,
            variant: "destructive",
          });
          errorCount++;
        }
      } catch (error) {
        console.error("Error seeding product:", error);
        toast({
          title: "Product Seeding Exception",
          description: `An error occurred while adding a product: ${ (error as Error).message || 'Unknown error' }`,
          variant: "destructive",
        });
        errorCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    toast({
      title: "Product Seeding Complete",
      description: `Finished. Success: ${successCount}, Errors: ${errorCount}.`,
      variant: errorCount > 0 ? "destructive" : "default",
    });
    setIsSeedingProducts(false);
  };

  const handleSeedCustomers = async () => {
    if (DUMMY_CUSTOMERS_TO_SEED.length === 0) {
        toast({ title: "No Data to Seed", description: "The dummy customer list is empty.", variant: "default" });
        return;
    }
    setIsSeedingCustomers(true);
    let successCount = 0;
    let errorCount = 0;
    toast({ title: "Customer Seeding Started", description: `Attempting to add ${DUMMY_CUSTOMERS_TO_SEED.length} dummy customers...`});

    for (const customerData of DUMMY_CUSTOMERS_TO_SEED) {
      try {
        const newCustomer = await addCustomerAction(customerData);
        if (newCustomer) {
          successCount++;
        } else {
          toast({ title: "Customer Seeding Error", description: `Failed to add customer: ${customerData.name}`, variant: "destructive" });
          errorCount++;
        }
      } catch (e) {
        toast({ title: "Customer Seeding Exception", description: `Error adding ${customerData.name}: ${(e as Error).message}`, variant: "destructive" });
        errorCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    toast({ title: "Customer Seeding Complete", description: `Finished. Success: ${successCount}, Errors: ${errorCount}.`, variant: errorCount > 0 ? "destructive" : "default"});
    setIsSeedingCustomers(false);
  };

  const handleSeedKarigars = async () => {
    if (DUMMY_KARIGARS_TO_SEED.length === 0) {
        toast({ title: "No Data to Seed", description: "The dummy karigar list is empty.", variant: "default" });
        return;
    }
    setIsSeedingKarigars(true);
    let successCount = 0;
    let errorCount = 0;
    toast({ title: "Karigar Seeding Started", description: `Attempting to add ${DUMMY_KARIGARS_TO_SEED.length} dummy karigars...`});

    for (const karigarData of DUMMY_KARIGARS_TO_SEED) {
      try {
        const newKarigar = await addKarigarAction(karigarData);
        if (newKarigar) {
          successCount++;
        } else {
          toast({ title: "Karigar Seeding Error", description: `Failed to add karigar: ${karigarData.name}`, variant: "destructive" });
          errorCount++;
        }
      } catch (e) {
        toast({ title: "Karigar Seeding Exception", description: `Error adding ${karigarData.name}: ${(e as Error).message}`, variant: "destructive" });
        errorCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    toast({ title: "Karigar Seeding Complete", description: `Finished. Success: ${successCount}, Errors: ${errorCount}.`, variant: errorCount > 0 ? "destructive" : "default"});
    setIsSeedingKarigars(false);
  };

  const handleSeedOrders = async () => {
     if (DUMMY_ORDERS_TO_SEED.length === 0) {
        toast({ title: "No Data to Seed", description: "The dummy order list is empty.", variant: "default" });
        return;
    }
    setIsSeedingOrders(true);
    let successCount = 0;
    let errorCount = 0;
    toast({ title: "Order Seeding Started", description: `Attempting to add ${DUMMY_ORDERS_TO_SEED.length} dummy orders...`});

    for (const orderData of DUMMY_ORDERS_TO_SEED) {
      try {
        let subtotal = 0;
        const ratesForCalc = { goldRatePerGram24k: orderData.goldRate, palladiumRatePerGram: 0, platinumRatePerGram: 0, silverRatePerGram: 0 };
        const enrichedItems: OrderItem[] = orderData.items.map((item) => {
          const itemAsProduct = {
            ...item,
            categoryId: '', // Custom orders don't have a category
            metalType: item.metalType,
            metalWeightG: item.estimatedWeightG,
            wastagePercentage: item.wastagePercentage,
            hasDiamonds: item.hasDiamonds,
            miscCharges: 0,
          };
          const costs = calculateProductCosts(itemAsProduct, ratesForCalc);
          subtotal += costs.totalPrice;
          return { ...item, metalCost: costs.metalCost, wastageCost: costs.wastageCost, totalEstimate: costs.totalPrice };
        });

        const grandTotal = subtotal - (orderData.advancePayment || 0);

        const fullOrderData: OrderDataForAdd = {
          ...orderData,
          items: enrichedItems,
          subtotal,
          grandTotal,
        };
        
        const newOrder = await addOrderAction(fullOrderData);
        if (newOrder) {
          successCount++;
        } else {
          toast({ title: "Order Seeding Error", description: `Failed to add order for: ${orderData.customerName}`, variant: "destructive" });
          errorCount++;
        }
      } catch (e) {
        toast({ title: "Order Seeding Exception", description: `Error adding order for ${orderData.customerName}: ${(e as Error).message}`, variant: "destructive" });
        errorCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    toast({ title: "Order Seeding Complete", description: `Finished. Success: ${successCount}, Errors: ${errorCount}.`, variant: errorCount > 0 ? "destructive" : "default"});
    setIsSeedingOrders(false);
  };

  const handleSeedHisaab = async () => {
    if (DUMMY_HISAAB_ENTRIES_TO_SEED.length === 0) {
        toast({ title: "No Data to Seed", description: "The dummy hisaab list is empty." });
        return;
    }
    setIsSeedingHisaab(true);
    let successCount = 0;
    let errorCount = 0;
    toast({ title: "Hisaab Seeding Started", description: `Attempting to add ${DUMMY_HISAAB_ENTRIES_TO_SEED.length} dummy transactions...`});

    for (const hisaabData of DUMMY_HISAAB_ENTRIES_TO_SEED) {
        try {
            const newEntry = await addHisaabEntryAction(hisaabData);
            if (newEntry) {
                successCount++;
            } else {
                toast({ title: "Hisaab Seeding Error", description: `Failed to add transaction for: ${hisaabData.entityName}`, variant: "destructive" });
                errorCount++;
            }
        } catch (e) {
            toast({ title: "Hisaab Seeding Exception", description: `Error adding transaction for ${hisaabData.entityName}: ${(e as Error).message}`, variant: "destructive" });
            errorCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    toast({ title: "Hisaab Seeding Complete", description: `Finished. Success: ${successCount}, Errors: ${errorCount}.`, variant: errorCount > 0 ? "destructive" : "default"});
    setIsSeedingHisaab(false);
  };


  if (!appReady || (isSettingsLoading && !form.formState.isDirty) ) { 
    return (
      <div className="container mx-auto p-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 space-y-8">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Shop &amp; Security Settings</CardTitle>
              <CardDescription>Manage global settings for your shop, including metal rates, invoice numbering, and device access.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Firebase Project ID</AlertTitle>
                <AlertDescription>
                  This app is currently connected to the Firebase project: <strong className="font-mono">{currentSettings.firebaseConfig?.projectId || 'Not available'}</strong>. If this is incorrect, please check your `.env.local` file and restart the server.
                </AlertDescription>
              </Alert>
              <FormField
                  control={form.control}
                  name="theme"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-base flex items-center"><Palette className="h-5 w-5 mr-2 text-muted-foreground" /> Color Theme</FormLabel>
                       <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a color theme" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {AVAILABLE_THEMES.map(theme => (
                            <SelectItem key={theme.key} value={theme.key}>
                              <div className="flex items-center gap-2">
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: `hsl(${theme.primaryColorHsl})` }} />
                                {theme.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Choose the color palette for the application interface.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
              />
              <FormField
                control={form.control}
                name="goldRatePerGram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center">
                        <DollarSign className="h-5 w-5 mr-2 text-muted-foreground" /> Current Gold Rate (PKR per gram for 21k)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="e.g., 17500.00" {...field} />
                    </FormControl>
                    <FormDescription>
                        This rate is for 21 Karat gold. All product prices are calculated based on this rate.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="palladiumRatePerGram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center">
                        <Shield className="h-5 w-5 mr-2 text-muted-foreground" /> Current Palladium Rate (PKR per gram)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="e.g., 22000.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="platinumRatePerGram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center">
                        <Shield className="h-5 w-5 mr-2 text-muted-foreground" /> Current Platinum Rate (PKR per gram)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="e.g., 25000.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="silverRatePerGram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center">
                        <Shield className="h-5 w-5 mr-2 text-muted-foreground" /> Current Silver Rate (PKR per gram)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="e.g., 250.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="shopName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Shop Name</FormLabel>
                    <div className="flex items-center">
                       <Building className="h-5 w-5 mr-2 text-muted-foreground" />
                       <FormControl>
                         <Input placeholder="Your Boutique Name" {...field} />
                       </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="shopAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Shop Address</FormLabel>
                     <div className="flex items-start">
                       <MapPin className="h-5 w-5 mr-2 mt-2 text-muted-foreground" />
                        <FormControl>
                          <Textarea placeholder="123 Jewel Street, Sparkle City, SC 12345" {...field} rows={3}/>
                        </FormControl>
                     </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="shopContact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Shop Contact Info</FormLabel>
                     <div className="flex items-center">
                       <Phone className="h-5 w-5 mr-2 text-muted-foreground" />
                        <FormControl>
                          <Input placeholder="contact@taheri.com | (021) 123-4567" {...field} />
                        </FormControl>
                     </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormItem>
                  <FormLabel className="text-base flex items-center"><ImageIcon className="mr-2 h-5 w-5" /> Main Shop Logo (for UI)</FormLabel>
                  <div className="flex items-center gap-4">
                    <FormControl>
                       <Button asChild variant="outline" className="relative">
                          <div>
                            <Upload className="mr-2 h-4 w-4" />
                            Upload Logo
                            <Input
                              type="file"
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              accept="image/png, image/jpeg, image/svg+xml, image/webp"
                              onChange={(e) => handleLogoUpload(e, false)}
                            />
                          </div>
                        </Button>
                    </FormControl>
                     {logoPreview && (
                        <div className="p-2 border rounded-md w-fit bg-muted">
                            <Image src={logoPreview} alt="Shop Logo Preview" width={150} height={40} className="object-contain" data-ai-hint="logo store" />
                        </div>
                     )}
                  </div>
                   <FormDescription>
                     Upload your main logo. Recommended max size: 200KB.
                   </FormDescription>
                  <FormMessage />
                </FormItem>
                <FormItem>
                  <FormLabel className="text-base flex items-center"><ImageIcon className="mr-2 h-5 w-5" /> Invoice Logo (Black)</FormLabel>
                  <div className="flex items-center gap-4">
                    <FormControl>
                       <Button asChild variant="outline" className="relative">
                          <div>
                            <Upload className="mr-2 h-4 w-4" />
                            Upload Black Logo
                            <Input
                              type="file"
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                              accept="image/png, image/jpeg, image/svg+xml, image/webp"
                              onChange={(e) => handleLogoUpload(e, true)}
                            />
                          </div>
                        </Button>
                    </FormControl>
                     {logoPreviewBlack && (
                        <div className="p-2 border rounded-md w-fit bg-slate-800">
                            <Image src={logoPreviewBlack} alt="Shop Logo Preview (Black)" width={150} height={40} className="object-contain" data-ai-hint="logo store" />
                        </div>
                     )}
                  </div>
                   <FormDescription>
                     Upload a monochrome black logo for PDF invoices.
                   </FormDescription>
                  <FormMessage />
                </FormItem>
                </div>
              <FormField
                control={form.control}
                name="lastInvoiceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center">
                        <FileText className="h-5 w-5 mr-2 text-muted-foreground" /> Last Invoice Number (Sequence)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="1" placeholder="e.g., 100" {...field} />
                    </FormControl>
                    <FormDescription>
                        The system will increment this number for the next invoice. Set this if you are migrating or need to adjust the sequence.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
               <FormField
                control={form.control}
                name="lastOrderNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center">
                        <FileText className="h-5 w-5 mr-2 text-muted-foreground" /> Last Order Number (Sequence)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="1" placeholder="e.g., 100" {...field} />
                    </FormControl>
                    <FormDescription>
                        The system will increment this number for the next custom order.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Separator />
               <div>
                  <FormLabel className="text-base flex items-center"><TabletSmartphone className="h-5 w-5 mr-2 text-muted-foreground" /> Authorized Device IDs</FormLabel>
                  <FormDescription className="mb-4">
                    Only devices with an ID on this whitelist will be able to access the app.
                    Add a new device by visiting the app from it and copying the ID it displays.
                  </FormDescription>
                  <div className="space-y-3">
                    {fields.map((field, index) => (
                      <FormField
                        key={field.id}
                        control={form.control}
                        name={`allowedDeviceIds.${index}.id`}
                        render={({ field }) => (
                          <FormItem>
                            <div className="flex items-center gap-2">
                              <FormControl>
                                <Input {...field} placeholder="Enter a unique device ID" />
                              </FormControl>
                              <Button type="button" variant="destructive" size="icon" onClick={() => remove(index)}>
                                <Trash2 className="h-4 w-4" />
                                <span className="sr-only">Remove Device ID</span>
                              </Button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => append({ id: '' })}
                    >
                      <PlusCircle className="mr-2 h-4 w-4" />
                      Add Device ID
                    </Button>
                  </div>
               </div>
            </CardContent>
            <CardFooter>
              <Button type="submit" size="lg" disabled={form.formState.isSubmitting || isSettingsLoading}>
                {form.formState.isSubmitting || (isSettingsLoading && !appReady) ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" /> }
                Save Settings
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Form>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center"><Database className="mr-2 h-5 w-5" /> Development & Data Tools</CardTitle>
          <CardDescription>Use these tools for development, data seeding, or importing from other apps. Be cautious with actions that modify data.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/settings/hisaab-import" passHref>
              <Button variant="outline" className="w-full">
                <Import className="mr-2 h-4 w-4" /> Import Hisaab from CSV
              </Button>
            </Link>
            <div>
                <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={isSeedingProducts}>
                    {isSeedingProducts ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                    Seed Dummy Products ({DUMMY_PRODUCTS_TO_SEED.length})
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" />Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will add {DUMMY_PRODUCTS_TO_SEED.length} pre-defined dummy products to your Firestore database.
                        This is intended for development and testing. Running this multiple times will create duplicate products (with different SKUs).
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSeedProducts} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                        Yes, Seed Products
                    </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
                </AlertDialog>
            </div>
            <div>
                <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={isSeedingCustomers}>
                    {isSeedingCustomers ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                    Seed Dummy Customers ({DUMMY_CUSTOMERS_TO_SEED.length})
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" />Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will add {DUMMY_CUSTOMERS_TO_SEED.length} pre-defined dummy customers to your Firestore database.
                        Running this multiple times will create duplicate customers (with different IDs).
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSeedCustomers} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                        Yes, Seed Customers
                    </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
                </AlertDialog>
            </div>
             <div>
                <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={isSeedingKarigars}>
                    {isSeedingKarigars ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Briefcase className="mr-2 h-4 w-4" />}
                    Seed Dummy Karigars ({DUMMY_KARIGARS_TO_SEED.length})
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" />Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will add {DUMMY_KARIGARS_TO_SEED.length} pre-defined dummy karigars to your Firestore database.
                        Running this multiple times will create duplicate karigars (with different IDs).
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSeedKarigars} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                        Yes, Seed Karigars
                    </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
                </AlertDialog>
            </div>
            <div>
                <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={isSeedingOrders}>
                    {isSeedingOrders ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardList className="mr-2 h-4 w-4" />}
                    Seed Dummy Orders ({DUMMY_ORDERS_TO_SEED.length})
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" />Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will add {DUMMY_ORDERS_TO_SEED.length} pre-defined dummy orders to your Firestore database.
                        Running this multiple times will create duplicate orders (with different IDs).
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSeedOrders} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                        Yes, Seed Orders
                    </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
                </AlertDialog>
            </div>
             <div>
                <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={isSeedingHisaab}>
                    {isSeedingHisaab ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookUser className="mr-2 h-4 w-4" />}
                    Seed Dummy Hisaab ({DUMMY_HISAAB_ENTRIES_TO_SEED.length})
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center"><AlertTriangle className="mr-2 h-5 w-5 text-destructive" />Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                        This will add {DUMMY_HISAAB_ENTRIES_TO_SEED.length} pre-defined dummy transactions to your Hisaab ledger.
                        This is intended for development and testing. **It assumes you have already seeded customers and karigars**, as it uses their IDs.
                    </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleSeedHisaab} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                        Yes, Seed Hisaab
                    </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
                </AlertDialog>
            </div>
        </CardContent>
      </Card>
      
      <Card className="border-destructive">
        <CardHeader>
            <CardTitle className="text-xl text-destructive flex items-center"><AlertTriangle className="mr-2 h-5 w-5" /> Danger Zone</CardTitle>
            <CardDescription>
                These actions are irreversible. Once data is deleted, it cannot be recovered. Be absolutely certain before proceeding.
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
             <div className="flex flex-wrap gap-4 items-center p-4 border border-destructive/20 rounded-lg bg-destructive/5">
                <DataDeletionButton
                    action={clearAllProducts}
                    buttonText="Clear Products"
                    description="This will permanently delete all product data from the 'products' and 'sold_products' collections. This action cannot be undone."
                >
                    <Trash className="mr-2 h-4 w-4" />
                </DataDeletionButton>
                 <DataDeletionButton
                    action={clearAllCustomers}
                    buttonText="Clear Customers"
                    description="This will permanently delete all customer data from the database. This action cannot be undone."
                >
                    <Trash className="mr-2 h-4 w-4" />
                </DataDeletionButton>
                <DataDeletionButton
                    action={clearAllKarigars}
                    buttonText="Clear Karigars"
                    description="This will permanently delete all karigar data from the database. This action cannot be undone."
                >
                    <Trash className="mr-2 h-4 w-4" />
                </DataDeletionButton>
                <DataDeletionButton
                    action={clearAllInvoices}
                    buttonText="Clear Invoices"
                    description="This will permanently delete all invoice data from the database. This action cannot be undone."
                >
                    <Trash className="mr-2 h-4 w-4" />
                </DataDeletionButton>
                 <DataDeletionButton
                    action={clearAllOrders}
                    buttonText="Clear Orders"
                    description="This will permanently delete all order data from the database. This action cannot be undone."
                >
                    <Trash className="mr-2 h-4 w-4" />
                </DataDeletionButton>
             </div>
             <Separator />
             <div className="flex items-center justify-between p-4 border border-destructive rounded-lg">
                <div>
                    <h4 className="font-semibold text-destructive">Delete All Application Data</h4>
                    <p className="text-sm text-destructive/80">This will wipe all products, customers, karigars, invoices, and orders.</p>
                </div>
                <DataDeletionButton
                    action={clearAllData}
                    buttonText="Clear All Data"
                    description="This is the final warning. You are about to permanently delete ALL transactional data (products, customers, karigars, invoices, orders) from the database. This action cannot be undone."
                >
                    <Trash className="mr-2 h-4 w-4" />
                </DataDeletionButton>
             </div>
        </CardContent>
      </Card>
    </div>
  );
}
