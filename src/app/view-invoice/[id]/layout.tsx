
import React from 'react';
import '../../globals.css';
import { Toaster } from "@/components/ui/toaster"

// This layout removes the main app sidebar and navigation for public-facing pages.
// It does NOT include <html> or <body> tags, as Next.js handles those in the root layout.
export default function PublicPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
        <main>{children}</main>
        <Toaster />
    </>
  );
}
