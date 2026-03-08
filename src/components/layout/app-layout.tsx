
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
import { Home, ShoppingCart, Settings as SettingsIcon, Users, Gem, ScanQrCode, TrendingUp, Briefcase, ArchiveRestore, ClipboardList, Calendar, BookUser, CreditCard, FileText, Landmark, History, Calculator, LogOut, HandCoins, WifiOff } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
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
      { href: '/scan', label: 'Scan / POS', icon: <ScanQrCode /> },
      { href: '/cart', label: 'Cart / Estimate', icon: <ShoppingCart /> },
      { href: '/orders', label: 'Orders', icon: <ClipboardList /> },
      { href: '/quotations', label: 'Quotation Gen', icon: <Calculator /> },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/products', label: 'Products', icon: <Gem /> },
      { href: '/customers', label: 'Customers', icon: <Users /> },
      { href: '/karigars', label: 'Karigars', icon: <Briefcase /> },
      { href: '/documents', label: 'Documents', icon: <FileText /> },
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
  const cartCount = useAppStore(state => state.cart.length);
  const { user, signOut } = useAuth();
  const [isOnline, setIsOnline] = useState(true);

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

  const logoToUse = settings.theme === 'default'
    ? settings.shopLogoUrlBlack || settings.shopLogoUrl
    : settings.shopLogoUrl;

  const bottomNavItems = [
    { href: '/',       label: 'Home',   icon: <Home className="w-5 h-5" /> },
    { href: '/scan',   label: 'Scan',   icon: <ScanQrCode className="w-5 h-5" /> },
    { href: '/cart',   label: 'Cart',   icon: <ShoppingCart className="w-5 h-5" />, badge: cartCount },
    { href: '/orders', label: 'Orders', icon: <ClipboardList className="w-5 h-5" /> },
    { href: '/hisaab', label: 'Hisaab', icon: <BookUser className="w-5 h-5" /> },
  ];

  return (
      <SidebarProvider defaultOpen={true}>
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
                  <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70 px-3 pb-1 group-data-[collapsible=icon]:hidden">
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
                  {user.displayName && <p className="text-[10px] text-muted-foreground truncate leading-tight">{user.email}</p>}
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
          <header className="sticky top-0 z-40 flex items-center h-14 px-4 bg-background/80 backdrop-blur-sm border-b md:px-6">
            <SidebarTrigger className="md:hidden" />
          </header>

          {/* Offline banner */}
          {!isOnline && (
            <div className="flex items-center justify-center gap-2 px-4 py-2 bg-yellow-500 text-yellow-950 text-sm font-medium">
              <WifiOff className="w-4 h-4 flex-shrink-0" />
              You're offline — changes will sync when reconnected.
            </div>
          )}

          {/* Extra bottom padding on mobile so content clears the bottom nav */}
          <main className="flex-1 p-4 overflow-auto md:p-6 pb-20 md:pb-6">
            {children}
          </main>

          {/* Bottom nav — mobile only */}
          <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch bg-background border-t h-16 safe-area-inset-bottom">
            {bottomNavItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="relative">
                    {item.icon}
                    {item.badge ? (
                      <span className="absolute -top-1 -right-2 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-none">
                        {item.badge}
                      </span>
                    ) : null}
                  </span>
                  <span>{item.label}</span>
                  {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-primary" />}
                </Link>
              );
            })}
          </nav>
        </SidebarInset>
      </SidebarProvider>
  );
}
