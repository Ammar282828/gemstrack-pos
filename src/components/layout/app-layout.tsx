
"use client";

// Polyfill for structuredClone for older browsers like Safari
if (typeof window !== 'undefined' && typeof window.structuredClone !== 'function') {
  console.log('[TaheriPOS] structuredClone not found. Applying basic polyfill.');
  window.structuredClone = function(value: any) {
    if (value === undefined) {
        return undefined;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (e) {
        console.error("TaheriPOS: structuredClone polyfill (JSON.parse(JSON.stringify)) failed:", e);
        return value; 
    }
  };
}

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarInset,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Home, PackagePlus, ShoppingCart, Settings as SettingsIcon, Users, Gem, ScanQrCode, TrendingUp, Briefcase } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsStoreHydrated } from '@/lib/store';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  { href: '/', label: 'Home', icon: <Home /> },
  { href: '/scan', label: 'Scan QR / POS', icon: <ScanQrCode /> },
  { href: '/cart', label: 'Cart / Invoice', icon: <ShoppingCart /> },
  { href: '/products', label: 'Products', icon: <Gem /> },
  { href: '/products/add', label: 'Add Product', icon: <PackagePlus /> },
  { href: '/customers', label: 'Customers', icon: <Users /> },
  { href: '/karigars', label: 'Karigars', icon: <Briefcase /> },
  { href: '/analytics', label: 'Analytics', icon: <TrendingUp /> },
  { href: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHydrated = useIsStoreHydrated();
  console.log(`[GemsTrack] AppLayout: Rendering. Store hydrated: ${isHydrated}`);


  if (!isHydrated) {
    console.log("[GemsTrack] AppLayout: Store NOT hydrated, rendering null.");
    return null; 
  }
  
  console.log("[GemsTrack] AppLayout: Store IS hydrated, rendering layout.");
  return (
    <SidebarProvider defaultOpen={true}>
      <Sidebar collapsible="icon" variant="sidebar" side="left" className="border-r">
        <SidebarHeader className="p-4">
          <Link href="/" className="flex items-center gap-2">
            <Gem className="w-8 h-8 text-primary" />
            <h1 className="text-xl font-semibold text-primary group-data-[collapsible=icon]:hidden">
              Taheri
            </h1>
          </Link>
        </SidebarHeader>
        <Separator />
        <SidebarContent asChild>
          <ScrollArea className="h-full">
            <SidebarMenu className="p-2">
              {navItems.map((item) => (
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
              ))}
            </SidebarMenu>
          </ScrollArea>
        </SidebarContent>
        <Separator />
        <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
          <div className="group-data-[collapsible=icon]:hidden text-xs text-muted-foreground">
            © {new Date().getFullYear()} Taheri
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-40 flex items-center justify-between h-16 px-4 bg-background/80 backdrop-blur-sm border-b md:px-6">
          <SidebarTrigger className="md:hidden" />
          <div className="flex-1 text-center md:text-left">
          </div>
        </header>
        <main className="flex-1 p-4 overflow-auto md:p-6">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
