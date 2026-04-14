
"use client";

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppStore, Settings, ThemeKey, AVAILABLE_THEMES } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Save, Building, Phone, Mail, Image as ImageIcon, MapPin, DollarSign, Shield, FileText, Loader2, Database, AlertTriangle, Users, Upload, Trash2, Palette, Info, Import, ShieldCheck, ShieldAlert, Monitor, Globe, Clock, RotateCcw, Bell, BellOff, Plus, X, ShoppingBag, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import Image from 'next/image';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Progress } from '@/components/ui/progress';

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


const NOTIF_TOGGLES: { key: keyof Settings; label: string; description: string }[] = [
  { key: 'notifNewOrder',       label: 'New Order',           description: 'Alert when a new order is created' },
  { key: 'notifOrderCompleted', label: 'Order Completed',     description: 'Alert when an order is marked completed' },
  { key: 'notifOrderCancelled', label: 'Order Cancelled',     description: 'Alert when an order is cancelled or refunded' },
  { key: 'notifDailyChecklist', label: 'Daily Checklist',     description: 'Morning summary: active orders, overdue, unreturned items' },
  { key: 'notifEndOfDay',       label: 'End of Day Summary',  description: 'Evening recap of today\'s orders' },
  { key: 'notifWeeklyReport',   label: 'Weekly Report',       description: 'Monday morning business summary' },
  { key: 'notifOrderOverdue',   label: 'Overdue Order Alert', description: 'Orders in Pending/In Progress for 7+ days (daily check)' },
  { key: 'notifGivenItems',     label: 'Given Items Overdue', description: 'Items given out and not returned for 7+ days' },
  { key: 'notifKarigarPayment', label: 'Karigar Payments Due','description': 'Unpaid karigar batches (weekly check)' },
];

function NotificationsCard() {
  const { settings, updateSettings } = useAppStore();
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [newPhone, setNewPhone] = React.useState('');
  const phones = settings.notifPhones || [];

  const handleToggle = async (key: keyof Settings, value: boolean) => {
    await updateSettings({ [key]: value } as Partial<Settings>);
  };

  const handleAddPhone = async () => {
    const cleaned = newPhone.replace(/\D/g, '');
    if (!cleaned) return;
    if (phones.includes(cleaned)) {
      toast({ title: 'Already added', description: `${cleaned} is already in the list.`, variant: 'destructive' });
      return;
    }
    await updateSettings({ notifPhones: [...phones, cleaned] });
    setNewPhone('');
    toast({ title: 'Added', description: `${cleaned} added to recipients.` });
  };

  const handleRemovePhone = async (phone: string) => {
    await updateSettings({ notifPhones: phones.filter(p => p !== phone) });
  };

  const handleTestMessage = async (phone: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, message: '*GemsTrack Test* — notifications are working!' }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: 'Test sent!', description: `Message sent to ${phone}` });
    } catch (e: unknown) {
      toast({ title: 'Send failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl flex items-center gap-2">
          {settings.notifEnabled ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5 text-muted-foreground" />}
          WhatsApp Notifications
        </CardTitle>
        <CardDescription>
          Send shop alerts to a WhatsApp number via the Meta Business API. Requires <code className="text-xs bg-muted px-1 rounded">WHATSAPP_TOKEN</code> and <code className="text-xs bg-muted px-1 rounded">WHATSAPP_PHONE_ID</code> in <code className="text-xs bg-muted px-1 rounded">.env.local</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Master toggle */}
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <p className="font-medium">Enable Notifications</p>
            <p className="text-sm text-muted-foreground">Master switch for all WhatsApp alerts</p>
          </div>
          <Switch
            checked={!!settings.notifEnabled}
            onCheckedChange={v => handleToggle('notifEnabled', v)}
          />
        </div>

        {settings.notifEnabled && (
          <>
            {/* Recipients */}
            <div className="space-y-3">
              <Label>Recipient WhatsApp Numbers</Label>
              <p className="text-xs text-muted-foreground">International format, no + or spaces. E.g. <code className="bg-muted px-1 rounded">923262275554</code></p>

              {/* Existing numbers */}
              {phones.length > 0 && (
                <div className="space-y-2">
                  {phones.map(p => (
                    <div key={p} className="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/30">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm flex-1 font-mono">{p}</span>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => handleTestMessage(p)} disabled={saving}>
                        Test
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" onClick={() => handleRemovePhone(p)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new number */}
              <div className="flex gap-2">
                <Input
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddPhone()}
                  placeholder="923262275554"
                  className="max-w-xs font-mono"
                />
                <Button variant="outline" size="sm" onClick={handleAddPhone} disabled={!newPhone}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>

            <Separator />

            {/* Notification toggles */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Notification Types</p>
              {NOTIF_TOGGLES.map(({ key, label, description }) => (
                <div key={key} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>
                  <Switch
                    checked={!!settings[key]}
                    onCheckedChange={v => handleToggle(key, v as boolean)}
                  />
                </div>
              ))}
            </div>

            <Separator />

            {/* Schedule times */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="checklistTime">Daily Checklist Time</Label>
                <Input
                  id="checklistTime"
                  type="time"
                  defaultValue={settings.notifDailyChecklistTime || '09:00'}
                  onBlur={e => updateSettings({ notifDailyChecklistTime: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="eodTime">End of Day Time</Label>
                <Input
                  id="eodTime"
                  type="time"
                  defaultValue={settings.notifEndOfDayTime || '19:00'}
                  onBlur={e => updateSettings({ notifEndOfDayTime: e.target.value })}
                />
              </div>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Scheduler</AlertTitle>
              <AlertDescription>
                Scheduled notifications (daily checklist, weekly report, etc.) require the scheduler script to be running:
                <code className="block mt-1 bg-muted px-2 py-1 rounded text-xs">node notifications-scheduler.js</code>
              </AlertDescription>
            </Alert>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const REQUIRED_SHOPIFY_SCOPES = 'read_orders,write_orders,read_customers,write_customers,read_products,write_products,read_draft_orders,write_draft_orders';

const ShopifyCard: React.FC = () => {
  const { settings } = useAppStore();
  const { toast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProducts, setSyncProducts] = useState(false);

  const grantedScopes = (settings.shopifyGrantedScopes || '').split(',').filter(Boolean);
  const requiredScopes = REQUIRED_SHOPIFY_SCOPES.split(',');
  // write_X implies read_X, and read_all_orders covers read_orders
  const hasScope = (required: string) => {
    if (grantedScopes.includes(required)) return true;
    // write implies read (e.g. write_customers covers read_customers)
    if (required.startsWith('read_')) {
      const writeVersion = required.replace('read_', 'write_');
      if (grantedScopes.includes(writeVersion)) return true;
      // read_all_orders covers read_orders
      const allVersion = required.replace('read_', 'read_all_');
      if (grantedScopes.includes(allVersion)) return true;
    }
    return false;
  };
  const missingScopes = requiredScopes.filter(s => !hasScope(s));
  const needsReauth = missingScopes.length > 0 && grantedScopes.length > 0;

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/shopify/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncOrders: true, syncCustomers: true, syncProducts }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      const r = data.results;
      toast({
        title: 'Sync Complete',
        description: `Pulled: ${r.orders} orders, ${r.customers} customers${syncProducts ? `, ${r.products} products` : ''} · Pushed: ${r.pushed || 0} invoices · ${r.skipped} skipped`,
      });
    } catch (e: any) {
      toast({ title: 'Sync Failed', description: e.message, variant: 'destructive' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReauth = () => {
    window.location.href = '/api/shopify/auth?shop=af894b-7f.myshopify.com';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl flex items-center"><ShoppingBag className="mr-2 h-5 w-5" /> Shopify Integration</CardTitle>
        <CardDescription>Connected store — credentials are hardcoded in environment variables.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 font-medium">
          <CheckCircle2 className="h-4 w-4" />
          Connected · real-time webhooks active
        </div>
        {needsReauth && (
          <Alert variant="destructive" className="border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400 [&>svg]:text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Scope upgrade required</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-sm">Two-way sync and payment links need additional permissions: <span className="font-mono text-xs">{missingScopes.join(', ')}</span></p>
              <Button onClick={handleReauth} size="sm" variant="outline" className="border-amber-500 text-amber-700 hover:bg-amber-500/10">
                <RefreshCw className="mr-2 h-3 w-3" /> Re-authorize Shopify
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Shop domain</Label>
            <Input value="af894b-7f.myshopify.com" readOnly className="bg-muted cursor-default" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm text-muted-foreground">Admin API access token</Label>
            <Input value="shpat_••••••••••••••••••••••" readOnly className="bg-muted cursor-default" />
          </div>
        </div>
        {settings.shopifyLastSyncedAt && (
          <p className="text-xs text-muted-foreground">Last synced: {new Date(settings.shopifyLastSyncedAt).toLocaleString()}</p>
        )}
        <div className="flex items-center gap-2">
          <Switch id="sync-products" checked={syncProducts} onCheckedChange={setSyncProducts} />
          <Label htmlFor="sync-products" className="text-sm">Include product catalog</Label>
        </div>
        <Button onClick={handleSync} disabled={isSyncing} size="sm">
          {isSyncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {isSyncing ? 'Syncing…' : 'Sync Now'}
        </Button>
        <p className="text-xs text-muted-foreground">New invoices, customers, and products sync to Shopify automatically in real time.</p>
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
  
  const [uploadProgress, setUploadProgress] = useState<{ [key: string]: number | null }>({});
  const [isUploading, setIsUploading] = useState<{ [key: string]: boolean }>({});
  const [isFetchingRates, setIsFetchingRates] = useState(false);

  const fetchGoldRates = async () => {
    setIsFetchingRates(true);
    try {
      const res = await fetch('/api/gold-rates');
      if (!res.ok) throw new Error('Failed to fetch rates');
      const data = await res.json();
      form.setValue('goldRatePerGram24k', data.goldRatePerGram24k, { shouldDirty: true });
      form.setValue('goldRatePerGram22k', data.goldRatePerGram22k, { shouldDirty: true });
      form.setValue('goldRatePerGram21k', data.goldRatePerGram21k, { shouldDirty: true });
      form.setValue('goldRatePerGram18k', data.goldRatePerGram18k, { shouldDirty: true });
      toast({ title: 'Rates fetched from gold.pk', description: `24k: PKR ${data.goldRatePerGram24k.toLocaleString()}/g` });
    } catch (e) {
      toast({ title: 'Failed to fetch rates', description: 'Could not load rates from gold.pk. Try again.', variant: 'destructive' });
    } finally {
      setIsFetchingRates(false);
    }
  };

  type SignInLog = { id: string; email: string; displayName: string | null; browser: string; os: string; timestamp: { toDate: () => Date } | null; photoURL?: string | null; };
  const [signInLogs, setSignInLogs] = useState<SignInLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    if (!appReady) return;
    setLogsLoading(true);
    getDocs(query(collection(db, 'signInLogs'), orderBy('timestamp', 'desc'), limit(30)))
      .then(snap => setSignInLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as SignInLog))))
      .catch(() => {})
      .finally(() => setLogsLoading(false));
  }, [appReady]);

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
      theme: 'default',
      databaseLocked: false,
    },
  });

  React.useEffect(() => {
    // Only reset the form on the initial load (when it's pristine).
    // Subsequent real-time Firestore updates (e.g. lastInvoiceNumber ticking up)
    // must NOT wipe out in-progress edits.
    if (appReady && currentSettings && !form.formState.isDirty) {
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
        const settingsToSave: Partial<Settings> = { ...data };
        // Don't overwrite existing logo URLs with empty strings (happens when no new logo was uploaded)
        if (!settingsToSave.shopLogoUrl) delete settingsToSave.shopLogoUrl;
        if (!settingsToSave.shopLogoUrlBlack) delete settingsToSave.shopLogoUrlBlack;
        await updateSettingsAction(settingsToSave);
        toast({ title: "Settings Updated", description: "Your shop settings have been saved." });
    } catch (error) {
        toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" });
    }
  };

  const [isRestoring, setIsRestoring] = useState(false);
  const handleRestoreSettings = async () => {
    setIsRestoring(true);
    try {
      const res = await fetch('/api/gold-rates');
      const rates = res.ok ? await res.json() : null;
      const restoredRates = {
        goldRatePerGram24k: rates?.goldRatePerGram24k ?? currentSettings.goldRatePerGram24k,
        goldRatePerGram22k: rates?.goldRatePerGram22k ?? currentSettings.goldRatePerGram22k,
        goldRatePerGram21k: rates?.goldRatePerGram21k ?? currentSettings.goldRatePerGram21k,
        goldRatePerGram18k: rates?.goldRatePerGram18k ?? currentSettings.goldRatePerGram18k,
      };
      const shopDefaults = {
        shopName: 'HOUSE OF MINA',
        shopAddress: '272-B, SHABBIRABAD, BLOCK B, SYEDNA FAKHRUDDIN ROAD, KARACHI',
        shopContact: '03161930960',
      };
      await updateSettingsAction({ ...restoredRates, ...shopDefaults });
      form.reset({
        ...form.getValues(),
        ...restoredRates,
        ...shopDefaults,
      });
      toast({
        title: 'Settings Restored',
        description: `Gold rates fetched from gold.pk. Shop details reset to House of Mina defaults.`,
      });
    } catch {
      toast({ title: 'Restore failed', description: 'Could not restore settings.', variant: 'destructive' });
    } finally {
      setIsRestoring(false);
    }
  };

  if (!appReady || (isSettingsLoading && !form.formState.isDirty) ) { 
    return (
      <div className="container mx-auto py-8 px-4 flex items-center justify-center min-h-[calc(100vh-10rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
        <p className="text-lg text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  const mainLogoUrl = form.watch('shopLogoUrl');
  const blackLogoUrl = form.watch('shopLogoUrlBlack');


  return (
    <div className="container mx-auto py-8 px-4 space-y-8">
      <Card className="border-orange-400 bg-orange-50 dark:bg-orange-900/10">
        <CardHeader className="py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center text-orange-700 dark:text-orange-400">
                <RotateCcw className="mr-2 h-4 w-4" /> Restore Settings
              </CardTitle>
              <CardDescription className="text-orange-600/80 dark:text-orange-300/70 text-xs mt-0.5">
                Resets gold rates (live from gold.pk) and shop details to House of Mina defaults.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleRestoreSettings} disabled={isRestoring} className="border-orange-400 text-orange-700 hover:bg-orange-100 dark:text-orange-300">
              {isRestoring ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
              Restore Now
            </Button>
          </div>
        </CardHeader>
      </Card>
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
                <div className="flex items-center justify-between">
                  <Label className="text-base flex items-center"><DollarSign className="h-5 w-5 mr-2 text-muted-foreground" /> Current Gold Rates (PKR per gram)</Label>
                  <Button type="button" variant="outline" size="sm" onClick={fetchGoldRates} disabled={isFetchingRates}>
                    {isFetchingRates ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Globe className="h-4 w-4 mr-2" />}
                    Fetch from gold.pk
                  </Button>
                </div>
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

      {/* WhatsApp Notifications */}
      <NotificationsCard />

      {/* Shopify */}
      <ShopifyCard />

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
        </CardContent>
      </Card>

      {/* Sign-in Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center">
            <Clock className="mr-2 h-5 w-5" />
            Sign-in Activity
          </CardTitle>
          <CardDescription>Recent sign-ins to this app, including browser and OS details.</CardDescription>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading logs...
            </div>
          ) : signInLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No sign-in activity recorded yet. Activity will appear after the next sign-in.</p>
          ) : (
            <div className="space-y-3">
              {signInLogs.map(log => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                  {log.photoURL && log.photoURL.length > 0 ? (
                    <img src={log.photoURL} alt={log.displayName || ''} className="h-9 w-9 rounded-full flex-shrink-0 object-cover" />
                  ) : (
                    <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-semibold text-primary">{(log.displayName || log.email || '?')[0].toUpperCase()}</span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{log.displayName || log.email}</p>
                    <p className="text-xs text-muted-foreground truncate">{log.email}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><Monitor className="h-3 w-3" />{log.os}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="h-3 w-3" />{log.browser}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground flex-shrink-0">
                    {log.timestamp ? log.timestamp.toDate().toLocaleString() : '—'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
