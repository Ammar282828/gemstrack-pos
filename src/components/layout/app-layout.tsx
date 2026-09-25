
"use client";

import type { ReactNode } from 'react';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, SidebarInset,
  SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarSeparator,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Home, PlusCircle, Settings as SettingsIcon, Users, Gem, TrendingUp, ClipboardList, LogOut, WifiOff, Hammer, Receipt, Wrench, Globe, Wallet } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { CommandPalette } from '@/components/search/command-palette';
import { VoiceBubble } from '@/components/voice/voice-bubble';
import { STORE_LOGO_URL, STORE_LOGO_LIGHT_URL, STORE_LINKS, STORE_PARTNERSHIP, STORE_WEBSITE_WEIGHTS } from '@/lib/store-config';
import Image from 'next/image';
import { useAuth } from '@/components/auth/google-auth-gate';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { roleForEmail } from '@/lib/roles';
import { devRole, captureDevRole } from '@/lib/dev-role';

/** A page that shares a sidebar entry with its siblings, shown as a tab in the top bar. */
interface NavTab {
  href: string;
  label: string;
  /** Reachable by shop-floor staff. Absent means owners only. */
  staff?: true;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  /** Reachable by shop-floor staff. Absent means owners only. */
  staff?: true;
  /** Sibling pages under this one entry. The entry opens the first one the
   *  person can see; the top bar shows them all as tabs. */
  tabs?: NavTab[];
}

interface NavGroup {
  /** Empty for the first group: the daily pages need no heading. */
  label: string;
  items: NavItem[];
}

/**
 * Twelve entries, not twenty-four (the owner, 2026-09-25: "way too crowded").
 *
 * Pages that are siblings share one entry and appear as tabs in the top bar —
 * Workshop / Karigars / Given items, the four money books, the website's photo
 * pages, the settings pages — and Settings sits in the footer as a gear. Every
 * page keeps its own address, so links and bookmarks land on the right tab, and
 * Ctrl+K still finds any page by name.
 *
 * Ordered within each group by how often you reach for it.
 */
const navGroups: NavGroup[] = [
  {
    label: '',
    items: [
      { staff: true, href: '/', label: 'Home', icon: <Home />, tabs: [
        { staff: true, href: '/', label: 'Dashboard' },
        { staff: true, href: '/calendar', label: 'Calendar' },
      ] },
      // One way in: pick invoice or order first, then add the pieces.
      // /scan and /cart are still reachable, just not decisions of their own.
      { staff: true, href: '/new', label: 'New Sale', icon: <PlusCircle /> },
      { staff: true, href: '/orders', label: 'Orders', icon: <ClipboardList /> },
      { staff: true, href: '/invoices', label: 'Invoices', icon: <Receipt /> },
      { staff: true, href: '/repairs', label: 'Repairs', icon: <Wrench /> },
      { staff: true, href: '/customers', label: 'Customers', icon: <Users /> },
    ],
  },
  {
    label: 'Workshop & website',
    items: [
      { staff: true, href: '/workshop', label: 'Workshop', icon: <Hammer />, tabs: [
        { staff: true, href: '/workshop', label: 'Jobs' },
        { staff: true, href: '/karigars', label: 'Karigars' },
        { staff: true, href: '/given', label: 'Given items' },
      ] },
      // The website pages exist only for a shop that has one (NEXT_PUBLIC_STORE_WEBSITE_URL).
      ...(STORE_LINKS.website ? ([
        { staff: true, href: '/website/photos', label: 'Website', icon: <Globe />, tabs: [
          { staff: true, href: '/website/photos', label: 'Add Photos' },
          ...(STORE_WEBSITE_WEIGHTS ? [{ staff: true, href: '/website/weights', label: 'Photo Weights' }] : []),
        ] as NavTab[] },
      ] as NavItem[]) : []),
    ],
  },
  {
    label: 'Money',
    items: [
      { href: '/expenses', label: 'Money', icon: <Wallet />, tabs: [
        { href: '/expenses', label: 'Expenses' },
        { href: '/additional-revenue', label: 'Extra revenue' },
        { href: '/overheads', label: 'Overheads' },
        { href: '/hisaab', label: 'Hisaab' },
        // The partnership book, for the shop that has partners (NEXT_PUBLIC_STORE_PARTNERSHIP).
        ...(STORE_PARTNERSHIP ? [{ href: '/shareholders', label: 'Shareholders' }] : []),
      ] as NavTab[] },
      { href: '/analytics', label: 'Analytics', icon: <TrendingUp /> },
    ],
  },
];

/** Settings, pinned to the footer as a gear rather than a group of its own. */
const settingsItem: NavItem = {
  href: '/settings', label: 'Settings', icon: <SettingsIcon />, tabs: [
    { href: '/settings', label: 'Settings' },
    { href: '/settings/payment-methods', label: 'Payment methods' },
    { href: '/settings/backups', label: 'Backups' },
    { href: '/settings/voice', label: 'Voice' },
    { href: '/activity-log', label: 'Activity log' },
  ],
};

/** Is this page `href` or one beneath it? ('/' only matches itself.) */
const within = (pathname: string, href: string) =>
  pathname === href || (href !== '/' && pathname.startsWith(href + '/'));

/** An entry is active on any of its tabs' pages and the pages beneath them. */
function isActiveItem(item: NavItem, pathname: string): boolean {
  if (!item.tabs) return within(pathname, item.href);
  // Settings' own tab ('/settings') must not claim its siblings' pages — they are all this entry's anyway.
  return item.tabs.some(t => within(pathname, t.href));
}

/** The person's view of an entry: only the tabs they can open, and the entry opens the first. */
function forRole(item: NavItem, staff: boolean): NavItem | null {
  if (staff && !item.staff) return null;
  if (!item.tabs) return item;
  const tabs = staff ? item.tabs.filter(t => t.staff) : item.tabs;
  if (!tabs.length) return null;
  return { ...item, href: tabs[0].href, tabs };
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStoreHydrated = useIsStoreHydrated();
  const settings = useAppStore(state => state.settings);
  const { user, signOut } = useAuth();
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

  if (!isStoreHydrated) return null;

  // Staff see only what they can actually reach. This is presentation, not
  // protection — the boundary is firestore.rules — but a menu full of doors
  // that error on opening is its own kind of broken.
  const role = devRole() ?? roleForEmail(user?.email);
  const isStaff = role === 'staff';
  const visibleGroups = navGroups
    .map(g => ({ ...g, items: g.items.map(i => forRole(i, isStaff)).filter((i): i is NavItem => !!i) }))
    .filter(g => g.items.length > 0);
  const settingsEntry = forRole(settingsItem, isStaff);

  // The tabs for this page, when it is one of an entry's siblings. Only on the
  // tab pages themselves — a detail page (/hisaab/…, /karigars/…) keeps its own
  // way back — and only when there is more than one to choose between.
  const current = [...visibleGroups.flatMap(g => g.items), ...(settingsEntry ? [settingsEntry] : [])]
    .find(i => i.tabs?.some(t => t.href === pathname));
  const pageTabs = current?.tabs && current.tabs.length > 1 ? current.tabs : null;

  const logoToUse = STORE_LOGO_URL;

  return (
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        {/* Ctrl+K from anywhere. Listens on document, renders nothing until opened. */}
        <CommandPalette />
        {/* The microphone floats over every screen. */}
        <VoiceBubble />
        <Sidebar collapsible="icon" variant="sidebar" side="left" className="border-r">
          <SidebarHeader className="p-4 pb-3">
            <Link href="/" className="flex items-center justify-start text-primary h-[26px]">
              {logoToUse ? (
                 <div className="relative w-full h-full group-data-[collapsible=icon]:hidden">
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

          <SidebarContent asChild>
            <ScrollArea className="h-full">
              {visibleGroups.map((group, gi) => (
                <SidebarGroup key={group.label || 'daily'} className={gi === 0 ? 'pt-2' : 'pt-0'}>
                  {group.label && (
                    <SidebarGroupLabel className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70 px-3 pb-1 group-data-[collapsible=icon]:hidden">
                      {group.label}
                    </SidebarGroupLabel>
                  )}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => {
                        const isActive = isActiveItem(item, pathname);
                        return (
                          <SidebarMenuItem key={item.href}>
                            <Link href={item.href} legacyBehavior passHref>
                              <SidebarMenuButton
                                asChild
                                isActive={isActive}
                                tooltip={{ children: item.label }}
                                className="justify-start gap-3 rounded-lg"
                              >
                                <a className={cn(isActive && 'font-medium')}>
                                  {item.icon}
                                  <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
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
                    <SidebarMenuButton asChild isActive={isActiveItem(settingsEntry, pathname)} tooltip={{ children: 'Settings' }} className="justify-start gap-3 rounded-lg">
                      <a className={cn(isActiveItem(settingsEntry, pathname) && 'font-medium')}>
                        {settingsEntry.icon}
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

        <SidebarInset>
          <header className="sticky top-0 z-40 flex items-center gap-2 h-14 px-4 bg-background/80 backdrop-blur-sm border-b md:px-6">
            {/* Was md:hidden, which meant the sidebar could collapse to icons
                on paper but there was no way to trigger it on a desktop. On a
                1280px screen the rail is a fifth of the width; collapsing it
                is what makes the wide tables fit. Cmd/Ctrl+B also toggles. */}
            <SidebarTrigger />
            <span className="hidden lg:inline text-2xs text-muted-foreground">⌘B</span>
            {/* The page's siblings (see navGroups): one sidebar entry, several pages. */}
            {pageTabs && (
              <nav aria-label={`${current?.label} pages`} className="ml-2 flex min-w-0 items-center gap-1 overflow-x-auto self-stretch">
                {pageTabs.map(t => {
                  const on = t.href === pathname;
                  return (
                    <Link
                      key={t.href}
                      href={t.href}
                      aria-current={on ? 'page' : undefined}
                      className={cn(
                        'relative flex h-full shrink-0 items-center whitespace-nowrap px-3 text-sm transition-colors',
                        on ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t.label}
                      {on && <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
                    </Link>
                  );
                })}
              </nav>
            )}
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
