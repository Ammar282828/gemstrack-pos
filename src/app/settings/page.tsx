
"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppStore, Settings, ThemeKey, AVAILABLE_THEMES, Product } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Save, Building, Phone, Mail, Image as ImageIcon, MapPin, DollarSign, Shield, FileText, Loader2, Database, AlertTriangle, Users, Briefcase, Upload, Trash2, PlusCircle, TabletSmartphone, Palette, ClipboardList, Trash, Info, BookUser, Import, Copy, ArchiveRestore, Search } from 'lucide-react';
import Image from 'next/image';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

const DEVICE_ID_KEY = 'gemstrack-device-id';

function getDeviceId() {
  if (typeof window === 'undefined') {
    return null;
  }
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = `device-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

const themeKeys = AVAILABLE_THEMES.map(t => t.key) as [ThemeKey, ...ThemeKey[]];

const settingsSchema = z.object({
  goldRatePerGram24k: z.coerce.number().min(0, "Rate must be a positive number"),
  goldRatePerGram22k: z.coerce.number().min(0, "Rate must be a positive number"),
  goldRatePerGram21k: z.coerce.number().min(0, "Rate must be a positive number"),
  goldRatePerGram18k: z.coerce.number().min(0, "Rate must be a positive number"),
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

const DangerZone: React.FC = () => {
    const { deleteLatestProducts } = useAppStore();
    const { toast } = useToast();
    const [deleteCount, setDeleteCount] = useState<number>(1);
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        if (deleteCount <= 0) {
            toast({ title: "Invalid Number", description: "Please enter a positive number of products to delete.", variant: "destructive" });
            return;
        }
        setIsDeleting(true);
        try {
            const deletedCount = await deleteLatestProducts(deleteCount);
            toast({ title: "Success", description: `${deletedCount} latest products have been deleted.` });
        } catch (e: any) {
            toast({ title: "Error", description: `Failed to delete products: ${e.message}`, variant: "destructive" });
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <Card className="border-destructive">
            <CardHeader>
                <CardTitle className="text-xl flex items-center text-destructive">
                    <AlertTriangle className="mr-2 h-5 w-5" /> Danger Zone
                </CardTitle>
                <CardDescription>
                    These are destructive actions. Use them with extreme caution as they cannot be undone.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div>
                    <Label htmlFor="delete-count">Delete Latest Products</Label>
                    <div className="flex items-center gap-2 mt-1">
                        <Input
                            id="delete-count"
                            type="number"
                            value={deleteCount}
                            onChange={(e) => setDeleteCount(parseInt(e.target.value, 10) || 1)}
                            min="1"
                            className="w-32"
                        />
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="destructive" disabled={isDeleting}>
                                    {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash className="mr-2 h-4 w-4" />}
                                    Delete {deleteCount} Product(s)
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This action cannot be undone. This will permanently delete the <strong>{deleteCount}</strong> most recently added products from your inventory.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                                        Yes, delete them
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                     <p className="text-xs text-muted-foreground mt-2">
                        This will remove the specified number of products based on the highest SKU numbers.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
};

const SoldProductRecovery: React.FC = () => {
    const { soldProducts, isSoldProductsLoading, loadSoldProducts, reAddSoldProductToInventory } = useAppStore();
    const { toast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [recoveringSku, setRecoveringSku] = useState<string | null>(null);

    useEffect(() => {
        loadSoldProducts();
    }, [loadSoldProducts]);

    const filteredSoldProducts = useMemo(() => {
        if (!searchTerm) return [];
        return soldProducts.filter(p => {
          if (!p) return false;
          const lowerCaseSearch = searchTerm.toLowerCase();
          const matchesSku = p.sku?.toLowerCase().includes(lowerCaseSearch);
          const matchesName = p.name && p.name.toLowerCase().includes(lowerCaseSearch);
          return matchesSku || matchesName;
        }).slice(0, 50); // Limit results for performance
    }, [soldProducts, searchTerm]);

    const handleReAdd = async (sku: string) => {
        setRecoveringSku(sku);
        try {
            await reAddSoldProductToInventory(sku);
            toast({
                title: 'Product Restored',
                description: `Product ${sku} has been moved back to active inventory.`,
            });
        } catch (error: any) {
            toast({
                title: 'Error',
                description: `Failed to restore product: ${error.message}`,
                variant: 'destructive',
            });
        } finally {
            setRecoveringSku(null);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-xl flex items-center">
                    <ArchiveRestore className="mr-2 h-5 w-5" /> Data Recovery
                </CardTitle>
                <CardDescription>
                    Search for a sold product by SKU or name to re-add it to your active inventory.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search SKU or Name..."
                        className="pl-9"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                {isSoldProductsLoading && searchTerm && (
                    <div className="flex items-center justify-center p-4">
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                )}
                {filteredSoldProducts.length > 0 && (
                    <ScrollArea className="h-64 border rounded-md">
                        <div className="p-2 space-y-1">
                            {filteredSoldProducts.map(p => (
                                <div key={p.sku} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                                    <div>
                                        <p className="font-semibold">{p.name}</p>
                                        <p className="text-sm text-muted-foreground">{p.sku}</p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleReAdd(p.sku)}
                                        disabled={recoveringSku === p.sku}
                                    >
                                        {recoveringSku === p.sku ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <PlusCircle className="mr-2 h-4 w-4" />
                                        )}
                                        Re-Add to Inventory
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}
                {searchTerm && !isSoldProductsLoading && filteredSoldProducts.length === 0 && (
                    <p className="text-center text-sm text-muted-foreground p-4">No sold products found matching your search.</p>
                )}
            </CardContent>
        </Card>
    );
};


export default function SettingsPage() {
  const { toast } = useToast();
  const appReady = useAppReady();
  const currentSettings = useAppStore(state => state.settings);
  const updateSettingsAction = useAppStore(state => state.updateSettings);
  const isSettingsLoading = useAppStore(state => state.isSettingsLoading);

  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoPreviewBlack, setLogoPreviewBlack] = useState<string | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);

  useEffect(() => {
    setCurrentDeviceId(getDeviceId());
  }, []);

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      goldRatePerGram18k: 0,
      goldRatePerGram21k: 0,
      goldRatePerGram22k: 0,
      goldRatePerGram24k: 0,
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
      
      form.reset({
        goldRatePerGram18k: currentSettings.goldRatePerGram18k || 0,
        goldRatePerGram21k: currentSettings.goldRatePerGram21k || 0,
        goldRatePerGram22k: currentSettings.goldRatePerGram22k || 0,
        goldRatePerGram24k: currentSettings.goldRatePerGram24k || 0,
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

  const handleCopyToClipboard = () => {
    if (currentDeviceId) {
      navigator.clipboard.writeText(currentDeviceId);
      toast({
        title: "Copied to Clipboard",
        description: "Your current device ID has been copied.",
      });
    }
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
              <div className="space-y-2">
                <Label className="text-base flex items-center"><DollarSign className="h-5 w-5 mr-2 text-muted-foreground" /> Current Gold Rates (PKR per gram)</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border rounded-lg">
                     <FormField control={form.control} name="goldRatePerGram24k" render={({ field }) => (<FormItem><FormLabel className="text-sm">24k</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                     <FormField control={form.control} name="goldRatePerGram22k" render={({ field }) => (<FormItem><FormLabel className="text-sm">22k</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                     <FormField control={form.control} name="goldRatePerGram21k" render={({ field }) => (<FormItem><FormLabel className="text-sm">21k</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                     <FormField control={form.control} name="goldRatePerGram18k" render={({ field }) => (<FormItem><FormLabel className="text-sm">18k</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>)}/>
                </div>
              </div>
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
                  </FormDescription>
                  
                  {currentDeviceId && (
                    <div className="p-4 rounded-md bg-muted border mb-4">
                        <Label>Your Current Device ID</Label>
                        <div className="flex items-center space-x-2 mt-1">
                            <Input value={currentDeviceId} readOnly className="font-mono bg-background" />
                            <Button type="button" variant="outline" size="icon" onClick={handleCopyToClipboard}>
                                <Copy className="h-4 w-4" />
                                <span className="sr-only">Copy Device ID</span>
                            </Button>
                        </div>
                    </div>
                  )}

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
      
       <SoldProductRecovery />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center"><Database className="mr-2 h-5 w-5" /> Data Import</CardTitle>
          <CardDescription>Use these tools for importing data from other apps.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/settings/hisaab-import" passHref>
              <Button variant="outline" className="w-full">
                <Import className="mr-2 h-4 w-4" /> Import Hisaab from CSV
              </Button>
            </Link>
        </CardContent>
      </Card>
       <DangerZone />
    </div>
  );
}
