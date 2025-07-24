
import React from 'react';
import { Inter } from 'next/font/google';
import '../../globals.css';
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});


// This layout removes the main app sidebar and navigation for public-facing pages.
export default function PublicPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
         <title>View Invoice</title>
         <meta name="description" content="View your invoice details." />
         <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <main>{children}</main>
        <Toaster />
      </body>
    </html>
  );
}

    