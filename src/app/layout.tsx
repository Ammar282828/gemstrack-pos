
import type { Metadata } from 'next';
import { Inter } from 'next/font/google'; // Changed from Geist to Inter
import './globals.css';
import AppLayout from '@/components/layout/app-layout';
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Taheri POS',
  description: 'Jewellery Inventory & Point-of-Sale System',
  manifest: '/manifest.json', // Link to the manifest file
  viewport: { 
    width: 'device-width',
    initialScale: 1,
  },
  // Apple specific meta tags for PWA
  appleWebAppCapable: "yes",
  appleWebAppStatusBarStyle: "default", // or "black", "black-translucent"
  appleWebAppTitle: "Taheri POS",
  // Theme color for browsers that support it
  themeColor: "#200080",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        {/*
          The manifest link and theme-color can also be placed directly here
          if preferred over the metadata object, especially for older Next.js versions
          or for more direct control. For Next.js App Router, metadata is preferred.
        */}
         <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <AppLayout>
          {children}
        </AppLayout>
        <Toaster />
      </body>
    </html>
  );
}
