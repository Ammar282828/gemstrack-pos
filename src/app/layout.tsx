
"use client";

import { usePathname } from 'next/navigation';
import { Inter } from 'next/font/google'; 
import './globals.css';
import AppLayout from '@/components/layout/app-layout';
import { Toaster } from "@/components/ui/toaster";
import { MainApp } from '@/components/layout/main-app';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import React, { useEffect } from 'react';
import Script from 'next/script';
import { GoogleAuthGate } from '@/components/auth/google-auth-gate';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

function AppBody({ children }: { children: React.ReactNode }) {
  const isHydrated = useIsStoreHydrated();
  const theme = useAppStore(state => state.settings.theme);
  const pathname = usePathname();

  // Determine if the current page is the public invoice view
  const isPublicInvoicePage = pathname.startsWith('/view-invoice');

  // Render with the saved theme immediately (read from localStorage synchronously)
  // so there is no flash of the default light theme before Zustand rehydrates.
  if (!isHydrated) {
    let earlyTheme = 'slate';
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('gemstrack-pos-storage');
        if (stored) earlyTheme = JSON.parse(stored)?.state?.settings?.theme ?? 'slate';
      } catch {}
    }
    return (
      <body suppressHydrationWarning className={`${inter.variable} font-sans antialiased theme-${earlyTheme}`}>
      </body>
    );
  }

  return (
    <body className={`${inter.variable} font-sans antialiased theme-${theme}`}>
      {isPublicInvoicePage ? (
        // For public pages, render children directly without the main app layout
        <>
          {children}
          <Toaster />
        </>
      ) : (
        // For internal app pages, wrap with the full layout and auth providers
        <GoogleAuthGate>
          <AppLayout>
              <MainApp>
                {children}
              </MainApp>
          </AppLayout>
        </GoogleAuthGate>
      )}
      {!isPublicInvoicePage && <Toaster />}
    </body>
  );
}


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        <title>MINA</title>
        <meta name="description" content="Jewellery Inventory & Point-of-Sale System" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Dynamic theme-color will be handled by the theme logic, but we can set a default */}
        <meta name="theme-color" content="#0d1a16" />
        <Script src="https://unpkg.com/zebra-browser-print-wrapper@3.0.0/js/zebra_browser_print_wrapper.js" type="text/javascript"></Script>
      </head>
      <AppBody>
        {children}
      </AppBody>
    </html>
  );
}
