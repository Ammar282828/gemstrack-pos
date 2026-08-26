
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
import { STORE_CONFIG } from '@/lib/store-config';
import { readCachedTheme, writeCachedTheme } from '@/lib/theme-cache';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

function AppBody({ children }: { children: React.ReactNode }) {
  const isHydrated = useIsStoreHydrated();
  const theme = useAppStore(state => state.settings.theme);
  const hasSettingsLoaded = useAppStore(state => state.hasSettingsLoaded);
  const pathname = usePathname();

  // Determine if the current page is the public invoice view
  const isPublicInvoicePage = pathname.startsWith('/view-invoice');

  // Settings come from Firestore and are not persisted into the store, so on a
  // cold load nothing knows the theme until the network answers. The cached
  // hint covers that gap; without it the store's 'slate' default painted a
  // dark screen that flipped to white once settings arrived.
  const cachedTheme = React.useMemo(() => readCachedTheme(), []);

  // Keep the hint current for next time.
  React.useEffect(() => {
    if (hasSettingsLoaded && theme) writeCachedTheme(theme);
  }, [hasSettingsLoaded, theme]);

  if (!isHydrated) {
    return (
      <body suppressHydrationWarning className={`${inter.variable} font-sans antialiased theme-${cachedTheme}`}>
      </body>
    );
  }

  // Hydrated, but settings may still be in flight — keep showing the cached
  // theme rather than the store's default until the real one lands.
  const activeTheme = hasSettingsLoaded && theme ? theme : cachedTheme;

  return (
    <body className={`${inter.variable} font-sans antialiased theme-${activeTheme}`}>
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
        <title>{STORE_CONFIG.name}</title>
        <meta name="description" content="Jewellery Inventory & Point-of-Sale System" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Dynamic theme-color will be handled by the theme logic, but we can set a default */}
        <meta name="theme-color" content="#1a0e0e" />
        {/*
          Paint the right background before anything else runs.

          The theme lives in Firestore and is not persisted into the store, so
          React cannot know it during hydration — and it keeps the
          server-rendered class anyway. That left every cold load painting the
          store's 'slate' default, which is dark, before flipping to whatever
          the shop actually chose. This blocking script reads the cached hint
          and sets the page background itself, which is the part you see.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var t=localStorage.getItem('gemstrack:theme')||'default';
              document.documentElement.classList.add(t==='default'?'boot-light':'boot-dark');
            }catch(e){document.documentElement.classList.add('boot-light');}})();`,
          }}
        />
        <Script src="https://unpkg.com/zebra-browser-print-wrapper@3.0.0/js/zebra_browser_print_wrapper.js" type="text/javascript"></Script>
      </head>
      <AppBody>
        {children}
      </AppBody>
    </html>
  );
}
