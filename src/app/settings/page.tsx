

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
import { Save, Building, Phone, Mail, Image as ImageIcon, MapPin, DollarSign, Shield, FileText, Loader2, Database, AlertTriangle, Users, Briefcase, Upload, Trash2, PlusCircle, TabletSmartphone, Palette, ClipboardList, Trash, Info, BookUser, Import, Copy, ArchiveRestore, Search, ExternalLink, ShieldCheck, ShieldAlert, Landmark } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import Image from 'next/image';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Progress } from '@/components/ui/progress';

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
  databaseLocked: z.boolean().optional(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

const EmergencyLock: React.FC = () => {
    const { settings, updateSettings } = useAppStore();
    const { toast } = useToast();
    const [isLocking, setIsLocking] = useState(false);

    const handleLockDatabase = async () => {
        setIsLocking(true);
        try {
            await updateSettings({ databaseLocked: true });
            toast({
                title: "Database Locked",
                description: "Access has been severed. Reload the app to apply changes.",
                variant: "destructive",
                duration: 10000,
            });
            // Intentionally do not set isLocking to false, as this is a one-way action.
        } catch (error) {
            toast({ title: "Error", description: "Failed to lock the database.", variant: "destructive" });
            setIsLocking(false);
        }
    };

    if (settings.databaseLocked) {
        return (
             <Card className="border-green-500 bg-green-500/10">
                <CardHeader>
                    <CardTitle className="text-xl flex items-center text-green-600">
                        <ShieldCheck className="mr-2 h-5 w-5" /> Database Secured
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-green-700 dark:text-green-300">
                        The connection to the database is currently locked. No data can be read or written. To restore access, you must request a reset from the developer.
                    </p>
                </CardContent>
            </Card>
        );
    }
    
    return (
        <Card className="border-destructive bg-destructive/10">
            <CardHeader>
                <CardTitle className="text-xl flex items-center text-destructive">
                    <ShieldAlert className="mr-2 h-5 w-5" /> Emergency Lock
                </CardTitle>
                <CardDescription className="text-destructive/80">
                    This will immediately sever the application's connection to the database.
                </CardDescription>
            </CardHeader>
            <CardContent>
                 <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>WARNING: IRREVERSIBLE ACTION</AlertTitle>
                    <AlertDescription>
                        Activating this lock will make the app unusable until a developer manually restores access. This is a final security measure for emergencies.
                    </AlertDescription>
                </Alert>
            </CardContent>
            <CardFooter>
                 <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="lg" className="w-full" disabled={isLocking}>
                            {isLocking ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ShieldAlert className="mr-2 h-5 w-5" />}
                            Lock Database Now
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                You are about to lock this application from accessing its database. This action is <strong className="text-destructive">NOT REVERSIBLE</strong> through the user interface.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleLockDatabase} className="bg-destructive hover:bg-destructive/90">
                                Yes, Lock It Down
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CardFooter>
        </Card>
    );
};


export default function SettingsPage() {
  const { toast } = useToast();
  const appReady = useAppReady();
  const currentSettings = useAppStore(state => state.settings);
  const updateSettingsAction = useAppStore(state => state.updateSettings);
  const isSettingsLoading = useAppStore(state => state.isSettingsLoading);
  
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number | null }>({});
  const [isUploading, setIsUploading] = useState<{ [key: string]: boolean }>({});


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
      databaseLocked: false,
    },
  });

  const { fields: deviceIdFields, append: appendDeviceId, remove: removeDeviceId } = useFieldArray({
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
        databaseLocked: currentSettings.databaseLocked || false,
      });
    }
  }, [currentSettings, form, appReady]);


 const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>, fieldName: 'shopLogoUrl' | 'shopLogoUrlBlack') => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) { // 2MB limit
      toast({ title: "Image too large", description: "Please upload an image smaller than 2MB.", variant: "destructive" });
      return;
    }
    
    const storage = getStorage();
    const storageRef = ref(storage, `app_assets/${Date.now()}-${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file);

    setIsUploading(prev => ({...prev, [fieldName]: true}));
    setUploadProgress(prev => ({...prev, [fieldName]: 0}));

    uploadTask.on('state_changed',
        (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            setUploadProgress(prev => ({...prev, [fieldName]: progress}));
        },
        (error) => {
            console.error("Upload error:", error);
            toast({ title: "Upload Failed", description: "There was an error uploading the image.", variant: "destructive" });
            setIsUploading(prev => ({...prev, [fieldName]: false}));
            setUploadProgress(prev => ({...prev, [fieldName]: null}));
        },
        () => {
            getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
                form.setValue(fieldName, downloadURL, { shouldValidate: true, shouldDirty: true });
                setIsUploading(prev => ({...prev, [fieldName]: false}));
                setUploadProgress(prev => ({...prev, [fieldName]: 100}));
                toast({ title: "Upload Complete", description: "Image has been successfully uploaded." });
            });
        }
    );
  };


  const onSubmit = async (data: SettingsFormData) => {
    try {
        const settingsToSave: Partial<Settings> = {
            ...data,
            allowedDeviceIds: data.allowedDeviceIds?.map(item => item.id).filter(Boolean) || [],
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

  const mainLogoUrl = form.watch('shopLogoUrl');
  const blackLogoUrl = form.watch('shopLogoUrlBlack');


  return (
    <div className="container mx-auto p-4 space-y-8">
      <EmergencyLock />
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
                  <FormLabel className="text-base flex items-center"><ImageIcon className="mr-2 h-5 w-5" /> Main Shop Logo (PNG/JPG)</FormLabel>
                  <div className="space-y-2">
                    <Button asChild variant="outline" className="relative">
                      <div>
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Image
                        <Input
                          type="file"
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          accept="image/png, image/jpeg"
                          onChange={(e) => handleImageUpload(e, 'shopLogoUrl')}
                          disabled={isUploading['shopLogoUrl']}
                        />
                      </div>
                    </Button>
                    {isUploading['shopLogoUrl'] && uploadProgress['shopLogoUrl'] !== null && (
                        <Progress value={uploadProgress['shopLogoUrl']} className="w-full h-2" />
                    )}
                    {mainLogoUrl && (
                      <div className="p-2 border rounded-md w-fit bg-muted">
                        <Image src={mainLogoUrl} alt="Main Logo Preview" width={150} height={40} className="object-contain max-h-12" unoptimized />
                      </div>
                    )}
                  </div>
                  <FormDescription>Upload your main logo. Recommended wide aspect ratio.</FormDescription>
                </FormItem>
                 <FormItem>
                  <FormLabel className="text-base flex items-center"><ImageIcon className="mr-2 h-5 w-5" /> Invoice Logo (Black, PNG/JPG)</FormLabel>
                  <div className="space-y-2">
                    <Button asChild variant="outline" className="relative">
                      <div>
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Image
                        <Input
                          type="file"
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          accept="image/png, image/jpeg"
                          onChange={(e) => handleImageUpload(e, 'shopLogoUrlBlack')}
                          disabled={isUploading['shopLogoUrlBlack']}
                        />
                      </div>
                    </Button>
                    {isUploading['shopLogoUrlBlack'] && uploadProgress['shopLogoUrlBlack'] !== null && (
                        <Progress value={uploadProgress['shopLogoUrlBlack']} className="w-full h-2" />
                    )}
                    {blackLogoUrl && (
                      <div className="p-2 border rounded-md w-fit bg-slate-800">
                        <Image src={blackLogoUrl} alt="Invoice Logo Preview" width={150} height={40} className="object-contain max-h-12" unoptimized/>
                      </div>
                    )}
                  </div>
                  <FormDescription>Upload a monochrome black version for PDF invoices.</FormDescription>
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
                    {deviceIdFields.map((field, index) => (
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
                              <Button type="button" variant="destructive" size="icon" onClick={() => removeDeviceId(index)}>
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
                      onClick={() => appendDeviceId({ id: '' })}
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
          <CardTitle className="text-xl flex items-center"><Database className="mr-2 h-5 w-5" /> Data & API Management</CardTitle>
          <CardDescription>Tools for managing your data and integrations.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/settings/contact-import" passHref>
              <Button variant="outline" className="w-full justify-start text-left h-auto py-3">
                 <div className="flex items-center">
                    <Users className="mr-3 h-5 w-5" />
                    <div>
                      <p className="font-semibold">Import Customers</p>
                      <p className="text-xs text-muted-foreground">Bulk import customers from a CSV file.</p>
                  </div>
                </div>
              </Button>
            </Link>
            <Link href="/settings/hisaab-import" passHref>
              <Button variant="outline" className="w-full justify-start text-left h-auto py-3">
                <div className="flex items-center">
                  <Import className="mr-3 h-5 w-5" />
                  <div>
                      <p className="font-semibold">Import Hisaab from CSV</p>
                      <p className="text-xs text-muted-foreground">Import historical ledgers from other apps.</p>
                  </div>
                </div>
              </Button>
            </Link>
             <Link href="/settings/weprint-api" passHref>
              <Button variant="outline" className="w-full justify-start text-left h-auto py-3">
                 <div className="flex items-center">
                    <ExternalLink className="mr-3 h-5 w-5" />
                    <div>
                      <p className="font-semibold">WEPrint API Management</p>
                      <p className="text-xs text-muted-foreground">Curate which products are visible to the API.</p>
                  </div>
                </div>
              </Button>
            </Link>
        </CardContent>
      </Card>
    </div>
  );
}
