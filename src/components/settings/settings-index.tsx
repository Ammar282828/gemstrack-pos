"use client";

/**
 * Settings as the app draws it, for a phone (docs/features/web-matches-app.md d.6): who is signed
 * in, then a row for each of Settings' places, each with a coloured rounded-square icon, then
 * Sign out. The rows come from the registry (lib/nav.ts SETTINGS.tabs), so a place added there
 * appears here; only the Shop row points at its own page (/settings/shop), since /settings is
 * this list on a phone.
 */

import React from 'react';
import Link from 'next/link';
import { ChevronRight, LogOut } from 'lucide-react';
import { SETTINGS, forRole, SETTINGS_SHOP_HREF } from '@/lib/nav';
import { useAuth } from '@/components/auth/google-auth-gate';
import { useAppStore } from '@/lib/store';
import { STORE_CONFIG } from '@/lib/store-config';
import { toneClasses, type Tone } from '@/components/ledger';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/** The app's coloured squares, by the tones the kit has (a house-coloured square for Integrations). */
const SQUARE: Record<string, Tone> = {
  '/settings': 'working',
  '/settings/alerts': 'late',
  '/settings/payment-methods': 'settled',
  '/settings/integrations': 'house',
  '/settings/data': 'quiet',
  '/activity-log': 'credit',
  '/settings/voice': 'owed',
};


export function SettingsIndex({ className }: { className?: string }) {
  const { user, signOut } = useAuth();
  const settings = useAppStore(s => s.settings);
  const [confirming, setConfirming] = React.useState(false);

  const entry = forRole(SETTINGS, 'owner');
  const tabs = entry?.tabs ?? [];
  const shopName = settings.shopName || STORE_CONFIG.name;
  const name = user?.displayName || user?.email || 'Owner';
  // The rows in Settings' sections (lib/nav.ts: Shop, Connections, Records), each its own card under its heading.
  const sections = [...new Set(tabs.map(t => t.section ?? ''))];
  const groups = sections.map(sec => ({ sec, rows: tabs.filter(t => (t.section ?? '') === sec) })).filter(g => g.rows.length > 0);

  return (
    <div className={cn('space-y-[22px]', className)}>
      <div className="flex items-center gap-3.5 rounded-card bg-card p-4">
        <span aria-hidden className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-primary font-serif text-ios-title2 font-semibold text-primary-foreground">
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-ios-headline font-semibold">{name}</p>
          {user?.displayName && user.email && <p className="truncate text-ios-sub text-muted-foreground">{user.email}</p>}
          <p className="truncate text-ios-sub text-muted-foreground">Owner · {shopName}</p>
        </div>
      </div>

      {groups.map(({ sec, rows }) => (
        <div key={sec} className="space-y-1.5">
        {sec && <p className="px-4 text-ios-foot uppercase tracking-wide text-muted-foreground">{sec}</p>}
        <ul className="overflow-hidden rounded-card bg-card divide-y divide-separator">
          {rows.map(t => {
            const Icon = t.icon ?? SETTINGS.icon;
            const tone = toneClasses(SQUARE[t.href] ?? 'quiet');
            return (
              <li key={t.href}>
                <Link href={t.href === '/settings' ? SETTINGS_SHOP_HREF : t.href}
                  className="flex min-h-[56px] items-center gap-3 px-4 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
                  <span aria-hidden className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[9px] [&>svg]:h-[18px] [&>svg]:w-[18px]', tone.solid)}>
                    <Icon />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[17px]">{t.label}</span>
                  <ChevronRight aria-hidden className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
                </Link>
              </li>
            );
          })}
        </ul>
        </div>
      ))}

      <div>
        <button type="button" onClick={() => setConfirming(true)}
          className="flex min-h-[56px] w-full items-center gap-3 rounded-card bg-card px-4 text-left text-[17px] text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <LogOut aria-hidden className="h-[18px] w-[18px]" />Sign out
        </button>
        <p className="px-4 pt-2 text-ios-foot text-muted-foreground">{shopName}</p>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out of {shopName}?</AlertDialogTitle>
            <AlertDialogDescription>You will need to sign in with Google again to open the ERP on this device.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void signOut(); }}>Sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
