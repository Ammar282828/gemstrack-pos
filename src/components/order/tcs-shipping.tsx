'use client';

/**
 * TCS from the order page (owner, 2026-11-09): book the parcel (op bookTcs), print its shipping slip, cancel it, and the
 * Tracking card: where the parcel is, from TCS when the account works, else from Shopify's fulfilment (/api/app/tracking).
 * Works for an invoice too (`target`), so a sale shipped without an order can be booked the same way.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, PackageSearch, Printer, RefreshCw, Truck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Pill } from '@/components/ledger';
import { BusyLabel } from '@/components/ui/busy';
import { useToast } from '@/hooks/use-toast';
import { authedFetch } from '@/lib/voice/authed-fetch';
import { printShippingSlip } from '@/lib/pdf-lazy';
import { formatDate } from '@/lib/safe-date';
import { trackingTone, type Tracking } from '@/lib/tracking';
import type { BookingPrefill, TcsBooking } from '@/lib/tcs-booking';

export type ShipTarget = { kind: 'order' | 'invoice'; id: string };
const q = (t: ShipTarget) => `${t.kind}=${encodeURIComponent(t.id)}`;
const idField = (t: ShipTarget) => (t.kind === 'order' ? { orderId: t.id } : { invoiceId: t.id });

async function writeOp(body: Record<string, unknown>) {
  const res = await authedFetch('/api/app/write', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Not done (${res.status}).`);
  return d;
}

// ─── Booking ─────────────────────────────────────────────────────────────────

type Prefill = { booking: { connected: boolean; ready: boolean; originCity: string }; prefill: BookingPrefill; cities: string[]; booked: TcsBooking | null };

/**
 * The form: receiver, city, weight, pieces, cash to collect, all from the order and editable. A Shopify order is also
 * fulfilled on Shopify with the number (so the customer's email and Shopify show it), unless the box is unticked.
 */
export function BookTcsForm({ target, onBooked }: { target: ShipTarget; onBooked: (b: TcsBooking) => void }) {
  const { toast } = useToast();
  const [data, setData] = useState<Prefill | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', address: '', mobile: '', email: '', city: '', weight: '0.5', pieces: '1', cod: '0', remarks: '' });
  const [fulfil, setFulfil] = useState(true);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(null); setData(null);
    authedFetch(`/api/app/courier?${q(target)}`).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Could not load (${r.status}).`);
      const p = (d as Prefill).prefill;
      setData(d as Prefill);
      setF({ name: p.consignee.name, address: p.consignee.address, mobile: p.consignee.mobile, email: p.consignee.email, city: p.destinationCity, weight: String(p.weight), pieces: String(p.pieces), cod: String(p.codAmount), remarks: '' });
    }).catch(e => setLoadError(e instanceof Error ? e.message : 'Could not load.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.id]);
  useEffect(load, [load]);

  if (loadError) return (
    <div className="space-y-2 py-2">
      <p className="text-sm text-destructive">{loadError}</p>
      <Button size="sm" variant="outline" onClick={load}>Retry</Button>
    </div>
  );
  if (!data) return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reading the order…</div>;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { const v = e.target.value; setF(p => ({ ...p, [k]: v })); setError(null); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const d = await writeOp({
        op: 'bookTcs', ...idField(target),
        consignee: { name: f.name, address: f.address, mobile: f.mobile, email: f.email },
        destinationCity: f.city, weight: Number(f.weight), pieces: Number(f.pieces), codAmount: Number(f.cod) || 0,
        remarks: f.remarks, fulfilShopify: fulfil, notifyCustomer: notify,
      });
      const b = d.booking as TcsBooking;
      toast({ title: `Booked with TCS: ${b.cn}`, description: d.shopify ? (d.shopify.ok ? 'Shopify fulfilled with the number.' : `Shopify not updated: ${d.shopify.message}`) : 'Print the shipping slip for the parcel.' });
      onBooked(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Not booked.');
    } finally { setBusy(false); }
  };

  const shopifyOrder = !!data.prefill.shopifyOrderId;
  return (
    <form onSubmit={submit} className="space-y-3">
      {!data.booking.ready && (
        <p className="rounded-md bg-warning/10 p-2.5 text-xs text-warning">
          {data.booking.connected
            ? 'The TCS account is missing its cost centre code or account number (Settings → Integrations → TCS).'
            : 'TCS is not connected yet. An owner adds the account in Settings → Integrations → TCS.'}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 space-y-1"><Label htmlFor="tcs-name">Receiver</Label><Input id="tcs-name" value={f.name} onChange={set('name')} required disabled={busy} /></div>
        <div className="col-span-2 space-y-1"><Label htmlFor="tcs-address">Address</Label><Input id="tcs-address" value={f.address} onChange={set('address')} required disabled={busy} /></div>
        <div className="space-y-1">
          <Label htmlFor="tcs-city">City</Label>
          <Input id="tcs-city" value={f.city} onChange={set('city')} required list="tcs-cities" disabled={busy} autoComplete="off" />
          {data.cities.length > 0 && <datalist id="tcs-cities">{data.cities.map(c => <option key={c} value={c} />)}</datalist>}
        </div>
        <div className="space-y-1"><Label htmlFor="tcs-mobile">Mobile</Label><Input id="tcs-mobile" inputMode="tel" value={f.mobile} onChange={set('mobile')} required disabled={busy} /></div>
        <div className="col-span-2 space-y-1"><Label htmlFor="tcs-email">Email (optional)</Label><Input id="tcs-email" type="email" value={f.email} onChange={set('email')} disabled={busy} /></div>
        <div className="space-y-1"><Label htmlFor="tcs-weight">Weight (kg)</Label><Input id="tcs-weight" inputMode="decimal" value={f.weight} onChange={set('weight')} required disabled={busy} /></div>
        <div className="space-y-1"><Label htmlFor="tcs-pieces">Pieces</Label><Input id="tcs-pieces" inputMode="numeric" value={f.pieces} onChange={set('pieces')} required disabled={busy} /></div>
        <div className="col-span-2 space-y-1">
          <Label htmlFor="tcs-cod">Cash to collect (PKR)</Label>
          <Input id="tcs-cod" inputMode="numeric" value={f.cod === '0' ? '' : f.cod} placeholder="0, paid" onChange={set('cod')} disabled={busy} />
          <p className="text-2xs text-muted-foreground">What is still owed on it, delivery included. Leave blank if it is paid.</p>
        </div>
        <div className="col-span-2 space-y-1"><Label htmlFor="tcs-remarks">Note for the rider (optional)</Label><Input id="tcs-remarks" value={f.remarks} onChange={set('remarks')} disabled={busy} /></div>
      </div>
      {shopifyOrder && (
        <div className="space-y-2 rounded-md border p-2.5">
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={fulfil} onCheckedChange={v => setFulfil(!!v)} disabled={busy} />
            <span>Also mark fulfilled on Shopify with this number, so Shopify and the customer see the tracking.
              <span className="block text-muted-foreground">If Universal Courier is set to book every fulfilment, untick this, or it may book a second parcel.</span></span>
          </label>
          {fulfil && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={notify} onCheckedChange={v => setNotify(!!v)} disabled={busy} />
              Email the customer the tracking
            </label>
          )}
        </div>
      )}
      {error && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={busy || !data.booking.ready} className="w-full sm:w-auto">
          <BusyLabel busy={busy}><Truck className="mr-2 h-4 w-4" />Book with TCS</BusyLabel>
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BookTcsDialog({ target, open, onOpenChange, children }: { target: ShipTarget; open: boolean; onOpenChange: (o: boolean) => void; children?: React.ReactNode }) {
  const [booked, setBooked] = useState<TcsBooking | null>(null);
  useEffect(() => { if (!open) setBooked(null); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center"><Truck className="mr-2 h-5 w-5" />{booked ? `Booked: ${booked.cn}` : 'Book with TCS'}</DialogTitle>
          <DialogDescription>{booked ? 'Print the slip and tape it on the parcel.' : 'Books the parcel with TCS straight from here and gives its consignment number.'}</DialogDescription>
        </DialogHeader>
        {booked ? (
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
            <Button onClick={() => void printShippingSlip(booked)}><Printer className="mr-2 h-4 w-4" />Shipping slip</Button>
          </DialogFooter>
        ) : open && (
          <>
            <BookTcsForm target={target} onBooked={setBooked} />
            {children}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Tracking ────────────────────────────────────────────────────────────────

/**
 * Where the parcel is: the latest word, then every scan newest first, with TCS's page linked. Shown once the order has a
 * number or Shopify has shipped it. `refreshKey` changing asks again (the menu's Track).
 */
export function TrackingCard({ target, booking, hasParcel, refreshKey = 0, onCancelled }: {
  target: ShipTarget; booking?: TcsBooking | null; hasParcel: boolean; refreshKey?: number; onCancelled?: () => void;
}) {
  const { toast } = useToast();
  const [t, setT] = useState<Tracking | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [all, setAll] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback((fresh: boolean) => {
    setBusy(true); setError(null);
    authedFetch(`/api/app/tracking?${q(target)}${fresh ? '&fresh=1' : ''}`).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Could not read tracking (${r.status}).`);
      setT(d.tracking ?? null);
    }).catch(e => setError(e instanceof Error ? e.message : 'Could not read tracking.')).finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.id]);

  useEffect(() => { if (hasParcel) load(refreshKey > 0); }, [hasParcel, load, refreshKey]);
  if (!hasParcel) return null;

  const cancel = async () => {
    setCancelling(true);
    try {
      await writeOp({ op: 'cancelTcs', ...idField(target) });
      toast({ title: 'TCS booking cancelled' });
      setConfirmCancel(false);
      onCancelled?.();
    } catch (e) {
      toast({ title: 'Not cancelled', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setCancelling(false); }
  };

  const events = t?.events ?? [];
  const shown = all ? events : events.slice(0, 6);
  const live = booking && !booking.cancelledAt ? booking : null;
  return (
    <div className="mb-6 space-y-3 rounded-tile bg-muted/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center font-semibold"><PackageSearch className="mr-2 h-4 w-4" />Tracking{t?.cn ? ` · ${t.carrier} ${t.cn}` : live ? ` · TCS ${live.cn}` : ''}</p>
        <div className="flex items-center gap-1">
          {t && <Pill tone={trackingTone(t.state)}>{t.status}</Pill>}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => load(true)} disabled={busy} aria-label="Refresh tracking">
            <RefreshCw className={busy ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </Button>
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">{error}<Button size="sm" variant="outline" onClick={() => load(true)}>Retry</Button></div>
      )}
      {t === undefined && !error && <div className="h-16 animate-pulse rounded-md bg-muted" />}
      {t === null && !error && <p className="text-sm text-muted-foreground">No word from the courier yet.</p>}
      {t && (
        <>
          {t.state === 'delivered' && (t.deliveredAt || t.receivedBy) && (
            <p className="text-sm">Delivered{t.deliveredAt ? ` ${formatDate(t.deliveredAt, 'd MMM, h:mm a')}` : ''}{t.receivedBy ? ` · received by ${t.receivedBy}` : ''}</p>
          )}
          {shown.length > 0 ? (
            <ol className="relative space-y-2 border-l pl-4 text-xs">
              {shown.map((e, i) => (
                <li key={`${e.at}-${i}`} className="relative">
                  <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ${i === 0 ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
                  <span className="block font-medium">{e.status}</span>
                  <span className="text-muted-foreground">{Number.isFinite(Date.parse(e.at)) ? formatDate(e.at, 'd MMM, h:mm a') : e.at}{e.location ? ` · ${e.location}` : ''}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted-foreground">No scans yet.</p>}
          {events.length > shown.length && <button type="button" className="text-xs text-primary hover:underline" onClick={() => setAll(true)}>Show all {events.length}</button>}
          <p className="text-2xs text-muted-foreground">From {t.source === 'tcs' ? 'TCS' : 'Shopify'} · checked {formatDate(t.checkedAt, 'h:mm a')}</p>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {live && <Button size="sm" variant="outline" onClick={() => void printShippingSlip(live)}><Printer className="mr-2 h-4 w-4" />Shipping slip</Button>}
        {t?.url && (
          <Button size="sm" variant="ghost" asChild>
            <a href={t.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />On {t.carrier}&apos;s site</a>
          </Button>
        )}
        {live && (!t || ['booked', 'shipped', 'unfulfilled'].includes(t.state)) && (
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmCancel(true)}><X className="mr-2 h-4 w-4" />Cancel booking</Button>
        )}
      </div>
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel TCS booking {live?.cn}?</AlertDialogTitle>
            <AlertDialogDescription>TCS voids the consignment; tear up its slip. A Shopify fulfilment made with it stays until it is cancelled on Shopify.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={e => { e.preventDefault(); void cancel(); }} disabled={cancelling} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <BusyLabel busy={cancelling}>Cancel booking</BusyLabel>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
