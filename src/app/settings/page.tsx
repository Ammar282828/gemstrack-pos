
"use client";

import { PageShell } from '@/components/shared/page-shell';
import React, { useState, useEffect } from 'react';
import { readDeviceTheme, writeDeviceTheme, DEVICE_THEME_EVENT } from '@/lib/theme-cache';
import { ListSkeleton } from '@/components/shared/skeletons';
import { STORE_CONFIG, STORE_BRAND, STORE_WEBSITE_SELLING } from '@/lib/store-config';
import { auth as firebaseAuth } from '@/lib/firebase';
import { cn } from '@/lib/utils';
import { useForm } from 'react-hook-form';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAppStore, Settings, ThemeKey, AVAILABLE_THEMES, normalizeTheme } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { WebsiteSettings } from '@/components/settings/website-settings';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { ShopifyPullPanel } from '@/components/settings/shopify-pull-panel';
import { useToast } from '@/hooks/use-toast';
import { Save, Building, Phone, Image as ImageIcon, DollarSign, Shield, FileText, Loader2, Database, AlertTriangle, Users, Palette, Info, Import, ShieldCheck, ShieldAlert, Monitor, Globe, Clock, RotateCcw, Bell, BellOff, Plus, X, ShoppingBag, RefreshCw, CheckCircle2, Lock, SlidersHorizontal, Printer, Tag, ArchiveRestore, Landmark } from 'lucide-react';
import { STORE_LOGO_URL, STORE_LOGO_LIGHT_URL } from '@/lib/store-config';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import Image from 'next/image';
import 'react-phone-number-input/style.css';
import { AmountInput } from '@/components/ui/amount-input';
import { PhoneField } from '@/components/ui/phone-field';
import { useWorkDrafts } from '@/components/drafts/use-work-drafts';
import { REPORT_TOGGLE, reportWhen, type ReportTask } from '@/lib/notifications/schedule';
import { openRateSheet } from '@/components/rates/rate-chip';
import { authedFetch } from '@/lib/voice/authed-fetch';

const themeKeys = AVAILABLE_THEMES.map(t => t.key) as [ThemeKey, ...ThemeKey[]];

const settingsSchema = z.object({
  shopName: z.string().min(1, "Shop name is required"),
  shopAddress: z.string().optional(),
  shopContact: z.string().optional(),
  shopLogoUrl: z.string().optional(),
  shopLogoUrlBlack: z.string().optional(),
  lastInvoiceNumber: z.coerce.number().int().min(0, "Last invoice number must be a non-negative integer"),
  lastOrderNumber: z.coerce.number().int().min(0, "Last order number must be a non-negative integer"),
  theme: z.enum(themeKeys).default('default'),
  uiStyle: z.enum(['standard', 'glass']).default('standard'),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export default function SettingsPage() {
  const { toast } = useToast();
  const appReady = useAppReady();
  const currentSettings = useAppStore(state => state.settings);
  const updateSettingsAction = useAppStore(state => state.updateSettings);
  const isSettingsLoading = useAppStore(state => state.isSettingsLoading);
  
  // Settings' tabs are routes now; an old ?tab= link lands where that tab went (the rates open the
  // top bar's rate sheet, which is where they live now).
  const router = useRouter();
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (!tab || tab === 'shop') return;
    if (tab === 'rates') { openRateSheet(); router.replace('/settings'); return; }
    const to: Record<string, string> = { notifications: '/settings/alerts', alerts: '/settings/alerts', integrations: '/settings/integrations', data: '/settings/data', security: '/activity-log' };
    router.replace(to[tab] ?? '/settings');
  }, [router]);
  // This device's own light/dark (the top bar's sun/moon), shown beside the shop's mode.
  const [deviceTheme, setDeviceTheme] = useState<string | null>(null);
  useEffect(() => {
    setDeviceTheme(readDeviceTheme());
    const on = (e: Event) => setDeviceTheme((e as CustomEvent<string | null>).detail ?? null);
    window.addEventListener(DEVICE_THEME_EVENT, on);
    return () => window.removeEventListener(DEVICE_THEME_EVENT, on);
  }, []);

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      shopName: "",
      shopAddress: "",
      shopContact: "",
      shopLogoUrl: "",
      shopLogoUrlBlack: "",
      lastInvoiceNumber: 0,
      lastOrderNumber: 0,
      theme: 'default',
      uiStyle: 'standard',
    },
  });

  React.useEffect(() => {
    // Only reset the form on the initial load (when it's pristine).
    // Subsequent real-time Firestore updates (e.g. lastInvoiceNumber ticking up)
    // must NOT wipe out in-progress edits.
    if (appReady && currentSettings && !form.formState.isDirty) {
      form.reset({
        shopName: currentSettings.shopName,
        shopAddress: currentSettings.shopAddress || "",
        shopContact: currentSettings.shopContact || "",
        shopLogoUrl: currentSettings.shopLogoUrl || "",
        shopLogoUrlBlack: currentSettings.shopLogoUrlBlack || "",
        lastInvoiceNumber: currentSettings.lastInvoiceNumber,
        lastOrderNumber: currentSettings.lastOrderNumber || 0,
        theme: normalizeTheme(currentSettings.theme),
        uiStyle: currentSettings.uiStyle === 'glass' ? 'glass' : 'standard',
      });
    }
  }, [currentSettings, form, appReady]);


  const onSubmit = async (data: SettingsFormData) => {
    try {
        // Only what changed here: a field saved from a form loaded minutes ago would put back a value
        // another screen or device has since moved (it is how the rates and the lock went stale).
        const dirty = form.formState.dirtyFields as Partial<Record<keyof SettingsFormData, boolean>>;
        const settingsToSave: Partial<Settings> = Object.fromEntries(
          (Object.keys(data) as (keyof SettingsFormData)[]).filter(k => dirty[k]).map(k => [k, data[k]])) as Partial<Settings>;
        // Don't overwrite existing logo URLs with empty strings (happens when no new logo was uploaded)
        if (!settingsToSave.shopLogoUrl) delete settingsToSave.shopLogoUrl;
        if (!settingsToSave.shopLogoUrlBlack) delete settingsToSave.shopLogoUrlBlack;
        await updateSettingsAction(settingsToSave);
        // Re-baseline so isDirty clears — otherwise the save bar stays up for
        // good once you have edited anything.
        form.reset(data);
        toast({ title: "Settings saved", description: "Your shop settings have been updated." });
    } catch (error) {
        toast({ title: "Error", description: "Failed to update settings.", variant: "destructive" });
    }
  };

  const onInvalid = () => {
    toast({
      title: 'Could not save',
      description: 'Some values need fixing — the highlighted field is showing why.',
      variant: 'destructive',
    });
  };

  if (!appReady || (isSettingsLoading && !form.formState.isDirty) ) { 
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl">
        <ListSkeleton />
      </div>
    );
  }

  const isDirty = form.formState.isDirty;

  return (
    <PageShell subtitle={<>
      {currentSettings.shopName || STORE_CONFIG.name}
      {currentSettings.firebaseConfig?.projectId && (
        <> · <span className="font-mono text-xs">{currentSettings.firebaseConfig.projectId}</span></>
      )}
    </>}>

      {/* FormProvider only — deliberately no <form> element. The Integrations,
          Alerts and Security panels are full of their own buttons, and a bare
          <button> inside a form defaults to type="submit", so any of them would
          have saved the settings form as a side effect. The save bar calls
          handleSubmit directly instead. */}
      <Form {...form}>
        <div className="space-y-4">
          {/* ─────────────────────────── Shop ─────────────────────────── */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Shop details</CardTitle>
                <CardDescription>Printed at the top of every invoice and order slip.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="shopName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Shop name</FormLabel>
                      <FormControl><Input placeholder="Your boutique name" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="shopAddress"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Address</FormLabel>
                      <FormControl><Textarea placeholder="272-B, Shabbirabad, Block B, Karachi" rows={2} {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="shopContact"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact</FormLabel>
                      <FormControl><Input placeholder="0316 1930960 | contact@example.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Document numbering</CardTitle>
                <CardDescription>The next invoice or order continues from these. Change them only when migrating from another system.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="lastInvoiceNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />Last invoice number</FormLabel>
                      <FormControl><Input type="number" step="1" inputMode="numeric" {...field} /></FormControl>
                      <FormDescription>Next invoice: INV-{String((form.watch('lastInvoiceNumber') || 0) + 1).padStart(6, '0')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastOrderNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />Last order number</FormLabel>
                      <FormControl><Input type="number" step="1" inputMode="numeric" {...field} /></FormControl>
                      <FormDescription>Next order: ORD-{String((form.watch('lastOrderNumber') || 0) + 1).padStart(6, '0')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Appearance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="theme"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2"><Palette className="h-4 w-4 text-muted-foreground" />Shop mode</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="sm:max-w-xs"><SelectValue placeholder="Select a mode" /></SelectTrigger>
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
                      <p className="text-xs text-muted-foreground">
                        For every device that hasn’t chosen its own. Each device switches for itself with the sun / moon in the top bar.
                        {deviceTheme && (
                          <> This device uses its own ({deviceTheme === 'default' ? 'light' : 'dark'}) —{' '}
                            <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => { writeDeviceTheme(null); setDeviceTheme(null); }}>follow the shop</button>.
                          </>
                        )}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Apple's Liquid Glass as a choice (the owner, 2026-09-27: "a dropdown option
                    from the normal ui"). The shop's, like the mode; globals.css has the rules. */}
                <FormField
                  control={form.control}
                  name="uiStyle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2"><Palette className="h-4 w-4 text-muted-foreground" />Interface style</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger className="sm:max-w-xs"><SelectValue placeholder="Select a style" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="glass">Liquid Glass</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Liquid Glass is Apple’s: the sidebar, bars, menus and sheets become glass floating over the page, the way iOS 26 and macOS Tahoe draw them. Cards and forms stay as they are. For every device; a device set to Reduce Transparency gets a solid version.
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <ImageIcon className="h-4 w-4 text-muted-foreground" />Brand logo
                    <span className="text-xs font-normal text-muted-foreground inline-flex items-center gap-1"><Lock className="h-3 w-3" />locked</span>
                  </Label>
                  <div className="p-3 border rounded-md w-fit bg-muted">
                    {/* Same swap as the sidebar: the charcoal cut on the light theme,
                        the white cut on the dark one. The PDF always gets charcoal. */}
                    <Image src={STORE_LOGO_URL} alt={`${STORE_CONFIG.name} brand logo`} width={240} height={60} className="object-contain max-h-16 hidden [.theme-default_&]:block" unoptimized />
                    <Image src={STORE_LOGO_LIGHT_URL} alt="" aria-hidden width={240} height={60} className="object-contain max-h-16 [.theme-default_&]:hidden" unoptimized />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Ships with the app and appears on every generated PDF. Changing it needs a code change to{' '}
                    <code className="text-xs px-1 py-0.5 rounded bg-muted">STORE_LOGO_URL</code>.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

        </div>
      </Form>

      {/* Save bar — only when there is something to save, so it never covers
          content on the tabs that have no form fields. */}
      {isDirty && (
        <>
          <div className="h-20" aria-hidden />
          <div className="glass-bar fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="container mx-auto max-w-7xl px-4 py-3 flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground truncate">Unsaved changes</p>
              <div className="flex gap-2 flex-shrink-0">
                <Button type="button" variant="ghost" onClick={() => form.reset()} disabled={form.formState.isSubmitting}>
                  Discard
                </Button>
                <Button type="button" onClick={form.handleSubmit(onSubmit, onInvalid)} disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save changes
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </PageShell>
  );
}
