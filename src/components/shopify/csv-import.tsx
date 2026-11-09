'use client';

import React, { useRef, useState } from 'react';
import { Loader2, Upload, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useAppStore } from '@/lib/store';
import { clientPort } from '@/lib/db-client-port';
import { importShopifyCsv, shopifyCsvPreview } from '@/lib/writes/shopify-csv-import';

/**
 * Import Shopify CSV, moved from Invoices to the Shopify section (owner, 2026-11-09). Each row becomes an invoice
 * (lib/writes/shopify-csv-import.ts, the one copy the iPhone app runs on the server too): history, listed under
 * "Earlier (invoiced)". A desk's job, never a phone's: the button shows from sm.
 */
export function ShopifyCsvImport() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ rows: number; firstNames: string[] } | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const loadGeneratedInvoices = useAppStore(s => s.loadGeneratedInvoices);

  const reset = () => { setOpen(true); setFile(null); setPreview(null); setProgress([]); setDone(false); };

  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setDone(false); setProgress([]);
    const reader = new FileReader();
    reader.onload = ev => setPreview(shopifyCsvPreview(ev.target?.result as string));
    reader.readAsText(f);
  };

  const run = () => {
    if (!file) return;
    setBusy(true); setProgress([]);
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const { imported } = await importShopifyCsv(clientPort, ev.target?.result as string, msg => setProgress(p => [...p, msg]));
        setDone(true);
        toast({ title: `Imported ${imported} invoices`, description: 'Shopify CSV import complete.' });
        loadGeneratedInvoices();
      } catch (e) {
        toast({ title: 'Import Failed', description: (e as Error).message || 'An unexpected error occurred.', variant: 'destructive' });
      } finally { setBusy(false); }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <Button variant="outline" size="sm" className="hidden flex-shrink-0 sm:inline-flex" onClick={reset}>
        <Upload className="mr-2 h-4 w-4" />Import Shopify CSV
      </Button>
      <Dialog open={open} onOpenChange={o => { if (!busy) setOpen(o); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Shopify orders (CSV)</DialogTitle>
            <DialogDescription>
              Upload a Shopify orders export CSV. Each row becomes an invoice, numbered from the last invoice number, and is listed under Earlier (invoiced).
            </DialogDescription>
          </DialogHeader>
          {!done ? (
            <div className="space-y-4 py-2">
              <div className="cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:border-primary" onClick={() => input.current?.click()}>
                <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{file ? file.name : 'Click to select CSV file'}</p>
                <input ref={input} type="file" accept=".csv" className="hidden" onChange={choose} />
              </div>
              {preview && (
                <div className="space-y-1 rounded-md bg-muted p-3 text-sm">
                  <p className="font-medium">{preview.rows} rows detected</p>
                  <p className="text-muted-foreground">First entries: {preview.firstNames.join(', ')}{preview.rows > 5 ? '…' : ''}</p>
                </div>
              )}
              {progress.length > 0 && (
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-md bg-muted p-3 text-xs">{progress.map((m, i) => <p key={i}>{m}</p>)}</div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="h-12 w-12 text-success" />
              <p className="text-lg font-semibold">Import Complete</p>
              <p className="text-sm text-muted-foreground">All invoices have been saved.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            {!done && (
              <Button onClick={run} disabled={!file || busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{busy ? 'Importing…' : 'Import'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
