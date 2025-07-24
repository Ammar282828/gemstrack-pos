
import React from 'react';

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
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
