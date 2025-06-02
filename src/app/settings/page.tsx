
"use client";

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppStore, Settings, useAppReady, Product, GOLD_COIN_CATEGORY_ID } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Save, Building, Phone, Mail, Image as ImageIcon, MapPin, DollarSign, Shield, FileText, Loader2, Database, AlertTriangle } from 'lucide-react';
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
import type { KaratValue, MetalType } from '@/lib/store';

const settingsSchema = z.object({
  goldRatePerGram: z.coerce.number().min(0, "Gold rate must be a positive number"),
  palladiumRatePerGram: z.coerce.number().min(0, "Palladium rate must be a positive number"),
  platinumRatePerGram: z.coerce.number().min(0, "Platinum rate must be a positive number"),
  shopName: z.string().min(1, "Shop name is required"),
  shopAddress: z.string().optional(),
  shopContact: z.string().optional(),
  shopLogoUrl: z.string().url("Must be a valid URL for logo").optional().or(z.literal('')),
  lastInvoiceNumber: z.coerce.number().int().min(0, "Last invoice number must be a non-negative integer"),
});

type SettingsFormData = z.infer<typeof settingsSchema>;
type ProductDataForAdd = Omit<Product, 'sku' | 'name' | 'qrCodeDataUrl'>;


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


export default function SettingsPage() {
  const { toast } = useToast();
  const appReady = useAppReady();
  const currentSettings = useAppStore(state => state.settings);
  const updateSettingsAction = useAppStore(state => state.updateSettings);
  const addProductAction = useAppStore(state => state.addProduct);
  const isSettingsLoading = useAppStore(state => state.isSettingsLoading);

  const [isSeeding, setIsSeeding] = useState(false);

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
  });

  React.useEffect(() => {
    if (appReady && currentSettings) { 
      form.reset(currentSettings);
    }
  }, [currentSettings, form, appReady]);


  const onSubmit = async (data: SettingsFormData) => {
    try {
        await updateSettingsAction(data);
        toast({ title: "Settings Updated", description: "Your shop settings have been saved." });
    } catch (error) {
        toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" });
    }
  };

  const handleSeedProducts = async () => {
    setIsSeeding(true);
    let successCount = 0;
    let errorCount = 0;

    toast({
      title: "Seeding Started",
      description: `Attempting to add ${DUMMY_PRODUCTS_TO_SEED.length} dummy products...`,
    });

    for (const productData of DUMMY_PRODUCTS_TO_SEED) {
      try {
        // Ensure imageUrl has a data-ai-hint if it's a placeholder
        let finalProductData = {...productData};
        if (productData.imageUrl && productData.imageUrl.startsWith('https://placehold.co')) {
            const placeholderImage = new Image();
            placeholderImage.src = productData.imageUrl;
            // Basic hint based on category or metal type if possible, or generic jewelry
            let hint = "jewelry piece";
            if (productData.categoryId.includes("ring")) hint = "gold ring";
            else if (productData.categoryId.includes("coin")) hint = "gold coin";
            else if (productData.categoryId.includes("necklace") || productData.categoryId.includes("locket")) hint = "gold necklace";
            else if (productData.categoryId.includes("bangle")) hint = "gold bangle";
            else if (productData.categoryId.includes("chain")) hint = "gold chain";
            // Add data-ai-hint attribute logic if needed here, though it's primarily for display components
            // For seeding, the URL is what's stored. The hint is applied when <Image> is used.
        }


        const newProduct = await addProductAction(finalProductData);
        if (newProduct) {
          toast({
            title: "Product Added",
            description: `Successfully added: ${newProduct.name} (SKU: ${newProduct.sku})`,
          });
          successCount++;
        } else {
          toast({
            title: "Seeding Error",
            description: `Failed to add product (Category ID: ${productData.categoryId}, Weight: ${productData.metalWeightG}g). Category might be missing or invalid.`,
            variant: "destructive",
          });
          errorCount++;
        }
      } catch (error) {
        console.error("Error seeding product:", error);
        toast({
          title: "Seeding Exception",
          description: `An error occurred while adding a product: ${ (error as Error).message || 'Unknown error' }`,
          variant: "destructive",
        });
        errorCount++;
      }
      // Small delay to allow toasts to be seen and avoid overwhelming Firestore writes if many products
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    toast({
      title: "Seeding Complete",
      description: `Finished adding dummy products. Success: ${successCount}, Errors: ${errorCount}.`,
      variant: errorCount > 0 ? "destructive" : "default",
    });
    setIsSeeding(false);
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
              <CardTitle className="text-2xl">Shop Settings</CardTitle>
              <CardDescription>Manage your shop's global settings, including metal rates and invoice numbering.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="goldRatePerGram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base flex items-center">
                        <DollarSign className="h-5 w-5 mr-2 text-muted-foreground" /> Current Gold Rate (PKR per gram for 24k)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" placeholder="e.g., 20000.00" {...field} className="text-lg"/>
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
                      <Input type="number" step="0.01" placeholder="e.g., 22000.00" {...field} className="text-lg"/>
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
                      <Input type="number" step="0.01" placeholder="e.g., 25000.00" {...field} className="text-lg"/>
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
              <FormField
                control={form.control}
                name="shopLogoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-base">Shop Logo URL</FormLabel>
                     <div className="flex items-center">
                       <ImageIcon className="h-5 w-5 mr-2 text-muted-foreground" />
                        <FormControl>
                          <Input type="url" placeholder="https://placehold.co/200x80.png?text=Taheri+Logo" {...field} />
                        </FormControl>
                     </div>
                     {field.value && (
                        <div className="mt-2 p-2 border rounded-md w-fit">
                            <img src={field.value} alt="Shop Logo Preview" className="h-16 object-contain" data-ai-hint="logo store" />
                        </div>
                     )}
                    <FormMessage />
                  </FormItem>
                )}
              />
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
        <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={isSeeding}>
                  {isSeeding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
                  Seed Dummy Products
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
            <p className="text-sm text-muted-foreground mt-2">
              Adds sample products for testing (Rings, Bands, Gold Coins, etc.).
            </p>
        </CardContent>
      </Card>

    </div>
  );
}

    
