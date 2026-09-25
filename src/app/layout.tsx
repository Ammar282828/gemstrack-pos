
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
import { STORE_CONFIG, STORE_BRAND, STORE_THEME_COLOR, isLinksHost } from '@/lib/store-config';
import { readCachedTheme, writeCachedTheme, LIGHT_THEME, readDeviceTheme, DEVICE_THEME_EVENT, applyThemeToDocument } from '@/lib/theme-cache';
import { warmPdfLogo } from '@/lib/pdf-logo';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

function AppBody({ children }: { children: React.ReactNode }) {
  const isHydrated = useIsStoreHydrated();
  const theme = useAppStore(state => state.settings.theme);
  const hasSettingsLoaded = useAppStore(state => state.hasSettingsLoaded);
  const pathname = usePathname();

  /**
   * Pages that render without the app shell or the auth gate.
   *
   * Two are for customers: a shared invoice, and the link page the QR on every printed
   * document points at — somebody scanning a code off a receipt must not meet a login.
   *
   */
  const isPublicPath = pathname.startsWith('/view-invoice')
    || pathname.startsWith('/links');

  /**
   * The link hostname is customer-facing and may show one page and nothing else.
   *
   * The middleware already redirects every path on it to /links, and this asks the
   * question a second way on purpose. When that redirect was a rewrite, the server
   * sent the link page's markup and the browser's address stayed "/", so the check
   * above answered "not public" at hydration and drew the entire shop around it —
   * sidebar, Orders, Invoices, Customers, Hisaab, Analytics, the voice button, all of
   * it, on a page printed on customers' receipts. It looked right in the response and
   * was wrong on the screen.
   *
   * Reading the hostname cannot be fooled by a path, so a mistake in the routing can
   * no longer put the shop's book in front of a customer. Belt and braces, because the
   * cost of being wrong here is not a broken page.
   */
  const onLinksHost = typeof window !== 'undefined'
    && isLinksHost(window.location.hostname);

  // If anything ever lands on another path here, it goes to the link page and stays
  // there. Nothing else on this hostname is meant for the person looking at it.
  useEffect(() => {
    if (onLinksHost && !pathname.startsWith('/links')) {
      window.location.replace('/links');
    }
  }, [onLinksHost, pathname]);

  const isPublicInvoicePage = isPublicPath || onLinksHost;

  // Settings come from Firestore and are not persisted into the store, so on a
  // cold load nothing knows the theme until the network answers. The cached
  // hint covers that gap; without it the store's 'slate' default painted a
  // dark screen that flipped to white once settings arrived.
  const cachedTheme = React.useMemo(() => readCachedTheme(), []);

  // Keep the hint current for next time (this device's own mode, when it has one).
  React.useEffect(() => {
    if (hasSettingsLoaded && theme && !readDeviceTheme()) writeCachedTheme(theme);
  }, [hasSettingsLoaded, theme]);

  // Have the wordmark ready for the first print before anyone has pressed anything.
  // On iOS the share sheet is only offered for a few seconds after the tap, and the
  // logo load was being paid inside that window. See pdf-logo.ts.
  React.useEffect(() => { warmPdfLogo(); }, []);

  // This device's own mode (the sun/moon in the top bar), when it has one, wins over
  // the shop's; see theme-cache.ts.
  const [deviceTheme, setDeviceTheme] = React.useState<string | null>(() => readDeviceTheme());
  React.useEffect(() => {
    const on = (e: Event) => setDeviceTheme((e as CustomEvent<string | null>).detail ?? null);
    window.addEventListener(DEVICE_THEME_EVENT, on);
    return () => window.removeEventListener(DEVICE_THEME_EVENT, on);
  }, []);
  const shownTheme = deviceTheme || (hasSettingsLoaded && theme ? theme : cachedTheme);

  // <html> and the phone's browser bar follow what is shown: the house's dark ground
  // on the dark palette, the page's own white on the light one.
  React.useEffect(() => {
    applyThemeToDocument(shownTheme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', shownTheme === LIGHT_THEME ? '#FCFCFD' : STORE_THEME_COLOR);
  }, [shownTheme]);

  if (!isHydrated) {
    return (
      <body suppressHydrationWarning className={`${inter.variable} font-sans antialiased theme-${deviceTheme || cachedTheme} brand-${STORE_BRAND}`}>
      </body>
    );
  }

  // Hydrated, but settings may still be in flight — keep showing the cached
  // theme rather than the store's default until the real one lands.
  const activeTheme = shownTheme;

  return (
    <body className={`${inter.variable} font-sans antialiased theme-${activeTheme} brand-${STORE_BRAND}`}>
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
    <html lang="en" suppressHydrationWarning className="dark" data-brand={STORE_BRAND}>
      <head>
        <title>{STORE_CONFIG.name}</title>
        <meta name="description" content="Jewellery Inventory & Point-of-Sale System" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* The browser chrome around the app. #0A1111 is taheri.shop's ground —
            this was the other shop's maroon. */}
        <meta name="theme-color" content={STORE_THEME_COLOR} />
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
              var t=localStorage.getItem('gemstrack:theme-device')||localStorage.getItem('gemstrack:theme')||'default';
              var h=document.documentElement;
              h.classList.add(t==='default'?'boot-light':'boot-dark');
              if(t==='default')h.classList.remove('dark');
            }catch(e){document.documentElement.classList.add('boot-light');document.documentElement.classList.remove('dark');}})();`,
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
