"use client";

/**
 * Back, with somewhere to go.
 *
 * Pages used a bare `router.back()`, which dead-ends whenever the page was
 * opened directly rather than navigated to — a shared link, a refresh, a
 * scanned QR code. There is no previous entry, so the button does nothing.
 * This falls back to the section the page belongs to, so it always leads
 * somewhere sensible.
 *
 *   <PageBack fallback="/orders" label="Back to orders" />
 */

import React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export const PageBack: React.FC<{
  /** Where to go when there is no history to return to. */
  fallback: string;
  label?: string;
  className?: string;
}> = ({ fallback, label = 'Back', className }) => {
  const router = useRouter();

  const go = () => {
    // history.length is 1 on a tab that opened straight onto this page.
    const hasHistory = typeof window !== 'undefined' && window.history.length > 1;
    if (hasHistory) router.back();
    else router.push(fallback);
  };

  return (
    <Button
      type="button" variant="ghost" size="sm" onClick={go}
      aria-label={label}
      className={cn('-ml-2 h-8 px-2 text-muted-foreground hover:text-foreground', className)}
    >
      <ArrowLeft className="h-4 w-4 mr-1.5" />{label}
    </Button>
  );
};
