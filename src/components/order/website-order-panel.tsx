'use client';

/**
 * The website order's own panel on the order page: where the money stands,
 * the three moves (transfer received → ship → delivered), and the link the
 * customer is looking at. Shown only for orders that came from taheri.shop.
 *
 * Every action goes through /api/website/orders/:id rather than writing the
 * document from here, because each one sends WhatsApp from the shop's number
 * and the shipping one holds Leopards' credentials.
 */

import React, { useState } from 'react';
import { getAuth } from 'firebase/auth';
import type { Order } from '@/lib/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Globe, Truck, Banknote, PackageCheck, RefreshCw, ExternalLink } from 'lucide-react';

const fmt = (n: number) => `Rs ${Math.round(n).toLocaleString('en-PK')}`;

async function call(id: string, body: Record<string, unknown> | null) {
  const tk = await getAuth().currentUser?.getIdToken();
  const res = await fetch(`/api/website/orders/${encodeURIComponent(id)}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  return data;
}

export function WebsiteOrderPanel({ order, onChanged }: { order: Order; onChanged?: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [cn, setCn] = useState('');
  const [track, setTrack] = useState<{ status: string; history: { at: string; status: string; location?: string }[] } | null>(null);
  const w = order.website;
  if (!w) return null;

  const paid = w.paymentStatus === 'transfer_received';
  const shipped = !!order.leopards?.cn;
  const delivered = !!order.leopards?.deliveredAt;
  const statusUrl = `${process.env.NEXT_PUBLIC_STORE_WEBSITE_URL || 'https://taheri.shop'}/order/${encodeURIComponent(order.id)}?t=${encodeURIComponent(w.token)}`;

  const run = async (label: string, body: Record<string, unknown> | null, after?: (d: unknown) => void) => {
    setBusy(label);
    try {
      const d = await call(order.id, body);
      after?.(d);
      onChanged?.();
      const n = (d as { notified?: string | null }).notified;
      toast({ title: label, description: n ? `Done — but the customer's WhatsApp did not send: ${n}` : 'Done. The customer has been told on WhatsApp.' });
    } catch (e) {
      toast({ title: `${label} failed`, description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally { setBusy(null); }
  };

  return (
    <Card className="border-sky-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2"><Globe className="h-4 w-4" /> Website order
          <Badge variant="outline" className={paid ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/40 text-amber-700 dark:text-amber-300'}>
            {paid ? 'Transfer received' : 'Awaiting transfer'}
          </Badge>
          {shipped && <Badge variant="outline" className="border-sky-500/40 text-sky-700 dark:text-sky-300">{delivered ? 'Delivered' : `Leopards ${order.leopards!.cn}`}</Badge>}
        </CardTitle>
        <CardDescription>
          Placed {new Date(w.placedAt).toLocaleString('en-PK')} · full advance by bank transfer · {fmt(order.grandTotal)}
          {w.deliveryCharge ? ` (incl. ${fmt(w.deliveryCharge)} delivery)` : ''} · {order.delivery?.city}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          <span className="text-muted-foreground">Customer&apos;s order page: </span>
          <a href={statusUrl} target="_blank" rel="noopener" className="text-primary underline underline-offset-2 inline-flex items-center gap-1 break-all">{statusUrl.replace(/\?t=.*$/, '?t=…')} <ExternalLink className="h-3 w-3" /></a>
        </div>

        {!paid && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => run('Transfer received', { action: 'transfer_received' })} disabled={!!busy}>
              <Banknote className="h-4 w-4 mr-2" /> Transfer received — {fmt(order.grandTotal)}
            </Button>
            <span className="text-xs text-muted-foreground">Marks the order paid in full and tells the customer.</span>
          </div>
        )}

        {paid && !shipped && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => run('Booked with Leopards', { action: 'ship' })} disabled={!!busy}>
                <Truck className="h-4 w-4 mr-2" /> Book with Leopards
              </Button>
              <span className="text-xs text-muted-foreground">or enter a CN booked at the counter:</span>
              <Input className="w-44" placeholder="CN number" value={cn} onChange={e => setCn(e.target.value)} />
              <Button variant="secondary" onClick={() => run('Shipped', { action: 'ship', cn })} disabled={!!busy || cn.trim().length < 6}>Use this CN</Button>
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
