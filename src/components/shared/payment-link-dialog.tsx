'use client';

import React, { useEffect, useState } from 'react';
import { Copy, MessageCircle, Share2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BusyLabel } from '@/components/ui/busy';
import { AmountInput } from '@/components/ui/amount-input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { authedFetch } from '@/lib/voice/authed-fetch';
import { STORE_CONFIG } from '@/lib/store-config';
import { whatsAppLink } from '@/lib/whatsapp';
import { isWalkInName } from '@/lib/walk-in';
import { linkAmount, paymentLinkMessage } from '@/lib/payment-link-message';

/** Whether a "Payment link" is offered: links are on, the record is live, and something is owed. */
export const canMakePaymentLink = (on: boolean, status: string | undefined, owed: number): boolean =>
  on && status !== 'Cancelled' && status !== 'Refunded' && linkAmount(owed) >= 1;

/**
 * A Safepay payment link for an invoice or an order (/api/app/write `createPaymentLink`, lib/writes/payment-links.ts).
 * The amount starts at what is still owed; Create shows the link to Copy, Share or send on WhatsApp. When it is paid the
 * server records it by itself (invoice payment / order advance, by Card), so nothing else happens here.
 */
export function PaymentLinkDialog({ target, targetId, owed, customerName, phone, open, onOpenChange }: {
  target: 'invoice' | 'order'; targetId: string; owed: number; customerName?: string; phone?: string;
  open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; amount: number } | null>(null);
  useEffect(() => { if (open) { setAmount(linkAmount(owed)); setBusy(false); setError(null); setLink(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const n = linkAmount(amount);
    if (busy || n < 1) return;
    setBusy(true); setError(null);
    try {
      const res = await authedFetch('/api/app/write', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'createPaymentLink', target, targetId, amount: n }),
      });
      const d = await res.json().catch(() => ({})) as { link?: { url: string; amount: number }; error?: string };
      if (!res.ok || !d.link) { setError(d.error || `Could not make the link (${res.status}).`); return; }
      setLink({ url: d.link.url, amount: d.link.amount });
    } catch {
      setError("Couldn't reach the server. Check the connection and try again.");
    } finally { setBusy(false); }
  };

  const name = customerName && !isWalkInName(customerName) ? customerName : undefined;
  const message = link ? paymentLinkMessage({ name, amount: link.amount, id: targetId, url: link.url, store: STORE_CONFIG.name }) : '';
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); toast({ title: 'Link copied' }); }
    catch { toast({ title: "Couldn't copy", description: link.url, variant: 'destructive' }); }
  };
  const share = async () => {
    try { await navigator.share({ text: message }); } catch { /* cancelled */ }
  };
  const wa = whatsAppLink(phone, message) || `https://wa.me/?text=${encodeURIComponent(message)}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <Dialog open={open} onOpenChange={o => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Payment link</DialogTitle>
          <DialogDescription>
            {link ? 'Send this to the customer. Once they pay, it is recorded here by itself within a few minutes, by Card.'
              : `A Safepay link for ${targetId}. The customer pays on Safepay's own page.`}
          </DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-3">
            <p className="text-ios-sub text-muted-foreground">PKR {link.amount.toLocaleString('en-US')}</p>
            <p className="break-all rounded-tile bg-muted/50 p-3 text-ios-sub">{link.url}</p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={copy}><Copy className="mr-1.5 h-4 w-4" />Copy</Button>
              {canShare && <Button type="button" variant="outline" onClick={share}><Share2 className="mr-1.5 h-4 w-4" />Share</Button>}
              <Button type="button" variant="outline" asChild className={canShare ? 'col-span-2' : ''}>
                <a href={wa} target="_blank" rel="noopener noreferrer"><MessageCircle className="mr-1.5 h-4 w-4" />WhatsApp</a>
              </Button>
            </div>
            <DialogFooter><Button type="button" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); void create(); }} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="paylink-amount" className="text-ios-sub font-medium">Amount (PKR)</label>
              <AmountInput id="paylink-amount" value={amount} maxDecimals={0} emptyValue={undefined} onValueChange={setAmount} placeholder="Amount" disabled={busy} className="h-11 text-right" />
              <p className="text-ios-foot text-muted-foreground">Still owed: PKR {linkAmount(owed).toLocaleString('en-US')}</p>
            </div>
            {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || linkAmount(amount) < 1}>
                <BusyLabel busy={busy}><Link2 className="mr-1.5 h-4 w-4" />Create link</BusyLabel>
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
