
"use client";

import React, { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppStore, Settings, useAppReady, Product, Customer, Karigar, GOLD_COIN_CATEGORY_ID, MetalType, KaratValue, AVAILABLE_THEMES, ThemeKey } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Save, Building, Phone, Mail, Image as ImageIcon, MapPin, DollarSign, Shield, FileText, Loader2, Database, AlertTriangle, Users, Briefcase, Upload, Trash2, PlusCircle, TabletSmartphone, Palette } from 'lucide-react';
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

const themeKeys = AVAILABLE_THEMES.map(t => t.key) as [ThemeKey, ...ThemeKey[]];

const settingsSchema = z.object({
  goldRatePerGram: z.coerce.number().min(0, "Gold rate must be a positive number"),
  palladiumRatePerGram: z.coerce.number().min(0, "Palladium rate must be a positive number"),
  platinumRatePerGram: z.coerce.number().min(0, "Platinum rate must be a positive number"),
  shopName: z.string().min(1, "Shop name is required"),
  shopAddress: z.string().optional(),
  shopContact: z.string().optional(),
  shopLogoUrl: z.string().optional(),
  lastInvoiceNumber: z.coerce.number().int().min(0, "Last invoice number must be a non-negative integer"),
  lastOrderNumber: z.coerce.number().int().min(0, "Last order number must be a non-negative integer"),
  allowedDeviceIds: z.array(z.object({ id: z.string().min(1, "Device ID cannot be empty.") })).optional(),
  theme: z.enum(themeKeys).default('default'),
});

type SettingsFormData = z.infer<typeof settingsSchema>;
type ProductDataForAdd = Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>;
type CustomerDataForAdd = Omit<Customer, 'id'>;
type KarigarDataForAdd = Omit<Karigar, 'id'>;


const DUMMY_PRODUCTS_TO_SEED: ProductDataForAdd[] = [
  {
    categoryId: 'cat001', // Rings
    metalType: 'gold' as MetalType,
    karat: '22k' as KaratValue,
    metalWeightG: 5.5,
    wastagePercentage: 12,
    makingCharges: 8000,
    hasDiamonds: true,
    diamondCharges: 25000,
    stoneCharges: 0,
    miscCharges: 500,
    imageUrl: 'https://placehold.co/400x400.png?text=Gold+Ring',
  },
  {
    categoryId: 'cat009', // Bands
    metalType: 'platinum' as MetalType,
    metalWeightG: 7.0,
    wastagePercentage: 8,
    makingCharges: 6000,
    hasDiamonds: false,
    diamondCharges: 0,
    stoneCharges: 500,
    miscCharges: 200,
    imageUrl: 'https://placehold.co/400x400.png?text=Platinum+Band',
  },
  { 
    categoryId: GOLD_COIN_CATEGORY_ID, // Gold Coins
    metalType: 'gold' as MetalType,
    karat: '24k' as KaratValue,
    metalWeightG: 10, // 10 gram 24k coin
    wastagePercentage: 0, 
    makingCharges: 0,    
    hasDiamonds: false,  
    diamondCharges: 0,   
    stoneCharges: 0,     
    miscCharges: 0,      
    imageUrl: 'https://placehold.co/400x400.png?text=Gold+Coin',
  },
  {
    categoryId: 'cat004', // Lockets
    metalType: 'palladium' as MetalType,
    metalWeightG: 12.0,
    wastagePercentage: 10,
    makingCharges: 7500,
    hasDiamonds: false,
    diamondCharges: 0,
    stoneCharges: 1200,
    miscCharges: 300,
    imageUrl: 'https://placehold.co/400x400.png?text=Palladium+Locket',
  },
  {
    categoryId: 'cat007', // Bangles
    metalType: 'gold' as MetalType,
    karat: '21k' as KaratValue,
    metalWeightG: 25.0,
    wastagePercentage: 15,
    makingCharges: 15000,
    hasDiamonds: false,
    diamondCharges: 0,
    stoneCharges: 3000, // e.g. enamel work or small stones
    miscCharges: 1000,
    imageUrl: 'https://placehold.co/400x400.png?text=Gold+Bangle',
  },
  {
    categoryId: 'cat002', // Tops (Earrings)
    metalType: 'gold' as MetalType,
    karat: '18k' as KaratValue,
    metalWeightG: 3.2,
    wastagePercentage: 10,
    makingCharges: 4500,
    hasDiamonds: false, // Assuming small, non-diamond stones
    diamondCharges: 0,
    stoneCharges: 8000, // e.g. for colored gemstones
    miscCharges: 150,
    imageUrl: 'https://placehold.co/400x400.png?text=Gold+Tops',
  },
  {
    categoryId: 'cat008', // Chains
    metalType: 'gold' as MetalType,
    karat: '22k' as KaratValue,
    metalWeightG: 15.0,
    wastagePercentage: 8, // Chains might have lower wastage
    makingCharges: 10000,
    hasDiamonds: false,
    diamondCharges: 0,
    stoneCharges: 0,
    miscCharges: 0,
    imageUrl: 'https://placehold.co/400x400.png?text=Gold+Chain',
  },
  {
    categoryId: 'cat010', // Locket Sets without Bangle
    metalType: 'gold' as MetalType,
    karat: '21k' as KaratValue,
    metalWeightG: 18.5,
    wastagePercentage: 18, // Sets can have higher wastage due to complexity
    makingCharges: 20000,
    hasDiamonds: true,
    diamondCharges: 40000,
    stoneCharges: 5000, // Accent stones
    miscCharges: 800,
    imageUrl: 'https://placehold.co/400x400.png?text=Locket+Set',
  },
];

const DUMMY_CUSTOMERS_TO_SEED: CustomerDataForAdd[] = [
  { name: "Aisha Khan", phone: "0300-1234567", email: "aisha.khan@example.com", address: "12B, Gulshan-e-Iqbal, Karachi" },
  { name: "Bilal Ahmed", phone: "0333-9876543", email: "bilal.ahmed@example.com", address: "House 45, Street 10, F-8/3, Islamabad" },
  { name: "Fatima Ali", email: "fatima.ali@example.com", address: "789, Model Town, Lahore" },
  { name: "Osman Malik", phone: "0321-5550000" },
  { name: "Sana Javed", address: "Apt 3C, Clifton Block 2, Karachi" }
];

const DUMMY_KARIGARS_TO_SEED: KarigarDataForAdd[] = [
  { name: "Ustad Karim Baksh", contact: "0301-7654321", notes: "Specializes in intricate gold work and setting." },
  { name: "Rehmat Ali & Sons", contact: "0345-1122334", notes: "General purpose, good for platinum and bands." },
  { name: "Diamond Cutters Co.", notes: "Only diamond setting and polishing. Very precise." },
  { name: "Haji Murad", contact: "0311-0009988" }
];


export default function SettingsPage() {
  const { toast } = useToast();
  const appReady = useAppReady();
  const currentSettings = useAppStore(state => state.settings);
  const updateSettingsAction = useAppStore(state => state.updateSettings);
  const addProductAction = useAppStore(state => state.addProduct);
  const addCustomerAction = useAppStore(state => state.addCustomer);
  const addKarigarAction = useAppStore(state => state.addKarigar);
  const isSettingsLoading = useAppStore(state => state.isSettingsLoading);

  const [isSeedingProducts, setIsSeedingProducts] = useState(false);
  const [isSeedingCustomers, setIsSeedingCustomers] = useState(false);
  const [isSeedingKarigars, setIsSeedingKarigars] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      goldRatePerGram: 0,
      palladiumRatePerGram: 0,
      platinumRatePerGram: 0,
      shopName: "",
      shopAddress: "",
      shopContact: "",
      shopLogoUrl: "",
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

      form.reset({
        goldRatePerGram: currentSettings.goldRatePerGram,
        palladiumRatePerGram: currentSettings.palladiumRatePerGram,
        platinumRatePerGram: currentSettings.platinumRatePerGram,
        shopName: currentSettings.shopName,
        shopAddress: currentSettings.shopAddress || "",
        shopContact: currentSettings.shopContact || "",
        shopLogoUrl: currentSettings.shopLogoUrl || "",
        lastInvoiceNumber: currentSettings.lastInvoiceNumber,
        lastOrderNumber: currentSettings.lastOrderNumber || 0,
        allowedDeviceIds: deviceIdsForForm,
        theme: currentSettings.theme || 'default',
      });
      if (currentSettings.shopLogoUrl) {
        setLogoPreview(currentSettings.shopLogoUrl);
      }
    }
  }, [currentSettings, form, appReady]);


  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      setLogoPreview(dataUrl);
      form.setValue('shopLogoUrl', dataUrl, { shouldValidate: true, shouldDirty: true });
    };
    reader.readAsDataURL(file);
  };

  const onSubmit = async (data: SettingsFormData) => {
    try {
        const settingsToSave: Partial<Settings> = {
            ...data,
            allowedDeviceIds: data.allowedDeviceIds?.map(item => item.id).filter(Boolean) || []
        };
        await updateSettingsAction(settingsToSave);
        toast({ title: "Settings Updated", description: "Your shop settings have been saved." });
    } catch (error) {
        toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" });
    }
  };

  const handleSeedProducts = async () => {
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
          toast({
            title: "Product Added",
            description: `Successfully added: ${newProduct.name} (SKU: ${newProduct.sku})`,
          });
          successCount++;
        } else {
          toast({
            title: "Product Seeding Error",
            description: `Failed to add product (Category ID: ${productData.categoryId}, Weight: ${productData.metalWeightG}g). Category might be missing or invalid.`,
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
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    toast({
      title: "Product Seeding Complete",
      description: `Finished. Success: ${successCount}, Errors: ${errorCount}.`,
      variant: errorCount > 0 ? "destructive" : "default",
    });
    setIsSeedingProducts(false);
  };

  const handleSeedCustomers = async () => {
    setIsSeedingCustomers(true);
    let successCount = 0;
    let errorCount = 0;
    toast({ title: "Customer Seeding Started", description: `Attempting to add ${DUMMY_CUSTOMERS_TO_SEED.length} dummy customers...`});

    for (const customerData of DUMMY_CUSTOMERS_TO_SEED) {
      try {
        const newCustomer = await addCustomerAction(customerData);
        if (newCustomer) {
          toast({ title: "Customer Added", description: `Added: ${newCustomer.name}` });
          successCount++;
        } else {
          toast({ title: "Customer Seeding Error", description: `Failed to add customer: ${customerData.name}`, variant: "destructive" });
          errorCount++;
        }
      } catch (e) {
        toast({ title: "Customer Seeding Exception", description: `Error adding ${customerData.name}: ${(e as Error).message}`, variant: "destructive" });
        errorCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    toast({ title: "Customer Seeding Complete", description: `Finished. Success: ${successCount}, Errors: ${errorCount}.`, variant: errorCount > 0 ? "destructive" : "default"});
    setIsSeedingCustomers(false);
  };

  const handleSeedKarigars = async () => {
    setIsSeedingKarigars(true);
    let successCount = 0;
    let errorCount = 0;
    toast({ title: "Karigar Seeding Started", description: `Attempting to add ${DUMMY_KARIGARS_TO_SEED.length} dummy karigars...`});

    for (const karigarData of DUMMY_KARIGARS_TO_SEED) {
      try {
        const newKarigar = await addKarigarAction(karigarData);
        if (newKarigar) {
          toast({ title: "Karigar Added", description: `Added: ${newKarigar.name}` });
          successCount++;
        } else {
          toast({ title: "Karigar Seeding Error", description: `Failed to add karigar: ${karigarData.name}`, variant: "destructive" });
          errorCount++;
        }
      } catch (e) {
        toast({ title: "Karigar Seeding Exception", description: `Error adding ${karigarData.name}: ${(e as Error).message}`, variant: "destructive" });
        errorCount++;
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    toast({ title: "Karigar Seeding Complete", description: `Finished. Success: ${successCount}, Errors: ${errorCount}.`, variant: errorCount > 0 ? "destructive" : "default"});
    setIsSeedingKarigars(false);
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
                        <DollarSign className="h-5 w-5 mr-2 text-muted-foreground" /> Current Gold Rate (PKR per gram for 24k)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="e.g., 20000.00" {...field} />
                    </FormControl>
                    <FormDescription>
                        This rate is for 24 Karat gold. Gold product prices are adjusted based on their selected Karat.
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
                <FormItem>
                  <FormLabel className="text-base flex items-center"><ImageIcon className="mr-2 h-5 w-5" /> Shop Logo</FormLabel>
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
                              onChange={handleLogoUpload}
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
                     Upload your shop logo. Recommended max size: 200KB.
                   </FormDescription>
                  <FormMessage />
                </FormItem>
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
          <CardTitle className="text-xl flex items-center"><Database className="mr-2 h-5 w-5" /> Database Tools</CardTitle>
          <CardDescription>Use these tools for development or data management. Be cautious with actions that modify data.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
                <p className="text-sm text-muted-foreground mt-1">
                Adds sample products for testing (Rings, Bands, Gold Coins, etc.).
                </p>
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
                <p className="text-sm text-muted-foreground mt-1">
                Adds sample customer profiles.
                </p>
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
                <p className="text-sm text-muted-foreground mt-1">
                Adds sample karigar (artisan) profiles.
                </p>
            </div>
        </CardContent>
      </Card>

    </div>
  );
}
