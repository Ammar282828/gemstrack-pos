'use client';

/**
 * "Print with Label LIVE": the pieces' tags straight into Label LIVE on this Mac (lib/label-live.ts) —
 * one piece as a print link, several as one batch. Set up once on Settings → Labels; until then the
 * button says so and leads there.
 */

import React from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAppStore, type Product } from '@/lib/store';
import { cleanLabelLive, labelLiveUrl } from '@/lib/label-live';
import { labelValuesFor } from '@/lib/label-live-values';

/** Hand a labellive:// link to the Mac: Safari and Chrome ask once to open Label LIVE, then just do it. */
export function openLabelLive(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function LabelLiveButton({ products, label, ...rest }: { products: Product[]; label?: string } & Omit<ButtonProps, 'onClick'>) {
  const settings = useAppStore(s => s.settings);
  const addPrintHistory = useAppStore(s => s.addPrintHistory);
  const { toast } = useToast();
  const config = cleanLabelLive(settings.labelLive);
  const n = products.length;

  if (!config) {
    return (
      <Button variant="outline" asChild {...rest}>
        <Link href="/settings/printer#label-live"><Printer className="mr-2 h-4 w-4" /> Set up Label LIVE</Link>
      </Button>
    );
  }
  const print = () => {
    if (!n) { toast({ title: 'No pieces chosen', description: 'Tick the pieces to print first.', variant: 'destructive' }); return; }
    openLabelLive(labelLiveUrl(config, products.map(p => labelValuesFor(p, settings))));
    for (const p of products) addPrintHistory?.(p.sku);
    toast({ title: n === 1 ? `Sent ${products[0].sku} to Label LIVE` : `Sent ${n} tags to Label LIVE`, description: `Design “${config.design}”${config.printer ? ` on ${config.printer}` : ''}. Label LIVE must be open on this Mac.` });
  };
  return (
    <Button variant="outline" onClick={print} {...rest}>
      <Printer className="mr-2 h-4 w-4" /> {label ?? (n > 1 ? `Print ${n} tags (Label LIVE)` : 'Print tag (Label LIVE)')}
    </Button>
  );
}
