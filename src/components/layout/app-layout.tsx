

"use client";

import type { ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, SidebarInset,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Home, Package, ShoppingCart, Settings as SettingsIcon, Users, Gem, ScanQrCode, TrendingUp, Briefcase, ArchiveRestore, ClipboardList, Calendar, BookUser, CreditCard } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore, useIsStoreHydrated } from '@/lib/store';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  isSeparator?: boolean;
}

const navItems: NavItem[] = [
  // Point of Sale
  { href: '/', label: 'Home', icon: <Home /> },
  { href: '/scan', label: 'Scan / POS', icon: <ScanQrCode /> },
  { href: '/cart', label: 'Cart / Estimate', icon: <ShoppingCart /> },

  { isSeparator: true, href: '#', label: '', icon: <></> },

  // Management
  { href: '/orders', label: 'Orders', icon: <ClipboardList /> },
  { href: '/calendar', label: 'Calendar', icon: <Calendar /> },
  { href: '/products', label: 'Products', icon: <Gem /> },
  { href: '/customers', label: 'Customers', icon: <Users /> },
  { href: '/karigars', label: 'Karigars', icon: <Briefcase /> },
  { href: '/hisaab', label: 'Hisaab / Ledger', icon: <BookUser /> },
  { href: '/expenses', label: 'Expenses', icon: <CreditCard /> },


  { isSeparator: true, href: '#', label: '', icon: <></> },
  
  // System
  { href: '/analytics', label: 'Analytics', icon: <TrendingUp /> },
  { href: '/settings', label: 'Settings', icon: <SettingsIcon /> },
  { href: '/settings/backups', label: 'Backups', icon: <ArchiveRestore /> },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStoreHydrated = useIsStoreHydrated();
  const settings = useAppStore(state => state.settings);

  // We only render the layout shell. Data loading and authorization happen inside.
  if (!isStoreHydrated) {
    // Render nothing until the persisted state (cart) is rehydrated from localStorage
    // This prevents a flash of empty cart on page load.
    return null; 
  }
  
  const logoToUse = settings.theme === 'default' 
    ? settings.shopLogoUrlBlack || settings.shopLogoUrl 
    : settings.shopLogoUrl;

  return (
      <SidebarProvider defaultOpen={true}>
        <Sidebar collapsible="icon" variant="sidebar" side="left" className="border-r">
          <SidebarHeader className="p-4">
            <Link href="/" className="flex items-center gap-2">
              <Image src={logoToUse || "https://placehold.co/100x25.png"} alt="Shop Logo" width={100} height={25} className="group-data-[collapsible=icon]:hidden object-contain" data-ai-hint="logo" />
              <Gem className="w-8 h-8 text-primary hidden group-data-[collapsible=icon]:block" />
            </Link>
          </SidebarHeader>
          <Separator />
          <SidebarContent asChild>
            <ScrollArea className="h-full">
              <SidebarMenu className="p-2">
                {navItems.map((item, index) => (
                   item.isSeparator ? (
                    <SidebarMenuItem key={`sep-${index}`} className="my-1">
                      <Separator />
                    </SidebarMenuItem>
                  ) : (
                  <SidebarMenuItem key={item.href}>
                    <Link href={item.href} legacyBehavior passHref>
                      <SidebarMenuButton
                        asChild
                        isActive={pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))}
                        tooltip={{ children: item.label, className: "group-data-[collapsible=icon]:block hidden" }}
                        className="justify-start"
                      >
                        <a>
                          {item.icon}
                          <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                        </a>
                      </SidebarMenuButton>
                    </Link>
                  </SidebarMenuItem>
                  )
                ))}
              </SidebarMenu>
            </ScrollArea>
          </SidebarContent>
          <Separator />
          <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
            <div className="group-data-[collapsible=icon]:hidden text-xs text-muted-foreground">
              © {new Date().getFullYear()}
            </div>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="sticky top-0 z-40 flex items-center justify-between h-16 px-4 bg-background/80 backdrop-blur-sm border-b md:px-6">
            <SidebarTrigger className="md:hidden" />
            <div className="flex-1 text-center md:text-left">
              {/* Header content can go here if needed in the future */}
            </div>
          </header>
          <main className="flex-1 p-4 overflow-auto md:p-6">
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
  );
}
