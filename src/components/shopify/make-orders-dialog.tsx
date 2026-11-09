'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { authedFetch } from '@/lib/voice/authed-fetch';
import type { ConvertResult } from '@/lib/writes/shopify-invoice-to-order';

/** The result as one line: "12 made orders, 2 skipped: INV-3 (already fulfilled), …". */
export function convertNote(r: ConvertResult): string {
  const made = `${r.converted.length} made ${r.converted.length === 1 ? 'an order' : 'orders'}`;
  if (!r.skipped.length) return made;
  const why = r.skipped.slice(0, 5).map(s => `${s.invoiceId} (${s.reason})`).join(', ') + (r.skipped.length > 5 ? ', …' : '');
  return `${made}, ${r.skipped.length} skipped: ${why}`;
}

/**
 * Make orders of old Shopify sales (/api/app/write `shopifyInvoicesToOrders`, lib/writes/shopify-invoice-to-order.ts).
 * It takes invoices off the books, so it asks the delete code (decision "Delete code") like Delete invoice; the code goes with
 * the request and the server checks it. A request id is chosen per opening, so a double tap or a retry is one change.
 */
export function MakeOrdersDialog({ invoiceIds, open, onOpenChange, onDone }: {
  invoiceIds: string[]; open: boolean; onOpenChange: (open: boolean) => void; onDone: (r: ConvertResult) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState('');
  useEffect(() => { if (open) { setCode(''); setError(null); setBusy(false); setRequestId(crypto.randomUUID()); } }, [open]);
  const n = invoiceIds.length;

  const submit = async () => {
    if (busy || code.length < 4) return;
    setBusy(true); setError(null);
    try {
      const res = await authedFetch('/api/app/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'shopifyInvoicesToOrders', invoiceIds, deleteCode: code, requestId }),
      });
      const d = await res.json().catch(() => ({})) as Partial<ConvertResult> & { error?: string };
      if (!res.ok) { setError(d.error || `Could not make the orders (${res.status}).`); setCode(''); return; }
      onOpenChange(false);
      onDone({ converted: d.converted ?? [], skipped: d.skipped ?? [] });
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{n === 1 ? 'Make it an order' : `Make orders of ${n} Shopify sales`}</DialogTitle>
          <DialogDescription>
            {n === 1 ? 'Its pieces' : 'Their pieces'} go to the workshop, {n === 1 ? 'its' : 'their'} money already taken becomes advances, and
            {n === 1 ? ' it counts' : ' they count'} as {n === 1 ? 'a sale' : 'sales'} again when {n === 1 ? 'it is' : 'they are'} finalized.
            The invoice{n === 1 ? ' is' : 's are'} removed, as Delete does. Enter the delete code to go ahead.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={e => { e.preventDefault(); void submit(); }} className="space-y-3">
          <Input
            autoFocus type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" maxLength={8}
            value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(null); }}
            placeholder="••••" aria-label="Delete code" className="h-12 text-center text-2xl tracking-[0.5em]"
          />
          {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || code.length < 4}>
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Make {n === 1 ? 'it an order' : 'orders'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
