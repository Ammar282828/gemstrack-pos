
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

  // TEMPORARY: Unregister all service workers to clear old cache from previous hosting setup
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
          registration.unregister();
        }
      });
    }
  }, []);

  // Render a placeholder or nothing until hydration is complete to avoid flash
  if (!isHydrated) {
    return (
      <body className={`${inter.variable} font-sans antialiased`}>
        {/* You can add a splash screen or loader here if desired */}
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
        <AppLayout>
            <MainApp>
              {children}
            </MainApp>
        </AppLayout>
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
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
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
