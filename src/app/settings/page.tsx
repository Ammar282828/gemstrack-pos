
"use client";

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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Image from 'next/image';
import 'react-phone-number-input/style.css';
import { AmountInput } from '@/components/ui/amount-input';
import { PhoneField } from '@/components/ui/phone-field';
import { useWorkDrafts } from '@/components/drafts/use-work-drafts';
import { REPORT_TOGGLE, reportWhen, type ReportTask } from '@/lib/notifications/schedule';
import { RatesForm } from '@/components/rates/rate-chip';
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
  databaseLocked: z.boolean().optional(),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

const SECTIONS = [
  { value: 'shop',          label: 'Shop',         icon: Building },
  { value: 'rates',         label: 'Rates',        icon: DollarSign },
  { value: 'notifications', label: 'Alerts',       icon: Bell },
  { value: 'integrations',  label: 'Integrations', icon: ShoppingBag },
  { value: 'data',          label: 'Data',         icon: Database },
  { value: 'security',      label: 'Security',     icon: Shield },
] as const;

/** Only two tabs hold form fields. Radix keeps the inactive panels unmounted,
 *  so a validation failure on a tab you cannot see would otherwise just make
 *  the save button do nothing — this is used to jump to the offending tab. */
const FIELD_TAB: Partial<Record<keyof SettingsFormData, string>> = {
  shopName: 'shop', shopAddress: 'shop', shopContact: 'shop', theme: 'shop', uiStyle: 'shop',
  lastInvoiceNumber: 'shop', lastOrderNumber: 'shop',
};

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
             <Card className="border-success bg-success/10">
                <CardHeader>
                    <CardTitle className="text-xl flex items-center text-success">
                        <ShieldCheck className="mr-2 h-5 w-5" /> Database Secured
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-success">
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
  { key: 'notifNewInvoice',     label: 'New Sale / Invoice',  description: 'Alert when a new invoice is created' },
  { key: 'notifPaymentReceived',label: 'Payment Received',    description: 'Alert when a payment is recorded on an invoice' },
  { key: 'notifDailyReport',    label: 'Daily Report',        description: 'Nightly summary: sales, cash collected, orders, outstanding' },
  { key: 'notifDailyChecklist', label: 'Daily Checklist',     description: 'Morning summary: active orders, overdue, unreturned items' },
  { key: 'notifEndOfDay',       label: 'End of Day Summary',  description: 'Evening recap: today\'s sales, orders and expenses' },
  { key: 'notifWeeklyReport',   label: 'Weekly Report',       description: 'The last seven days: sales, expenses, late orders, karigars' },
  { key: 'notifMonthlyReport',  label: 'Monthly Report (PDF)', description: 'Every sale of the month, with its figures, as a PDF — any month is also in Analytics' },
  { key: 'notifAdsDaily',       label: 'Ads Summary',         description: 'Yesterday\'s Meta ads: spend, chats, cost per chat, and anything needing attention' },
  { key: 'notifOrderOverdue',   label: 'Overdue Order Alert', description: 'Orders past the date the customer was promised' },
  { key: 'notifGivenItems',     label: 'Given Items Overdue', description: 'Items given out and not returned for 7+ days' },
  { key: 'notifKarigarPayment', label: 'Karigar Balances',    description: 'Cash to pay and gold with each karigar, from Hisaab' },
];

/** The scheduled report behind a switch; the others are live alerts, sent as things happen. */
const REPORT_OF = Object.fromEntries(Object.entries(REPORT_TOGGLE).map(([task, key]) => [key, task])) as Partial<Record<keyof Settings, ReportTask>>;

interface LastRun { date: string; status: string; at: string | null; sent: number; recipients: number; failed: string[]; error: string | null; tries: number }

/** "last sent today 9:02 pm to 4", "last failed 29 Sep: …". */
function lastRunLine(r: LastRun | undefined): { text: string; bad: boolean } {
  if (!r) return { text: 'not sent in the last week', bad: false };
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
  const time = r.at ? new Date(r.at).toLocaleTimeString('en-PK', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' }) : '';
  const day = r.date === today ? `today ${time}`.trim()
    : new Date(`${r.date}T12:00:00+05:00`).toLocaleDateString('en-PK', { day: 'numeric', month: 'short' });
  switch (r.status) {
    case 'sent': return { text: `last sent ${day} to ${r.sent} of ${r.recipients}${r.failed.length ? ` (not ${r.failed.map(f => f.split(':')[0]).join(', ')})` : ''}`, bad: r.failed.length > 0 };
    case 'quiet': return { text: `${day}: nothing to report`, bad: false };
    case 'running': return { text: `sending (${day})`, bad: false };
    default: return { text: `failed ${day}${r.tries < 3 && r.date === today ? ', trying again' : ''}: ${r.error || r.failed.join('; ') || 'unknown error'}`, bad: true };
  }
}

function NotificationsCard() {
  const { settings, updateSettings } = useAppStore();
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [newPhone, setNewPhone] = React.useState('');
  const phones = settings.notifPhones || [];

  // The gateway (WAHA, or Green API as the fallback) drops out when the linked
  // phone is unlinked or offline too long, and the only symptom is messages
  // quietly not arriving.
  const [health, setHealth] = React.useState<{ ok: boolean; configured: boolean; state?: string; detail?: string } | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  const checkHealth = React.useCallback(async () => {
    setChecking(true);
    try {
      setHealth(await (await fetch('/api/notifications/health')).json());
    } catch {
      setHealth({ ok: false, configured: false, detail: 'Could not reach the app.' });
    } finally { setChecking(false); }
  }, []);
  React.useEffect(() => { void checkHealth(); }, [checkHealth]);

  // When each scheduled report last went (notif_runs), so a silent one shows here.
  const [runs, setRuns] = React.useState<Partial<Record<ReportTask, LastRun>> | null>(null);
  const loadRuns = React.useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/run', { cache: 'no-store' });
      if (res.ok) setRuns((await res.json()).last ?? {});
    } catch { /* the times still show */ }
  }, []);
  React.useEffect(() => { void loadRuns(); }, [loadRuns]);

  const [sendingNow, setSendingNow] = React.useState<ReportTask | null>(null);
  const sendNow = async (task: ReportTask) => {
    setSendingNow(task);
    try {
      let token = '';
      try { token = (await firebaseAuth?.currentUser?.getIdToken()) || ''; } catch { /* signed out */ }
      const res = await fetch('/api/notifications/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
        body: JSON.stringify({ task, force: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status === 'off') throw new Error(body.error || `HTTP ${res.status}`);
      toast(body.status === 'quiet'
        ? { title: 'Nothing to report', description: 'There is nothing in it right now, so nothing was sent.' }
        : { title: 'Sent', description: `Sent to ${body.sent} of ${body.recipients}${body.failed?.length ? ` — not to ${body.failed.join('; ')}` : ''}.` });
    } catch (e) {
      toast({ title: 'Send failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setSendingNow(null); }
  };

  /** /api/notifications/send is owner-gated, so every caller must identify
   *  itself. Both test buttons go through here — the per-recipient one was
   *  left sending no token when the endpoint was locked down, and 401'd. */
  const sendTestTo = React.useCallback(async (phone: string) => {
    let token = '';
    try { token = (await firebaseAuth?.currentUser?.getIdToken()) || ''; } catch { /* signed out */ }
    const res = await fetch('/api/notifications/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ to: phone, message: `Test from ${STORE_CONFIG.name} ERP — notifications are working.` }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${res.status}`);
    }
  }, []);

  const sendTest = async () => {
    if (!phones.length) {
      toast({ title: 'No recipients', description: 'Add a number first.', variant: 'destructive' });
      return;
    }
    setTesting(true);
    try {
      await sendTestTo(phones[0]);
      toast({ title: 'Test sent', description: `Check WhatsApp on ${phones[0]}.` });
    } catch (e) {
      toast({ title: 'Test failed', description: (e as Error).message, variant: 'destructive' });
    } finally { setTesting(false); }
  };

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
      await sendTestTo(phone);
      toast({ title: 'Test message sent', description: `Message sent to ${phone}` });
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
          Shop alerts sent through WAHA, the shop's own WhatsApp gateway (<code className="text-xs bg-muted px-1 rounded">WAHA_URL</code>, <code className="text-xs bg-muted px-1 rounded">WAHA_API_KEY</code>), or Green API when those are not set.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Whether it can actually send, rather than whether it is switched on. */}
        <div className={cn('rounded-lg border p-3 flex items-center gap-3 flex-wrap',
          health && !health.ok && 'border-destructive/40 bg-destructive/5')}>
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0',
            checking ? 'bg-muted-foreground' : health?.ok ? 'bg-success' : 'bg-destructive')} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {checking ? 'Checking…'
                : health?.ok ? 'Connected'
                : !health?.configured ? 'Not configured'
                : `Not ready${health.state ? ` — ${health.state}` : ''}`}
            </p>
            {health?.detail && <p className="text-xs text-muted-foreground">{health.detail}</p>}
          </div>
          <Button size="sm" variant="outline" onClick={checkHealth} disabled={checking}>
            {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Re-check'}
          </Button>
          <Button size="sm" onClick={sendTest} disabled={testing || !health?.ok}>
            {testing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Send test
          </Button>
        </div>
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
              <p className="text-xs text-muted-foreground">Pick the country (defaults to Pakistan 🇵🇰) and enter the number — the country code is added automatically.</p>

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
              <div className="flex gap-2 items-center">
                <div className="w-full max-w-xs">
                  <PhoneField
                    value={newPhone || undefined}
                    onChange={(val) => setNewPhone(val || '')}
                    aria-label="WhatsApp number to notify"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={handleAddPhone} disabled={!newPhone}>
                  <Plus className="h-4 w-4 mr-1" /> Add
                </Button>
              </div>
            </div>

            <Separator />

            {/* Notification toggles */}
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Notification Types</p>
              {NOTIF_TOGGLES.map(({ key, label, description }) => {
                const task = REPORT_OF[key];
                const last = task && settings[key] && runs ? lastRunLine(runs[task]) : null;
                return (
                  <div key={key} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-xs text-muted-foreground">{description}</p>
                      {task && (
                        <p className={cn('text-xs mt-0.5', last?.bad ? 'text-destructive' : 'text-muted-foreground')}>
                          {reportWhen(task, settings)}{last ? ` · ${last.text}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {task && (
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => sendNow(task)} disabled={!!sendingNow || !phones.length}>
                          {sendingNow === task ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Send now'}
                        </Button>
                      )}
                      <Switch
                        checked={!!settings[key]}
                        onCheckedChange={v => handleToggle(key, v as boolean)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <Separator />

            {/* Schedule times */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              <div className="space-y-1.5">
                <Label htmlFor="dailyReportTime">Daily Report Time</Label>
                <Input
                  id="dailyReportTime"
                  type="time"
                  defaultValue={settings.notifDailyReportTime || '21:00'}
                  onBlur={e => updateSettings({ notifDailyReportTime: e.target.value })}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Reports go out by themselves at these times, Karachi time — nothing needs to be left running.
              The overdue checks go with the checklist, and on Mondays the weekly report and karigar payments too.
              One missed while the ERP was updating still goes within the hour; after that it waits for its next day.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Label + explanation on the left, control on the right. The page repeated
 *  this shape a dozen times with slightly different spacing each time. */
const SettingRow: React.FC<{ title: string; description?: React.ReactNode; children: React.ReactNode }> = ({ title, description, children }) => (
  <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
    <div className="min-w-0">
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
  </div>
);

/** A link out to one of the settings sub-pages. */
const SettingsLink: React.FC<{ href: string; icon: React.ElementType; title: string; description: string }> = ({ href, icon: Icon, title, description }) => (
  <Button asChild variant="outline" className="w-full justify-start text-left h-auto py-3">
    <Link href={href}>
      <Icon className="mr-3 h-5 w-5 flex-shrink-0" />
      <span className="block min-w-0">
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground font-normal">{description}</span>
      </span>
    </Link>
  </Button>
);

/** The switch for Drafts (new orders and sales kept as they are typed) and how many are waiting. */
function DraftsRow() {
  const { settings, updateSettings } = useAppStore();
  const { drafts } = useWorkDrafts();

  return (
    <SettingRow
      title="Keep unfinished orders and sales in Drafts"
      description={<>A new order or sale is saved in Drafts as it is typed, on every device, and leaves once it is saved as an order or invoice. Orders and invoices that already exist are never drafted.{drafts.length > 0 && ` ${drafts.length} waiting now.`}</>}
    >
      {drafts.length > 0 && (
        <Button asChild variant="outline" size="sm">
          <Link href="/drafts">View</Link>
        </Button>
      )}
      <Switch
        checked={settings.autoDraftForms !== false}
        onCheckedChange={v => updateSettings({ autoDraftForms: v })}
        aria-label="Keep unfinished orders and sales in Drafts"
      />
    </SettingRow>
  );
}

const REQUIRED_SHOPIFY_SCOPES = 'read_orders,write_orders,read_customers,write_customers,read_products,write_products,read_draft_orders,write_draft_orders';

type ShopifyStatus = {
  configured: boolean; shop?: string; connected?: boolean; shopName?: string | null; error?: string;
  scopes?: string[]; webhooksHere?: number; webhooksTotal?: number; lastSyncedAt?: string | null;
};

/**
 * The house's Shopify store, as the store itself reports it (/api/shopify/status). Only where
 * SHOPIFY_STORE_DOMAIN is set (House of Mina): it was hardcoded to Mina's store and always said
 * "Connected", on Taheri too.
 */
const ShopifyCard: React.FC = () => {
  const [status, setStatus] = useState<ShopifyStatus | null>(null);
  useEffect(() => {
    let live = true;
    authedFetch('/api/shopify/status').then(r => (r.ok ? r.json() : null)).then(d => { if (live) setStatus(d); }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!status?.configured) return null;

  const granted = status.scopes ?? [];
  // write_X implies read_X, and read_all_orders covers read_orders
  const hasScope = (required: string) => granted.includes(required)
    || (required.startsWith('read_') && (granted.includes(required.replace('read_', 'write_')) || granted.includes(required.replace('read_', 'read_all_'))));
  const missingScopes = REQUIRED_SHOPIFY_SCOPES.split(',').filter(s => !hasScope(s));
  const needsReauth = !!status.connected && granted.length > 0 && missingScopes.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl flex items-center"><ShoppingBag className="mr-2 h-5 w-5" /> Shopify</CardTitle>
        <CardDescription>{status.shopName ? `${status.shopName} · ` : ''}<span className="font-mono text-xs">{status.shop}</span></CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.connected ? (
          <div className="flex items-center gap-2 text-sm text-success font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Connected · {status.webhooksHere ?? 0} webhook{status.webhooksHere === 1 ? '' : 's'} to this ERP
          </div>
        ) : (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Shopify is not answering</AlertTitle>
            <AlertDescription className="text-sm">{status.error || 'The store did not accept the access token.'}</AlertDescription>
          </Alert>
        )}
        {status.connected && !status.webhooksHere && (
          <p className="text-sm text-warning">No webhooks point at this ERP, so new Shopify orders won&apos;t arrive by themselves. Re-register them from the pull panel below.</p>
        )}
        {needsReauth && (
          <Alert variant="destructive" className="border-warning bg-warning/10 text-warning [&>svg]:text-warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Scope upgrade required</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-sm">Two-way sync and payment links need additional permissions: <span className="font-mono text-xs">{missingScopes.join(', ')}</span></p>
              <Button onClick={() => { window.location.href = `/api/shopify/auth?shop=${encodeURIComponent(status.shop || '')}`; }} size="sm" variant="outline" className="border-warning text-warning hover:bg-warning/10">
                <RefreshCw className="mr-2 h-3 w-3" /> Re-authorize Shopify
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {status.lastSyncedAt && (
          <p className="text-xs text-muted-foreground">Last synced: {new Date(status.lastSyncedAt).toLocaleString()}</p>
        )}
        <ShopifyPullPanel />

        <p className="text-xs text-muted-foreground">
          Sync runs one way only: Shopify &rarr; ERP. Nothing you do in the ERP creates or updates
          orders, draft orders, or customers on the storefront. Refunds and cancellations of sales
          already pushed to Shopify still go through, so nothing is left live there by mistake.
        </p>
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
  
  const [tab, setTab] = useState<string>('shop');
  // This device's own light/dark (the top bar's sun/moon), shown beside the shop's mode.
  const [deviceTheme, setDeviceTheme] = useState<string | null>(null);
  useEffect(() => {
    setDeviceTheme(readDeviceTheme());
    const on = (e: Event) => setDeviceTheme((e as CustomEvent<string | null>).detail ?? null);
    window.addEventListener(DEVICE_THEME_EVENT, on);
    return () => window.removeEventListener(DEVICE_THEME_EVENT, on);
  }, []);

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
      shopName: "",
      shopAddress: "",
      shopContact: "",
      shopLogoUrl: "",
      shopLogoUrlBlack: "",
      lastInvoiceNumber: 0,
      lastOrderNumber: 0,
      theme: 'default',
      uiStyle: 'standard',
      databaseLocked: false,
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
        databaseLocked: currentSettings.databaseLocked || false,
      });
    }
  }, [currentSettings, form, appReady]);


  const onSubmit = async (data: SettingsFormData) => {
    try {
        const settingsToSave: Partial<Settings> = { ...data };
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

  /** Send the user to the tab holding the first bad field, otherwise the save
   *  button appears to do nothing when the error is on a hidden panel. */
  const onInvalid = (errors: Record<string, unknown>) => {
    const first = Object.keys(errors)[0] as keyof SettingsFormData | undefined;
    const target = first && FIELD_TAB[first];
    if (target) setTab(target);
    toast({
      title: 'Could not save',
      description: 'Some values need fixing — the highlighted field is showing why.',
      variant: 'destructive',
    });
  };

  const [isRestoring, setIsRestoring] = useState(false);
  const handleRestoreSettings = async () => {
    setIsRestoring(true);
    try {
      // This house's own defaults (STORE_CONFIG), and only those it has: a blank one is left alone
      // rather than erasing what the shop typed. It used to write House of Mina's address and number
      // into whichever house ran it.
      const shopDefaults: Partial<Settings> = {
        shopName: STORE_CONFIG.name,
        ...(STORE_CONFIG.address && { shopAddress: STORE_CONFIG.address }),
        ...(STORE_CONFIG.contact1Number && { shopContact: STORE_CONFIG.contact1Number.replace(/\s+/g, '') }),
      };
      // gold.pk's gold rates, for a gold house; the store stamps and logs the change.
      let restoredRates: Partial<Settings> = {};
      if (STORE_CONFIG.defaultMetal === 'gold') {
        const res = await fetch('/api/gold-rates');
        const rates = res.ok ? await res.json() : null;
        if (rates?.goldRatePerGram21k) restoredRates = {
          goldRatePerGram24k: rates.goldRatePerGram24k, goldRatePerGram22k: rates.goldRatePerGram22k,
          goldRatePerGram21k: rates.goldRatePerGram21k, goldRatePerGram18k: rates.goldRatePerGram18k,
        };
      }
      await updateSettingsAction({ ...restoredRates, ...shopDefaults }, { source: 'Restore shop defaults (gold.pk)' });
      form.reset({ ...form.getValues(), ...shopDefaults });
      toast({
        title: 'Shop defaults restored',
        description: `${Object.keys(restoredRates).length ? 'Gold rates from gold.pk. ' : ''}Shop details reset to ${STORE_CONFIG.name}'s defaults.`,
      });
    } catch {
      toast({ title: 'Restore failed', description: 'Could not restore settings.', variant: 'destructive' });
    } finally {
      setIsRestoring(false);
    }
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
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-7xl space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2.5">
            <SlidersHorizontal className="w-7 h-7 flex-shrink-0" />Settings
          </h1>
          {/* Was a full-width Alert box for one line of text. */}
          <p className="text-sm text-muted-foreground mt-0.5 truncate">
            {currentSettings.shopName || STORE_CONFIG.name}
            {currentSettings.firebaseConfig?.projectId && (
              <> · <span className="font-mono text-xs">{currentSettings.firebaseConfig.projectId}</span></>
            )}
          </p>
        </div>
      </header>

      {/* FormProvider only — deliberately no <form> element. The Integrations,
          Alerts and Security panels are full of their own buttons, and a bare
          <button> inside a form defaults to type="submit", so any of them would
          have saved the settings form as a side effect. The save bar calls
          handleSubmit directly instead. */}
      <Form {...form}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full md:w-fit justify-start mb-4 overflow-x-auto">
            {SECTIONS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                  {label}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ─────────────────────────── Shop ─────────────────────────── */}
          <TabsContent value="shop" className="space-y-4 mt-0">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Shop details</CardTitle>
                <CardDescription>Printed at the top of every invoice, estimate and order slip.</CardDescription>
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
          </TabsContent>

          {/* ─────────────────────────── Rates ────────────────────────── */}
          <TabsContent value="rates" className="space-y-4 mt-0">
            {/* The same form as the top bar's rate chip; it saves on its own, so the shop details'
                save can never write back rates it loaded minutes ago. */}
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg">Metal rates</CardTitle>
              </CardHeader>
              <CardContent><RatesForm /></CardContent>
            </Card>
          </TabsContent>

          {/* ────────────────────────── Alerts ────────────────────────── */}
          <TabsContent value="notifications" className="mt-0">
            <NotificationsCard />
          </TabsContent>

          {/* ─────────────────────── Integrations ─────────────────────── */}
          <TabsContent value="integrations" className="space-y-4 mt-0">
            {STORE_WEBSITE_SELLING && <WebsiteSettings />}
            <ShopifyCard />
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><Printer className="h-5 w-5" />Printing</CardTitle>
                <CardDescription>Tag and label printing.</CardDescription>
              </CardHeader>
              {/* Both of these pages existed with nothing linking to them —
                  reachable only by typing the URL. */}
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* WEPrint's live feed is hidden: its endpoint (/api/products/weprint) never existed. */}
                <SettingsLink href="/settings/printer" icon={Tag} title="Label designer" description="Build and export jewellery tags." />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─────────────────────────── Data ─────────────────────────── */}
          <TabsContent value="data" className="space-y-4 mt-0">
            <DraftsRow />
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><Database className="h-5 w-5" />Import &amp; backup</CardTitle>
                <CardDescription>Bring records in from a spreadsheet, or take a copy out.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <SettingsLink href="/settings/contact-import" icon={Users} title="Import contacts" description="From a phone's address book, marked TJ, HOM, TC or Karigar." />
                <SettingsLink href="/settings/hisaab-import" icon={Import} title="Import hisaab" description="Historical ledgers from other apps." />
                <SettingsLink href="/settings/backups" icon={ArchiveRestore} title="Backups" description="Snapshot and restore your data." />
                <SettingsLink href="/settings/payment-methods" icon={Landmark} title="Payment methods" description="Accounts money is received into." />
                <SettingsLink href="/settings/recently-removed" icon={RotateCcw} title="Recently removed" description="Customers and karigars you hid. Nothing is destroyed until you empty it." />
                {/* Taheri's previous app's book: Taheri only. */}
                {STORE_BRAND === 'taheri' && (
                  <SettingsLink href="/settings/import-taheri" icon={Database} title="Import Taheri Software book" description="One-off: 377 customers and 46 karigars from the shop's previous app." />
                )}
              </CardContent>
            </Card>
            <SettingRow
              title="Restore shop defaults"
              description={`Resets the shop name, address and number to ${STORE_CONFIG.name}'s own${STORE_CONFIG.defaultMetal === 'gold' ? ', and the gold rates to gold.pk' : ''}. No orders or invoices are touched.`}
            >
              <Button type="button" variant="outline" size="sm" onClick={handleRestoreSettings} disabled={isRestoring}>
                {isRestoring ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
                Restore
              </Button>
            </SettingRow>
          </TabsContent>

          {/* ───────────────────────── Security ───────────────────────── */}
          <TabsContent value="security" className="space-y-4 mt-0">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2"><Clock className="h-5 w-5" />Sign-in activity</CardTitle>
                <CardDescription>The last 30 sign-ins to this app.</CardDescription>
              </CardHeader>
              <CardContent>
                {logsLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                  </div>
                ) : signInLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No sign-in activity recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {signInLogs.map(log => (
                      <div key={log.id} className="flex items-start gap-3 p-3 rounded-lg border">
                        {log.photoURL && log.photoURL.length > 0 ? (
                          <img src={log.photoURL} alt="" className="h-9 w-9 rounded-full flex-shrink-0 object-cover" loading="lazy" decoding="async" />
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
            {/* Last thing on the last tab. It used to be the second thing on the
                page, above every routine setting. */}
            <EmergencyLock />
          </TabsContent>
        </Tabs>
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
    </div>
  );
}
