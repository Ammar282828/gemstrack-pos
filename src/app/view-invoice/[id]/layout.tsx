import React from 'react';

// This layout is intentionally minimal. It does NOT include <html> or <body> tags,
// as Next.js handles those in the root layout. It simply provides a clean slate
// for public-facing pages, ensuring they don't inherit the main app's sidebar.
export default function PublicPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
    </>
  );
}
