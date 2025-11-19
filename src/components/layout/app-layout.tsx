
"use client";

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarFooter,
  SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarTrigger, SidebarInset,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Home, Package, ShoppingCart, Settings as SettingsIcon, Users, Gem, ScanQrCode, TrendingUp, Briefcase, ArchiveRestore, ClipboardList, Calendar, BookUser, CreditCard, FileText, ExternalLink, Landmark, History, Printer } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import Image from 'next/image';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  isSeparator?: boolean;
}

const navItems: NavItem[] = [
  // Dashboard
  { href: '/', label: 'Home', icon: <Home /> },

  { isSeparator: true, href: '#', label: '', icon: <></> },

  // Point of Sale & Orders
  { href: '/scan', label: 'Scan / POS', icon: <ScanQrCode /> },
  { href: '/cart', label: 'Cart / Estimate', icon: <ShoppingCart /> },
  { href: '/orders', label: 'Orders', icon: <ClipboardList /> },
  
  { isSeparator: true, href: '#', label: '', icon: <></> },
  
  // Management
  { href: '/products', label: 'Products', icon: <Gem /> },
  { href: '/customers', label: 'Customers', icon: <Users /> },
  { href: '/karigars', label: 'Karigars', icon: <Briefcase /> },
  { href: '/documents', label: 'Documents', icon: <FileText /> },
  { href: '/calendar', label: 'Calendar', icon: <Calendar /> },
  { href: '/expenses', label: 'Expenses', icon: <CreditCard /> },
  
  { isSeparator: true, href: '#', label: '', icon: <></> },

  // Financial
  { href: '/hisaab', label: 'Hisaab / Ledger', icon: <BookUser /> },
  { href: '/analytics', label: 'Analytics', icon: <TrendingUp /> },
  
  { isSeparator: true, href: '#', label: '', icon: <></> },
  
  // System
  { href: '/activity-log', label: 'Activity Log', icon: <History /> },
  { href: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStoreHydrated = useIsStoreHydrated();
  const settings = useAppStore(state => state.settings);

  if (!isStoreHydrated) {
    return null; 
  }
  
  const logoToUse = settings.theme === 'default' 
    ? settings.shopLogoUrlBlack || settings.shopLogoUrl 
    : settings.shopLogoUrl;


  return (
      <SidebarProvider defaultOpen={true}>
        <Sidebar collapsible="icon" variant="sidebar" side="left" className="border-r">
          <SidebarHeader className="p-4">
            <Link href="/" className="flex items-center justify-start text-primary h-[25px]">
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
                 <span className="font-bold text-lg group-data-[collapsible=icon]:hidden">{settings.shopName || "Taheri"}</span>
              )}
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
