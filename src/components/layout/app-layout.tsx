
"use client";

import type { ReactNode } from 'react';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, SidebarInset,
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarSeparator, useSidebar,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Gem, LogOut, WifiOff, Search, Sun, Moon } from 'lucide-react';
import { NEW_SALE, SETTINGS, sidebarFor, forRole, locate, type NavEntry } from '@/lib/nav';
import { useWorkDrafts } from '@/components/drafts/use-work-drafts';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { CommandPalette, openCommandPalette } from '@/components/search/command-palette';
import { VoiceBubble } from '@/components/voice/voice-bubble';
import { STORE_LOGO_URL, STORE_LOGO_LIGHT_URL, STORE_LOGO_SIDEBAR_HEIGHT } from '@/lib/store-config';
import Image from 'next/image';
import { useAuth } from '@/components/auth/google-auth-gate';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useScrolled } from '@/lib/use-scrolled';
import { roleForEmail } from '@/lib/roles';
import { devRole, captureDevRole } from '@/lib/dev-role';
import { writeDeviceTheme } from '@/lib/theme-cache';
import { RateChip, RateSheet } from '@/components/rates/rate-chip';

// The sidebar, the top bar's tabs and the palette all come from one registry (lib/nav.ts): a page is
// added there or it is nowhere, and nav.test.ts fails when they drift.

/**
 * Light / dark for THIS device, in the top bar. Switches at once and is kept on the
 * device; the shop's mode in Settings only decides devices that have never chosen.
 * Reads the mode off <html>, which the layout keeps in step with what is shown.
 */
function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const read = () => setDark(html.classList.contains('dark'));
    read();
    const mo = new MutationObserver(read);
    mo.observe(html, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return (
    <button
      type="button"
      onClick={() => writeDeviceTheme(dark ? 'default' : 'taheri')}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode (this device)' : 'Dark mode (this device)'}
      className="glass-ctl rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}

/**
 * Search, at the top of the sidebar: the Ctrl+K palette (any customer, karigar,
 * piece or screen) for anyone who doesn't know the shortcut, or is on a phone.
 * Looks like a search box when the sidebar is open, a magnifier when it is folded.
 */
function SidebarSearch() {
  const { isMobile, setOpenMobile } = useSidebar();
  return (
    <SidebarMenu className="px-2 pt-1">
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => { if (isMobile) setOpenMobile(false); openCommandPalette(); }}
          tooltip={{ children: 'Search (⌘K)' }}
          className="sidebar-search justify-start gap-3 rounded-lg border border-input bg-background text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:border-0"
        >
          <Search />
          <span className="flex-1 group-data-[collapsible=icon]:hidden">Search</span>
          <kbd className="rounded border bg-muted px-1.5 font-sans text-2xs text-muted-foreground group-data-[collapsible=icon]:hidden">⌘K</kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStoreHydrated = useIsStoreHydrated();
  const settings = useAppStore(state => state.settings);
  const { user, signOut } = useAuth();
  // Drafts waiting, for the count beside Drafts in the sidebar.
  const { drafts } = useWorkDrafts();
  const draftCount = drafts.length;
  const [isOnline, setIsOnline] = useState(true);
  // Restore the last sidebar state. The provider writes sidebar_state on
  // every toggle but only reads defaultOpen once, so a hardcoded `true` threw
  // the choice away on each reload. Must sit above the early return below —
  // a hook after a conditional return is a Rules-of-Hooks violation.
  const [sidebarDefaultOpen] = useState(() => {
    if (typeof document === 'undefined') return true;
    const m = document.cookie.match(/(?:^|;\s*)sidebar_state=([^;]+)/);
    return m ? m[1] !== 'false' : true;
  });

  // `?as=staff` is remembered for the tab, so it survives navigation.
  useEffect(() => { captureDevRole(); }, []);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // The glass top bar's scroll edge shows only once content passes beneath it. Above the early
  // return below: a hook after it changes the hook count the render the store hydrates.
  const scrolled = useScrolled('.app-inset > main');

  if (!isStoreHydrated) return null;

  // Staff see only what they can actually reach. This is presentation, not
  // protection — the boundary is firestore.rules — but a menu full of doors
  // that error on opening is its own kind of broken.
  const role = devRole() ?? roleForEmail(user?.email);
  const isStaff = role === 'staff';
  const visibleGroups = sidebarFor(isStaff);
  const settingsEntry = forRole(SETTINGS, isStaff);
  const newSaleEntry = forRole(NEW_SALE, isStaff);

  // This page's row and the tab it lights (a detail page lights the tab it sits under); the top bar
  // shows the row's tabs whenever there is more than one to choose between.
  const entries: NavEntry[] = [...visibleGroups.flatMap(g => g.entries), ...(settingsEntry ? [settingsEntry] : [])];
  const here = locate(pathname, entries);
  const pageTabs = here?.tab && here.entry.tabs && here.entry.tabs.length > 1 ? here.entry.tabs : null;

  const logoToUse = STORE_LOGO_URL;

  return (
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        {/* Ctrl+K from anywhere. Listens on document, renders nothing until opened. */}
        <CommandPalette />
        {/* The microphone floats over every screen. */}
        <VoiceBubble />
        {/* The rate form, opened by the top bar's chip (or openRateSheet()). */}
        <RateSheet />
        <Sidebar collapsible="icon" variant="sidebar" side="left" className="border-r">
          <SidebarHeader className="p-4 pb-3">
            <Link href="/" className="flex items-center justify-start text-primary h-[26px]">
              {logoToUse ? (
                 <div className="relative w-full group-data-[collapsible=icon]:hidden" style={{ height: STORE_LOGO_SIDEBAR_HEIGHT }}>
                    {/* The wordmark is flat charcoal, drawn for a light ground. On the
                        dark palette it sat two shades above the page — a grey smudge —
                        while the white cut made for exactly that went unused. Both are
                        here; the theme class on <body> shows one. (`dark:` cannot do
                        this: <html> always carries `.dark`, see globals.css.) */}
                    <Image
                        src={logoToUse}
                        alt={settings.shopName || 'Shop Logo'}
                        fill
                        className="object-contain object-left hidden [.theme-default_&]:block"
                        unoptimized
                    />
                    <Image
                        src={STORE_LOGO_LIGHT_URL}
                        alt=""
                        aria-hidden
                        fill
                        className="object-contain object-left [.theme-default_&]:hidden"
                        unoptimized
                    />
                 </div>
              ) : (
                 <span className="font-bold text-lg tracking-tight group-data-[collapsible=icon]:hidden">{settings.shopName || "Taheri"}</span>
              )}
               <Gem className="w-6 h-6 text-primary hidden group-data-[collapsible=icon]:block" />
            </Link>
          </SidebarHeader>

          <SidebarSearch />
          {newSaleEntry && (
            <SidebarMenu className="px-2 pt-2">
              <SidebarMenuItem>
                <Link href={newSaleEntry.href} legacyBehavior passHref>
                  <SidebarMenuButton asChild tooltip={{ children: newSaleEntry.label }}
                    className="glass-prominent justify-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground">
                    <a><newSaleEntry.icon /><span className="group-data-[collapsible=icon]:hidden">{newSaleEntry.label}</span></a>
                  </SidebarMenuButton>
                </Link>
              </SidebarMenuItem>
            </SidebarMenu>
          )}

          <SidebarContent asChild>
            <ScrollArea className="h-full">
              {visibleGroups.map((group, gi) => (
                <SidebarGroup key={group.key} className={gi === 0 ? 'pt-2' : 'pt-0'}>
                  {group.label && (
                    <SidebarGroupLabel className="sidebar-group-label text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70 px-3 pb-1 group-data-[collapsible=icon]:hidden">
                      {group.label}
                    </SidebarGroupLabel>
                  )}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.entries.map((item) => {
                        const isActive = here?.entry.id === item.id;
                        return (
                          <SidebarMenuItem key={item.id}>
                            <Link href={item.href} legacyBehavior passHref>
                              <SidebarMenuButton
                                asChild
                                isActive={isActive}
                                tooltip={{ children: item.label }}
                                className="justify-start gap-3 rounded-lg"
                              >
                                <a className={cn(isActive && 'font-medium')}>
                                  <item.icon />
                                  <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                                  {item.count === 'drafts' && draftCount > 0 && (
                                    <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold leading-5 text-primary group-data-[collapsible=icon]:hidden">{draftCount}</span>
                                  )}
                                </a>
                              </SidebarMenuButton>
                            </Link>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                  {gi < visibleGroups.length - 1 && (
                    <SidebarSeparator className="mt-2 group-data-[collapsible=icon]:hidden" />
                  )}
                </SidebarGroup>
              ))}
            </ScrollArea>
          </SidebarContent>

          <Separator />
          <SidebarFooter className="p-3">
            {settingsEntry && (
              <SidebarMenu className="mb-1">
                <SidebarMenuItem>
                  <Link href={settingsEntry.href} legacyBehavior passHref>
                    <SidebarMenuButton asChild isActive={here?.entry.id === settingsEntry.id} tooltip={{ children: 'Settings' }} className="justify-start gap-3 rounded-lg">
                      <a className={cn(here?.entry.id === settingsEntry.id && 'font-medium')}>
                        <settingsEntry.icon />
                        <span className="group-data-[collapsible=icon]:hidden">Settings</span>
                      </a>
                    </SidebarMenuButton>
                  </Link>
                </SidebarMenuItem>
              </SidebarMenu>
            )}
            {user && (
              <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
                <Avatar className="h-7 w-7 flex-shrink-0 ring-2 ring-border">
                  <AvatarImage src={user.photoURL ?? undefined} />
                  <AvatarFallback className="text-xs font-semibold">{user.displayName?.[0] ?? user.email?.[0] ?? '?'}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                  <p className="text-xs font-semibold truncate leading-tight">{user.displayName || user.email}</p>
                  {user.displayName && <p className="text-2xs text-muted-foreground truncate leading-tight">{user.email}</p>}
                </div>
                <button
                  onClick={signOut}
                  title="Sign out"
                  className="group-data-[collapsible=icon]:hidden p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {user && (
              <button
                onClick={signOut}
                title="Sign out"
                className="hidden group-data-[collapsible=icon]:flex items-center justify-center p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors mt-1"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="app-inset">
          <header data-scrolled={scrolled || undefined} className="app-header sticky top-0 z-40 flex items-center gap-2 h-14 px-4 bg-background/80 backdrop-blur-sm border-b md:px-6">
            {/* Was md:hidden, which meant the sidebar could collapse to icons
                on paper but there was no way to trigger it on a desktop. On a
                1280px screen the rail is a fifth of the width; collapsing it
                is what makes the wide tables fit. Cmd/Ctrl+B also toggles. */}
            <SidebarTrigger className="glass-ctl" />
            <span className="hidden lg:inline text-2xs text-muted-foreground">⌘B</span>
            {/* The page's siblings (lib/nav.ts): one sidebar entry, several pages. */}
            {pageTabs && (
              <nav aria-label={`${here?.entry.label} pages`} className="app-tabs ml-2 flex min-w-0 items-center gap-1 overflow-x-auto self-stretch">
                {pageTabs.map(t => {
                  const on = t.href === here?.tab?.href;
                  return (
                    <Link
                      key={t.href}
                      href={t.href}
                      aria-current={on ? 'page' : undefined}
                      className={cn(
                        'app-tab relative flex h-full shrink-0 items-center whitespace-nowrap px-3 text-sm transition-colors',
                        on ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t.label}
                      {on && <span aria-hidden className="tab-underline absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
                    </Link>
                  );
                })}
              </nav>
            )}
            <div className="ml-auto -mr-1 flex shrink-0 items-center">
            {/* The shop's rate and when it was set, on every page. */}
            <RateChip />
            <ThemeToggle />
            {/* On a phone the sidebar is behind a tap; search is one tap from here. */}
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label="Search"
              className="glass-ctl rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            >
              <Search className="h-5 w-5" />
            </button>
            </div>
          </header>

          {/* Offline banner */}
          {!isOnline && (
            <div className="flex items-center justify-center gap-2 px-4 py-2 bg-warning text-warning text-sm font-medium">
              <WifiOff className="w-4 h-4 flex-shrink-0" />
              You're offline — changes will sync when reconnected.
            </div>
          )}

          <main className="flex-1 min-w-0 p-4 overflow-auto md:p-6">
            {children}
          </main>

        </SidebarInset>
      </SidebarProvider>
  );
}
