'use client';

/**
 * An online order's own panel on the order page, and the transfer check the Orders hub opens from
 * its card (TransferDialog): where the money stands, the slips the customer sent, the moves
 * (transfer received → ship → delivered, or let it lapse), and the link the customer is looking at.
 * Shown only for orders that came from taheri.shop, confirmed from the inbox (online-inbox.tsx).
 *
 * Every action goes through /api/website/orders/:id rather than writing the document from here,
 * because each one sends WhatsApp from the shop's number, the transfer books money (an advance and
 * the delivery as extra revenue), and shipping holds Leopards' credentials.
 */

import React, { useEffect, useState } from 'react';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import type { Order } from '@/lib/store';
import { staffFetch } from '@/lib/website/online-client';
import { getAuth } from 'firebase/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Globe, Truck, Banknote, PackageCheck, RefreshCw, ExternalLink, FileText, Loader2, Ban, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const fmt = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;
/** "4 Oct, 11:12 am". */
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

type W = NonNullable<Order['website']>;

/** What the customer pays: the pieces and the delivery (the order's grandTotal is the ERP's balance). */
export const onlineTotal = (order: Order) => (typeof order.website?.total === 'number' ? order.website.total : (Number(order.subtotal) || 0) + (order.website?.deliveryCharge || 0));

const PAY_LABEL: Record<W['paymentStatus'], string> = {
  awaiting_transfer: 'Awaiting transfer',
  slip_sent: 'Slip sent — check the bank',
  transfer_received: 'Transfer received',
  refunded: 'Refunded',
  expired: 'Lapsed',
};

function useAction(order: Order) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, body: Record<string, unknown> | null, after?: (d: unknown) => void) => {
    setBusy(label);
    try {
      const d = await staffFetch(`/api/website/orders/${encodeURIComponent(order.id)}`, body);
      after?.(d);
      const n = (d as { notified?: string | null }).notified;
      toast({ title: label, description: n ? `Done — but the customer's WhatsApp did not send: ${n}` : 'Done. The customer has been told on WhatsApp.' });
      return true;
    } catch (e) {
      toast({ title: `${label} failed`, description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      return false;
    } finally { setBusy(null); }
  };
  return { busy, run };
}

/** The slips the customer sent, each opening the file (fetched with the account's token). */
function Slips({ order }: { order: Order }) {
  const { toast } = useToast();
  const [opening, setOpening] = useState<string | null>(null);
  const slips = order.website?.slips ?? [];
  if (!slips.length) return null;
  const open = async (id: string) => {
    // A window opened now, before the await, is one Safari will not block.
    const win = window.open('', '_blank');
    setOpening(id);
    try {
      const tk = await getAuth().currentUser?.getIdToken();
      const res = await fetch(`/api/website/orders/${encodeURIComponent(order.id)}/slips/${encodeURIComponent(id)}`, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      if (win) win.location.href = url; else window.location.href = url;
    } catch (e) {
      win?.close();
      toast({ title: 'The slip did not open', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setOpening(null); }
  };
  return (
    <ul className="space-y-1.5">
      {slips.map(s => (
        <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-2.5 py-1.5 text-sm">
          <Button type="button" size="sm" variant="secondary" className="h-7" disabled={opening === s.id} onClick={() => open(s.id)}>
            {opening === s.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileText className="mr-1.5 h-3.5 w-3.5" />}Slip
          </Button>
          <span className="text-xs text-muted-foreground">{when(s.at)}</span>
          {s.amount ? <span className={cn('text-xs tabular-nums', Math.abs(s.amount - onlineTotal(order)) > 0.5 && 'font-semibold text-destructive')}>{fmt(s.amount)}{Math.abs(s.amount - onlineTotal(order)) > 0.5 ? ' — not the total' : ''}</span> : null}
          {s.fromBank && <span className="text-xs">{s.fromBank}</span>}
          {s.reference && <span className="text-xs text-muted-foreground">ref {s.reference}</span>}
        </li>
      ))}
    </ul>
  );
}

function HoldLine({ w }: { w: W }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 60_000); return () => clearInterval(t); }, []);
  if (!w.holdUntil || w.paymentStatus === 'transfer_received' || w.paymentStatus === 'expired') return null;
  const ended = Date.parse(w.holdUntil) <= Date.now();
  return (
    <p className={cn('flex items-center gap-1.5 text-xs', ended ? 'font-medium text-destructive' : 'text-muted-foreground')}>
      <Clock className="h-3.5 w-3.5" />
      {ended ? `The price hold ended ${formatDistanceToNowStrict(parseISO(w.holdUntil), { addSuffix: true })}. Check the bank before anything else.` : `Price held until ${new Date(w.holdUntil).toLocaleString('en-PK', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} (${formatDistanceToNowStrict(parseISO(w.holdUntil))} left).`}
    </p>
  );
}

/** Transfer received, or let it lapse — with a confirmation, because both message the customer. */
function MoneyMoves({ order, onDone }: { order: Order; onDone?: () => void }) {
  const { busy, run } = useAction(order);
  const [ask, setAsk] = useState<'paid' | 'lapse' | null>(null);
  const w = order.website!;
  const total = onlineTotal(order);
  const go = async () => {
    const ok = ask === 'paid'
      ? await run('Transfer received', { action: 'transfer_received' })
      : await run('Lapsed', { action: 'lapse' });
    if (ok) { setAsk(null); onDone?.(); }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAsk('paid')} disabled={!!busy} className="h-auto min-h-10 whitespace-normal py-2 text-left"><Banknote className="mr-2 h-4 w-4 flex-shrink-0" />Transfer received — {fmt(total)}</Button>
        <Button variant="ghost" className="text-muted-foreground" onClick={() => setAsk('lapse')} disabled={!!busy}><Ban className="mr-1.5 h-4 w-4" />Let it lapse</Button>
      </div>
      <Dialog open={!!ask} onOpenChange={o => { if (!busy && !o) setAsk(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{ask === 'paid' ? `${fmt(total)} is in the account?` : `Let ${w.onlineId || order.id} lapse?`}</DialogTitle>
            <DialogDescription>
              {ask === 'paid'
                ? <>Only once you see it in the bank — a slip is not the money. The order is paid in full ({fmt(Number(order.subtotal) || 0)} for the pieces as a bank-transfer advance{w.deliveryCharge ? `, ${fmt(w.deliveryCharge)} delivery as extra revenue` : ''}), {order.customerName || 'the customer'} is told, and it is ready to give out.</>
                : <>Only once you have checked the bank and nothing came. The order is cancelled and {order.customerName || 'the customer'} is told it lapsed and can order again at today&apos;s rate.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={!!busy} onClick={() => setAsk(null)}>Not yet</Button>
            <Button variant={ask === 'lapse' ? 'destructive' : 'default'} disabled={!!busy} onClick={go}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}{ask === 'paid' ? 'Yes, it is in' : 'Let it lapse'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The Orders hub's "Check transfer": the slips, the hold, and the two moves, without opening the order. */
export function TransferDialog({ order, open, onOpenChange }: { order: Order; open: boolean; onOpenChange: (o: boolean) => void }) {
  const w = order.website;
  if (!w) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{order.id}{w.onlineId ? ` · ${w.onlineId}` : ''}</DialogTitle>
          <DialogDescription>{order.customerName} · {fmt(onlineTotal(order))} by bank transfer · {PAY_LABEL[w.paymentStatus]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <HoldLine w={w} />
          {w.slips?.length ? <Slips order={order} /> : <p className="text-sm text-muted-foreground">No slip yet. People often pay and send the slip on WhatsApp instead: check the bank and the chat.</p>}
          <MoneyMoves order={order} onDone={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WebsiteOrderPanel({ order }: { order: Order }) {
  const { busy, run } = useAction(order);
  const [cn_, setCn] = useState('');
  const [track, setTrack] = useState<{ status: string; history: { at: string; status: string; location?: string }[] } | null>(null);
  const w = order.website;
  if (!w) return null;

  const paid = w.paymentStatus === 'transfer_received';
  const lapsed = w.paymentStatus === 'expired';
  const shipped = !!order.leopards?.cn;
  const delivered = !!order.leopards?.deliveredAt;
  const ref = w.onlineId || order.id;
  const statusUrl = `${process.env.NEXT_PUBLIC_STORE_WEBSITE_URL || 'https://taheri.shop'}/order/${encodeURIComponent(ref)}?t=${encodeURIComponent(w.token)}`;
  const tone = paid ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' : lapsed ? 'border-muted-foreground/40 text-muted-foreground' : 'border-amber-500/40 text-amber-700 dark:text-amber-300';

  return (
    <Card className="border-sky-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex flex-wrap items-center gap-2"><Globe className="h-4 w-4" /> Online order{w.onlineId ? ` ${w.onlineId}` : ''}
          <Badge variant="outline" className={tone}>{PAY_LABEL[w.paymentStatus]}</Badge>
          {shipped && <Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-300">{delivered ? 'Delivered' : `Leopards ${order.leopards!.cn}`}</Badge>}
        </CardTitle>
        <CardDescription>
          Placed {when(w.placedAt)}{w.confirmedAt ? ` · confirmed ${when(w.confirmedAt)}${w.confirmedBy && w.confirmedBy !== 'dev-bypass' ? ` by ${w.confirmedBy.split('@')[0]}` : ''}` : ''} · paid in full by bank transfer · {fmt(onlineTotal(order))}
          {w.deliveryCharge ? ` (incl. ${fmt(w.deliveryCharge)} delivery)` : ''} · {order.delivery?.city}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          <span className="text-muted-foreground">Customer&apos;s order page: </span>
          <a href={statusUrl} target="_blank" rel="noopener" className="text-primary underline underline-offset-2 inline-flex items-center gap-1 break-all">{statusUrl.replace(/\?t=.*$/, '?t=…')} <ExternalLink className="h-3 w-3" /></a>
        </div>

        <HoldLine w={w} />
        <Slips order={order} />

        {!paid && !lapsed && order.status !== 'Cancelled' && <MoneyMoves order={order} />}

        {paid && !shipped && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => run('Booked with Leopards', { action: 'ship' })} disabled={!!busy}>
                <Truck className="h-4 w-4 mr-2" /> Book with Leopards
              </Button>
              <span className="text-xs text-muted-foreground">or enter a CN booked at the counter:</span>
              <Input className="w-44" placeholder="CN number" value={cn_} onChange={e => setCn(e.target.value)} />
              <Button variant="secondary" onClick={() => run('Shipped', { action: 'ship', cn: cn_ })} disabled={!!busy || cn_.trim().length < 6}>Use this CN</Button>
            </div>
          </div>
        )}

        {shipped && (
          <div className="flex flex-wrap items-center gap-2">
            <a href={order.leopards!.trackingUrl} target="_blank" rel="noopener" className="text-sm text-primary underline underline-offset-2">Track {order.leopards!.cn} on Leopards</a>
            {!delivered && (
              <>
                <Button variant="secondary" size="sm" onClick={() => run('Tracking refreshed', null, d => setTrack(d as typeof track))} disabled={!!busy}><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh</Button>
                <Button size="sm" onClick={() => run('Delivered', { action: 'delivered' })} disabled={!!busy}><PackageCheck className="h-3.5 w-3.5 mr-1.5" /> Mark delivered</Button>
              </>
            )}
            {track && (
              <ul className="w-full text-xs text-muted-foreground mt-1 space-y-0.5">
                <li className="font-medium text-foreground">{track.status}</li>
                {track.history.slice(-5).map((h, i) => <li key={i}>{h.at} — {h.status}{h.location ? ` · ${h.location}` : ''}</li>)}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
