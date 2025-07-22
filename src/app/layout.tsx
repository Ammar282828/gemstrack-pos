
"use client";

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google'; 
import './globals.css';
import AppLayout from '@/components/layout/app-layout';
import { Toaster } from "@/components/ui/toaster";
import { MainApp } from '@/components/layout/main-app';
import { useAppStore, useIsStoreHydrated } from '@/lib/store';
import React from 'react';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

// We can't use the metadata object for dynamic theme-color, so we'll handle it in the component.
// export const metadata: Metadata = {
//   title: 'Taheri POS',
//   description: 'Jewellery Inventory & Point-of-Sale System',
//   manifest: '/manifest.json',
// };

// export const viewport: Viewport = {
//   width: 'device-width',
//   initialScale: 1,
// };

function AppBody({ children }: { children: React.ReactNode }) {
  const isHydrated = useIsStoreHydrated();
  const theme = useAppStore(state => state.settings.theme);

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
      <AppLayout>
          <MainApp>
            {children}
          </MainApp>
      </AppLayout>
      <Toaster />
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
        <title>Taheri POS</title>
        <meta name="description" content="Jewellery Inventory & Point-of-Sale System" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        {/* Dynamic theme-color will be handled by the theme logic, but we can set a default */}
        <meta name="theme-color" content="#0d1a16" />
      </head>
      <AppBody>
        {children}
      </AppBody>
    </html>
  );
}
