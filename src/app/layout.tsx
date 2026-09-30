
"use client";

import { usePathname } from 'next/navigation';
import localFont from 'next/font/local';
import './globals.css';
import AppLayout from '@/components/layout/app-layout';
import { Toaster } from "@/components/ui/toaster";
import { MainApp } from '@/components/layout/main-app';
import { useAppStore } from '@/lib/store';
import { useIsStoreHydrated } from '@/hooks/use-store';
import React, { useEffect } from 'react';
import Script from 'next/script';
import { GoogleAuthGate } from '@/components/auth/google-auth-gate';
import { STORE_CONFIG, STORE_BRAND, STORE_THEME_COLOR, STORE_ICONS, STORE_LINKS_PAGE, LINKS_DRESS, isLinksHost, storeLinksUrl } from '@/lib/store-config';
import { readCachedTheme, writeCachedTheme, LIGHT_THEME, readDeviceTheme, DEVICE_THEME_EVENT, applyThemeToDocument, readCachedUiStyle, writeCachedUiStyle, applyUiStyleToDocument } from '@/lib/theme-cache';
import { warmPdfLogo } from '@/lib/pdf-logo';

// Google's own latin Inter, kept in the repo (src/fonts) so the build never fetches from Google —
// see src/app/website/post/fonts.ts for why.
const inter = localFont({
  src: [{ path: '../fonts/inter-latin.woff2', weight: '100 900', style: 'normal' }],
  variable: '--font-inter',
});

// useLayoutEffect in the browser (before paint), useEffect on the server, which has no layout.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

function AppBody({ children }: { children: React.ReactNode }) {
  const isHydrated = useIsStoreHydrated();
  const theme = useAppStore(state => state.settings.theme);
  const uiStyle = useAppStore(state => state.settings.uiStyle);
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

  // The interface style (standard or Liquid Glass) is the shop's; the cached hint
  // covers the first paint (the script in <head> reads it), the store then rules.
  const cachedStyle = React.useMemo(() => readCachedUiStyle(), []);
  React.useEffect(() => {
    // A customer's page never wears the ERP's glass, whatever this phone chose for the ERP.
    if (isPublicPath) { applyUiStyleToDocument('standard'); return; }
    const style = hasSettingsLoaded ? (uiStyle || 'standard') : cachedStyle;
    applyUiStyleToDocument(style);
    if (hasSettingsLoaded) writeCachedUiStyle(uiStyle || 'standard');
  }, [hasSettingsLoaded, uiStyle, cachedStyle, isPublicPath]);

  // <html>, <body> and the phone's browser bar follow what is shown: the house's dark
  // ground on the dark palette, the page's own white on the light one. Before paint,
  // so the hydrated body never shows a frame in the other palette; the body's own
  // className below carries no theme on purpose (see applyThemeToDocument).
  // The link page is always dark, so its bar is its own ground whatever this phone's mode.
  const onLinksPage = pathname.startsWith('/links') || onLinksHost;
  useIsomorphicLayoutEffect(() => {
    applyThemeToDocument(shownTheme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', onLinksPage ? LINKS_DRESS.ground : shownTheme === LIGHT_THEME ? '#FCFCFD' : STORE_THEME_COLOR);
  }, [shownTheme, onLinksPage]);

  // The same class on the server and on every client render: the theme is put on the
  // body by applyThemeToDocument, so hydration has nothing to disagree about.
  const bodyClass = `${inter.variable} font-sans antialiased brand-${STORE_BRAND}`;

  // The ERP waits for its store before drawing anything. A customer's page does not use
  // the store and must not wait: until 2026-09-29 the link page and a shared invoice
  // were sent as an empty <body>, and a customer who scanned a receipt saw nothing until
  // the whole ERP bundle had loaded. The path is known on the server too, so the server
  // and the first client render agree.
  if (!isHydrated && !isPublicPath) {
    return <body className={bodyClass}></body>;
  }

  return (
    <body className={bodyClass}>
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


/**
 * What a page is called, and how it previews when its address is shared on WhatsApp.
 * The ERP's pages are the ERP. The two a customer is sent are the shop's: the link page,
 * with the house's picture (public/brand/links-share-<brand>.png), and an invoice. Both
 * used to preview as "Jewellery ERP".
 */
function headFor(pathname: string) {
  const name = STORE_CONFIG.name;
  if (pathname.startsWith('/links')) {
    const url = storeLinksUrl();
    let origin = '';
    try { origin = url ? new URL(url).origin : ''; } catch { origin = ''; }
    const line = STORE_LINKS_PAGE.tagline.replace(/[.\s]+$/, '');
    return {
      title: line ? `${name} · ${line}` : name,
      description: STORE_LINKS_PAGE.welcome,
      themeColor: LINKS_DRESS.ground,
      share: { url, image: origin ? `${origin}/brand/links-share-${STORE_BRAND}.png` : '' },
    };
  }
  const invoice = pathname.match(/^\/view-invoice\/([^/?#]+)/);
  if (invoice) {
    let id = invoice[1];
    try { id = decodeURIComponent(id); } catch { /* shown as it came */ }
    return { title: `${id} · ${name}`, description: `Your invoice from ${name}.`, themeColor: STORE_THEME_COLOR, share: { url: '', image: '' } };
  }
  return { title: name, description: 'Jewellery ERP', themeColor: STORE_THEME_COLOR, share: null };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const head = headFor(usePathname() || '');
  return (
    <html lang="en" suppressHydrationWarning className="dark" data-brand={STORE_BRAND}>
      <head>
        <title>{head.title}</title>
        <meta name="description" content={head.description} />
        {head.share && (
          <>
            <meta property="og:type" content="website" />
            <meta property="og:site_name" content={STORE_CONFIG.name} />
            <meta property="og:title" content={head.title} />
            <meta property="og:description" content={head.description} />
            {head.share.url && <meta property="og:url" content={head.share.url} />}
            {head.share.image && <meta property="og:image" content={head.share.image} />}
            {head.share.image && <meta property="og:image:width" content="1200" />}
            {head.share.image && <meta property="og:image:height" content="630" />}
            <meta name="twitter:card" content={head.share.image ? 'summary_large_image' : 'summary'} />
          </>
        )}
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* The house's own icons (store-config STORE_ICONS); both ERPs showed the template's flame. */}
        <link rel="icon" href={`${STORE_ICONS.dir}/favicon.ico`} sizes="48x48" />
        <link rel="icon" type="image/png" sizes="192x192" href={`${STORE_ICONS.dir}/icon-192.png`} />
        <link rel="apple-touch-icon" href={`${STORE_ICONS.dir}/apple-touch-icon.png`} />
        {/* The browser chrome around the app. #0A1111 is taheri.shop's ground —
            this was the other shop's maroon. */}
        <meta name="theme-color" content={head.themeColor} />
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
              if(localStorage.getItem('gemstrack:ui-style')==='glass'&&!/^\\/(links|view-invoice)/.test(location.pathname))h.classList.add('ui-glass');
            }catch(e){document.documentElement.classList.add('boot-light');document.documentElement.classList.remove('dark');}})();`,
          }}
        />
        {/* The label printer is the ERP's; a customer's page never fetches it. */}
        {!head.share && <Script src="https://unpkg.com/zebra-browser-print-wrapper@3.0.0/js/zebra_browser_print_wrapper.js" type="text/javascript"></Script>}
      </head>
      <AppBody>
        {children}
      </AppBody>
    </html>
  );
}
