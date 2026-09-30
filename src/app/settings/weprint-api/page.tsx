"use client";

/**
 * WEPrint's live feed — hidden (the audit of 2026-10-01).
 *
 * This page picked the pieces a WEPrint printer would pull from `/api/products/weprint`, a route
 * that does not exist, so nothing it saved ever reached a printer. Its Settings card is gone; the
 * address stays so an old bookmark lands here. Whether to build the endpoint or drop the page is
 * the owner's call. Until then, labels go out as CSV from Labels (Settings → Labels, or a piece's
 * own page). The page's last working version is in git before this commit.
 */

import Link from 'next/link';
import { Printer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function WeprintApiPage() {
  return (
    <div className="container mx-auto max-w-2xl px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl"><Printer className="h-5 w-5" />WEPrint</CardTitle>
          <CardDescription>The live feed to WEPrint isn&apos;t set up, so this page is switched off.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Export the pieces as CSV from Labels and import that file into WEPrint instead.</p>
          <Button asChild variant="outline"><Link href="/settings/printer">Open Labels</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
