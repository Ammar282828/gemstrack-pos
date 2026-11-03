"use client";

/**
 * A small printer button for a list row or card: one click builds the PDF and opens the browser's
 * print dialog, without opening the record. It never triggers the row's own click.
 */

import React from 'react';
import { Printer, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { printPdfBlob } from '@/lib/print-pdf';
import { cn } from '@/lib/utils';

export const QuickPrintButton: React.FC<{
  /** "Print INV-000123" / "Print order ORD-000123". */
  label: string;
  /** Builds the document; the button prints what it returns. */
  build: () => Promise<{ output: (type: 'blob') => Blob }>;
  className?: string;
}> = ({ label, build, className }) => {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Button
      type="button" variant="ghost" size="icon"
      className={cn('h-8 w-8 shrink-0 text-muted-foreground', className)}
      aria-label={label} title={label} aria-busy={busy} disabled={busy}
      onKeyDown={stop}
      onClick={async (e) => {
        e.stopPropagation();
        if (busy) return;
        setBusy(true);
        try {
          const doc = await build();
          await printPdfBlob(doc.output('blob'));
        } catch (err) {
          console.error('[GemsTrack] quick print failed', err);
          toast({
            title: 'Could not print',
            description: err instanceof Error ? err.message : 'Something went wrong while preparing the PDF.',
            variant: 'destructive',
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
    </Button>
  );
};
