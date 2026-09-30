"use client";

/**
 * The parts of Settings, one route each since the audit of 2026-10-01 (one tab row per screen:
 * Settings had seven top-bar tabs and six more in-page tabs, one of them "Settings"). Shop is
 * /settings, Alerts /settings/alerts, Integrations /settings/integrations, Data /settings/data;
 * the sign-in log and the Emergency lock live on Activity (/activity-log).
 */


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


export const EmergencyLock: React.FC = () => {
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

export function NotificationsCard() {
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
          WhatsApp alerts
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
            <p className="font-medium">Alerts on</p>
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
export const SettingRow: React.FC<{ title: string; description?: React.ReactNode; children: React.ReactNode }> = ({ title, description, children }) => (
  <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
    <div className="min-w-0">
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
    </div>
    <div className="flex items-center gap-2 flex-shrink-0">{children}</div>
  </div>
);

/** A link out to one of the settings sub-pages. */
export const SettingsLink: React.FC<{ href: string; icon: React.ElementType; title: string; description: string }> = ({ href, icon: Icon, title, description }) => (
  <Button asChild variant="outline" className="w-full justify-start text-left h-auto py-3 whitespace-normal">
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
export function DraftsRow() {
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
export const ShopifyCard: React.FC = () => {
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


type SignInLog = { id: string; email: string; displayName: string | null; browser: string; os: string; timestamp: { toDate: () => Date } | null; photoURL?: string | null; };

/** The last 30 sign-ins (Activity). */
export function SignInActivity() {
  const appReady = useAppReady();
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
  return (
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
  );
}

/** Settings → Data → Restore shop defaults: this house's own name, address and number (and gold.pk's gold, for a gold house). */
export function RestoreDefaults() {
  const { toast } = useToast();
  const updateSettingsAction = useAppStore(state => state.updateSettings);
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

  return (
    <SettingRow
      title="Restore shop defaults"
      description={`Resets the shop name, address and number to ${STORE_CONFIG.name}'s own${STORE_CONFIG.defaultMetal === 'gold' ? ', and the gold rates to gold.pk' : ''}. No orders or invoices are touched.`}
    >
      <Button type="button" variant="outline" size="sm" onClick={handleRestoreSettings} disabled={isRestoring}>
        {isRestoring ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
        Restore
      </Button>
    </SettingRow>
  );
}
