/**
 * Shown for an unmatched URL and for any `notFound()` call. Most of the time
 * that means a mistyped id — an invoice or order that was renumbered, or a
 * scanned tag pointing at a record that no longer exists — so the useful exits
 * are the two lists, not a bare "go home".
 */

import Link from 'next/link';
import { SearchX, LayoutDashboard, FileText, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFound() {
  return (
    <div className="container mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center px-4 py-8">
      <Card className="w-full">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-muted">
            <SearchX className="h-5 w-5 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl">Nothing here</CardTitle>
          <CardDescription>
            This page does not exist, or the record it pointed to has been removed or renumbered.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Button asChild variant="outline">
            <Link href="/">
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Dashboard
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/invoices">
              <FileText className="mr-2 h-4 w-4" />
              Invoices
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/orders">
              <ClipboardList className="mr-2 h-4 w-4" />
              Orders
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
