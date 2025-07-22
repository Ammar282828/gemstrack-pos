
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
import { Home, PackagePlus, ShoppingCart, Settings as SettingsIcon, Users, Gem, ScanQrCode, TrendingUp, Briefcase } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useIsStoreHydrated } from '@/lib/store';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isStoreHydrated = useIsStoreHydrated();

  // We only render the layout shell. Data loading and authorization happen inside.
  if (!isStoreHydrated) {
    // Render nothing until the persisted state (cart) is rehydrated from localStorage
    // This prevents a flash of empty cart on page load.
    return null; 
  }
  
  return (
      <SidebarProvider defaultOpen={true}>
        <Sidebar collapsible="icon" variant="sidebar" side="left" className="border-r">
          <SidebarHeader className="p-4">
            <Link href="/" className="flex items-center gap-2">
              <Image src="https://placehold.co/100x25/F1F1E8/081818.png?text=Taheri" alt="Taheri Logo" width={100} height={25} className="group-data-[collapsible=icon]:hidden" data-ai-hint="logo" />
              <Gem className="w-8 h-8 text-primary hidden group-data-[collapsible=icon]:block" />
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
