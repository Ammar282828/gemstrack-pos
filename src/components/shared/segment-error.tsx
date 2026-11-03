'use client';

/**
 * The error screen for one section of the app (Website, Analytics, Ads …), used by that section's
 * `error.tsx`. The sidebar, the top bar and the section's tab row sit outside it (they are the layout), so a
 * page that throws leaves the person in the section with a Retry and a way to the section's first page,
 * rather than at the root error screen. Nothing here may throw: it runs because something else did.
 */

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SegmentError({ error, reset, section, href }: {
  error: Error & { digest?: string }; reset: () => void; section: string; href: string;
}) {
  React.useEffect(() => {
    console.error(`[GemsTrack] ${section} page error`, error);
  }, [error, section]);

  return (
    <div className="container mx-auto flex min-h-[50vh] max-w-xl items-center justify-center px-4 py-8">
      <div role="alert" className="w-full space-y-4 rounded-card bg-card p-5">
        <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="space-y-1">
          <h2 className="text-ios-headline font-semibold">This {section} page could not be shown</h2>
          <p className="text-ios-sub text-muted-foreground">
            The rest of the app is working and nothing saved was changed.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={reset} className="sm:flex-1"><RotateCcw className="mr-2 h-4 w-4" />Try again</Button>
          <Button asChild variant="outline" className="sm:flex-1"><Link href={href}>Back to {section}</Link></Button>
        </div>
        {error.digest && (
          <p className="text-ios-cap text-muted-foreground">
            Reference for support: <code className="rounded bg-muted px-1 py-0.5 font-mono">{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
