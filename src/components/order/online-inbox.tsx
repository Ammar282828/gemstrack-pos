'use client';

/**
 * Online — to confirm: the top of the Orders hub (2026-10-04).
 *
 * Every order from taheri.shop waits here until someone looks at it (lib/website/online.ts). Each
 * card has what is needed to decide: the pieces with their photographs and sizes, who and where,
 * and what the same pieces cost at today's rate, so whoever confirms knows how far gold has moved
 * since the customer ordered. Confirm makes the ORD- order and sends the bank details; Decline
 * sends the reason. Nothing else in the ERP sees an online order before then.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { Check, Globe, Loader2, MapPin, MessageCircle, Phone, Send, X } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { bankDetailsWhatsApp, listOnline, refreshWaiting, staffFetch, useOnlineWaiting } from '@/lib/website/online-client';
import type { OnlineOrderRow } from '@/lib/website/types';
import { STORE_WEBSITE_SELLING } from '@/lib/store-config';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
const HOLD_HOURS = 24;

const REASONS = [
  'This piece cannot be made in the size asked for',
  'We cannot deliver to this city',
  'We could not reach you on this number',
  'This design is no longer made',
];

export function OnlineInbox() {
  const waitingCount = useOnlineWaiting();
  const [rows, setRows] = useState<OnlineOrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setRows(await listOnline()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  // Read when the count says there is something (and again whenever it changes).
  useEffect(() => { if (STORE_WEBSITE_SELLING && waitingCount > 0) void load(); }, [waitingCount, load]);

  if (!STORE_WEBSITE_SELLING) return null;
  const waiting = (rows ?? []).filter(r => r.state === 'to_confirm' || r.state === 'confirming');
  if (!waiting.length) return null;

  return (
    <section aria-labelledby="online-inbox" className="rounded-xl border border-primary/30 bg-primary/[0.03] p-3 sm:p-4">
      <div className="flex items-baseline justify-between gap-3 pb-2.5">
        <h2 id="online-inbox" className="flex items-center gap-2 text-sm font-semibold text-primary">
          <Globe className="h-4 w-4" />Online — to confirm
          <span className="rounded-full bg-primary px-1.5 text-[11px] leading-5 text-primary-foreground">{waiting.length}</span>
        </h2>
        <span className="hidden sm:inline text-2xs text-muted-foreground">Nothing is in the book, and nobody has the bank details, until you confirm.</span>
      </div>
      {error && <p className="pb-2 text-xs text-destructive">{error}</p>}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {waiting.map(r => <OnlineCard key={r.id} row={r} onDone={() => { void load(); void refreshWaiting(); }} />)}
      </div>
    </section>
  );
}

function OnlineCard({ row, onDone }: { row: OnlineOrderRow; onDone: () => void }) {
  const { toast } = useToast();
  const loadOrders = useAppStore(s => s.loadOrders);
  const [open, setOpen] = useState<'confirm' | 'decline' | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  /** Confirmed: the dialog stays open on its second step, sending the bank details on WhatsApp. */
  const [confirmed, setConfirmed] = useState<{ orderId: string; notified: string | null } | null>(null);
  const moved = row.todayTotal != null ? row.todayTotal - row.grandTotal : 0;
  const movedPct = row.grandTotal ? (moved / row.grandTotal) * 100 : 0;
  const phone = row.customer.phone.replace(/[^\d]/g, '');
  const confirming = row.state === 'confirming';

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await staffFetch<{ orderId: string; notified: string | null }>(`/api/website/online/${encodeURIComponent(row.id)}`, { action: 'confirm' });
      loadOrders();
      setConfirmed(r);
    } catch (e) {
      toast({ title: 'Not confirmed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };

  const decline = async () => {
    setBusy(true);
    try {
      const r = await staffFetch<{ notified: string | null }>(`/api/website/online/${encodeURIComponent(row.id)}`, { action: 'decline', reason });
      toast({ title: `${row.id} declined`, description: r.notified ? `The WhatsApp did not send (${r.notified}): tell ${row.customer.name} yourself.` : `${row.customer.name} has been told why.` });
      setOpen(null);
      onDone();
    } catch (e) {
      toast({ title: 'Not declined', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(false); }
  };

  return (
    <article className="min-w-0 rounded-lg border bg-card p-3 space-y-2.5">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* The section says Online already; the number is what the customer quotes. */}
          <p className="whitespace-nowrap font-semibold tabular-nums">{row.id}</p>
          <p className="text-xs text-muted-foreground">{formatDistanceToNowStrict(parseISO(row.placedAt), { addSuffix: true })}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className="whitespace-nowrap font-bold tabular-nums text-primary">{rs(row.grandTotal)}</p>
          <p className="text-2xs text-muted-foreground">{row.deliveryCharge ? `incl. ${rs(row.deliveryCharge)} delivery` : 'free delivery'}</p>
        </div>
      </header>

      <ul className="space-y-1.5">
        {row.lines.map((l, i) => (
          <li key={i} className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={l.image} alt="" loading="lazy" className="h-12 w-12 flex-shrink-0 rounded-md border object-cover bg-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{l.description.replace(/ \(size [^)]+\)$/, '')}</p>
              {l.size && <p className="text-xs font-medium text-amber-700 dark:text-amber-300">Size {l.size}</p>}
            </div>
            <span className="text-sm tabular-nums">{rs(l.price)}</span>
          </li>
        ))}
      </ul>

      <div className="space-y-0.5 text-sm">
        <p className="truncate font-medium">{row.customer.name}</p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <a href={`tel:+${phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="h-3 w-3" />{row.customer.phone}</a>
          <a href={`https://wa.me/${phone}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground"><MessageCircle className="h-3 w-3" />WhatsApp</a>
        </p>
        <p className="flex items-start gap-1 text-xs text-muted-foreground"><MapPin className="mt-0.5 h-3 w-3 flex-shrink-0" /><span>{row.delivery.address}, <span className="font-medium text-foreground">{row.delivery.city}</span></span></p>
        {row.delivery.notes && <p className="text-xs italic text-muted-foreground">“{row.delivery.notes}”</p>}
      </div>

      {row.todayTotal != null && Math.abs(movedPct) >= 0.5 && (
        <p className={cn('rounded-md px-2 py-1 text-xs', moved > 0 ? 'bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'bg-muted text-muted-foreground')}>
          At today&apos;s rate it is {rs(row.todayTotal)} ({moved > 0 ? '+' : ''}{rs(moved).replace('Rs -', '−Rs ')}, {movedPct > 0 ? '+' : ''}{movedPct.toFixed(1)}%). Confirming holds their price.
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        <Button type="button" size="sm" className="h-9 flex-1" disabled={confirming} onClick={() => setOpen('confirm')}>
          {confirming ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}{confirming ? 'Being confirmed…' : 'Confirm'}
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-9" disabled={confirming} onClick={() => { setReason(''); setOpen('decline'); }}>
          <X className="mr-1.5 h-4 w-4" />Decline
        </Button>
      </div>

      <Dialog open={open === 'confirm'} onOpenChange={o => { if (!busy && !o) { setOpen(null); if (confirmed) onDone(); } }}>
        <DialogContent className="max-w-md">
          {confirmed ? (
            <>
              <DialogHeader>
                <DialogTitle>{row.id} is {confirmed.orderId}</DialogTitle>
                <DialogDescription>
                  {confirmed.notified
                    ? `Confirmed — but the WhatsApp telling ${row.customer.name} did not send (${confirmed.notified}).`
                    : `${row.customer.name} has been told it is confirmed and that your bank details are coming.`}{' '}
                  Send them now: the price is held {HOLD_HOURS} hours for {rs(row.grandTotal)}.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setOpen(null); onDone(); }}>Done</Button>
                <Button asChild><a href={bankDetailsWhatsApp(row.customer.phone, row.customer.name, row.id, row.grandTotal)} target="_blank" rel="noopener"><Send className="mr-1.5 h-4 w-4" />Send bank details on WhatsApp</a></Button>
              </DialogFooter>
            </>
          ) : (<>
          <DialogHeader>
            <DialogTitle>Confirm {row.id}?</DialogTitle>
            <DialogDescription>
              It becomes an order in the book for {row.customer.name}, labelled Online, with its {row.lines.length === 1 ? 'piece' : `${row.lines.length} pieces`} at the prices they were quoted. They are told on WhatsApp, and you send them your bank details there; they have {HOLD_HOURS} hours to transfer {rs(row.grandTotal)}.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            <li className="flex justify-between gap-3"><span className="text-muted-foreground">Sizes</span><span className="text-right">{row.lines.filter(l => l.size).map(l => l.size).join(', ') || 'none asked'}</span></li>
            <li className="flex justify-between gap-3"><span className="text-muted-foreground">Ships to</span><span className="text-right">{row.delivery.city}</span></li>
            {moved > 0 && Math.abs(movedPct) >= 0.5 && <li className="flex justify-between gap-3 text-amber-700 dark:text-amber-300"><span>Today it would be</span><span>{rs(row.todayTotal!)}</span></li>}
          </ul>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(null)}>Not yet</Button>
            <Button disabled={busy} onClick={confirm}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}Confirm</Button>
          </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>

      <Dialog open={open === 'decline'} onOpenChange={o => { if (!busy && !o) setOpen(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Decline {row.id}</DialogTitle>
            <DialogDescription>{row.customer.name} is sent this on WhatsApp, after “we can&apos;t take it as it was placed:”. Nothing has been charged, so nothing needs undoing.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map(r => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn('rounded-full border px-2.5 py-1 text-xs', reason === r ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent')}>{r}</button>
            ))}
          </div>
          <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300} placeholder="Why, in a line" />
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(null)}>Keep it</Button>
            <Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={decline}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <X className="mr-1.5 h-4 w-4" />}Decline &amp; tell them</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

/** "Online" beside an order's number wherever orders are listed, with the customer's ONL- reference. */
export function OnlineBadge({ onlineId, className }: { onlineId?: string; className?: string }) {
  return (
    <Badge variant="outline" title={onlineId ? `Online order ${onlineId}` : 'Online order'} className={cn('h-5 px-1.5 text-[10px] font-medium border-sky-500/40 text-sky-700 dark:text-sky-300', className)}>
      <Globe className="mr-1 h-2.5 w-2.5" />Online
    </Badge>
  );
}

