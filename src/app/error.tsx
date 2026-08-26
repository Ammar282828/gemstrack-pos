'use client';

/**
 * Route-level error boundary.
 *
 * This renders in place of the page that threw, inside the app layout, so the
 * sidebar survives and the operator can navigate away instead of reloading. It
 * catches render and effect errors in any page — a malformed Firestore
 * document, a missing field an older record never had, an unhandled throw in a
 * component. Before this existed every one of those produced a blank screen at
 * the counter.
 *
 * Nothing here may throw. It runs *because* something else already did.
 */

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, RotateCcw, LayoutDashboard, FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { listDrafts } from '@/lib/form-drafts';

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // The digest is all the operator can read back over the phone; the stack is
    // for whoever opens the console afterwards.
    console.error('[GemsTrack] page error', error);
  }, [error]);

  // Drafts are the operator's actual worry: "did I just lose the invoice I was
  // typing?" Read defensively — this component must not throw.
  const [draftCount, setDraftCount] = React.useState(0);
  React.useEffect(() => {
    try {
      setDraftCount(listDrafts().length);
    } catch {
      setDraftCount(0);
    }
  }, []);

  return (
    <div className="container mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center px-4 py-8">
      <Card className="w-full">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <CardTitle className="text-xl">This page could not be displayed</CardTitle>
          <CardDescription>
            Something went wrong while loading it. The rest of the app is still working, and no
            saved data has been changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {draftCount > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <FileWarning className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {draftCount === 1 ? 'One unfinished form is' : `${draftCount} unfinished forms are`}{' '}
                  still saved on this device.
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="flex-shrink-0">
                <Link href="/new">Pick it up</Link>
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={reset} className="sm:flex-1">
              <RotateCcw className="mr-2 h-4 w-4" />
              Try again
            </Button>
            <Button asChild variant="outline" className="sm:flex-1">
              <Link href="/">
                <LayoutDashboard className="mr-2 h-4 w-4" />
                Go to dashboard
              </Link>
            </Button>
          </div>

          {error.digest && (
            <p className="text-xs text-muted-foreground">
              Reference for support: <code className="rounded bg-muted px-1 py-0.5 font-mono">{error.digest}</code>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
