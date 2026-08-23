
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
import { Home, PlusCircle, Settings as SettingsIcon, Users, Gem, TrendingUp, Briefcase, ArchiveRestore, ClipboardList, Calendar, BookUser, CreditCard, FileText, Landmark, History, LogOut, HandCoins, WifiOff, Hammer } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import { STORE_LOGO_URL } from '@/lib/store-config';
import Image from 'next/image';
import { useAuth } from '@/components/auth/google-auth-gate';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/', label: 'Home', icon: <Home /> },
    ],
  },
  {
    label: 'Point of Sale',
    items: [
      // One way in: pick invoice or order first, then add the pieces.
      // /scan and /cart are still reachable, just not decisions of their own.
      { href: '/new', label: 'New Sale', icon: <PlusCircle /> },
      { href: '/orders', label: 'Orders', icon: <ClipboardList /> },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/customers', label: 'Customers', icon: <Users /> },
      { href: '/karigars', label: 'Karigars', icon: <Briefcase /> },
      { href: '/workshop', label: 'Workshop', icon: <Hammer /> },
      { href: '/billing', label: 'Billing', icon: <FileText /> },
      { href: '/calendar', label: 'Calendar', icon: <Calendar /> },
      { href: '/expenses', label: 'Expenses', icon: <CreditCard /> },
      { href: '/additional-revenue', label: 'Extra Revenue', icon: <TrendingUp /> },
      { href: '/given', label: 'Given Items', icon: <HandCoins /> },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/hisaab', label: 'Hisaab / Ledger', icon: <BookUser /> },
      { href: '/analytics', label: 'Analytics', icon: <TrendingUp /> },
      { href: '/shareholders', label: 'Shareholder Finances', icon: <HandCoins /> },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/activity-log', label: 'Activity Log', icon: <History /> },
      { href: '/settings', label: 'Settings', icon: <SettingsIcon /> },
      { href: '/settings/payment-methods', label: 'Payment Methods', icon: <Landmark /> },
      { href: '/settings/backups', label: 'Backups', icon: <ArchiveRestore /> },
    ],
  },
];

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

  const logoToUse = STORE_LOGO_URL;

  return (
      <SidebarProvider defaultOpen={sidebarDefaultOpen}>
        <Sidebar collapsible="icon" variant="sidebar" side="left" className="border-r">
          <SidebarHeader className="p-4 pb-3">
            <Link href="/" className="flex items-center justify-start text-primary h-[26px]">
              {logoToUse ? (
                 <div className="relative w-full h-full group-data-[collapsible=icon]:hidden">
                    <Image
                        src={logoToUse}
                        alt={settings.shopName || 'Shop Logo'}
                        fill
                        className="object-contain object-left"
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
              {navGroups.map((group, gi) => (
                <SidebarGroup key={group.label} className={gi === 0 ? 'pt-2' : 'pt-0'}>
                  <SidebarGroupLabel className="text-2xs font-semibold uppercase tracking-widest text-muted-foreground/70 px-3 pb-1 group-data-[collapsible=icon]:hidden">
                    {group.label}
                  </SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => {
                        const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
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
                  {gi < navGroups.length - 1 && (
                    <SidebarSeparator className="mt-2 group-data-[collapsible=icon]:hidden" />
                  )}
                </SidebarGroup>
              ))}
            </ScrollArea>
          </SidebarContent>

          <Separator />
          <SidebarFooter className="p-3">
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
