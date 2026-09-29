'use client';

/**
 * Setup → the website pixel: choose the ad account's pixel (or make one), and see whether the
 * website loads it and Meta receives it. Kept apart from the page's other steps.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, AlertTriangle, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PixelRow, PixelState } from '@/lib/ads/pixel';
import { api } from '../ads-kit';

const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };

/** Meta's standard events, in the order a buyer meets them; anything else after. */
const EVENT_ORDER = ['PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Purchase'];
const EVENT_WORD: Record<string, string> = { PageView: 'page views', ViewContent: 'pieces viewed', Search: 'searches', AddToCart: 'added to cart', InitiateCheckout: 'checkouts started', AddPaymentInfo: 'payment details', Purchase: 'orders' };
function eventLine(ev: Record<string, number>): string {
  const keys = Object.keys(ev).filter(k => ev[k] > 0).sort((a, b) => (EVENT_ORDER.indexOf(a) + 1 || 99) - (EVENT_ORDER.indexOf(b) + 1 || 99));
  return keys.length ? keys.map(k => `${ev[k].toLocaleString()} ${EVENT_WORD[k] ?? k}`).join(' · ') : 'nothing';
}

export function PixelStep({ ready }: { ready: boolean }) {
  const { toast } = useToast();
  const [data, setData] = useState<{ pixels: PixelRow[]; state: PixelState } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('Website');
  const load = useCallback(async () => {
    try { setData(await api<{ pixels: PixelRow[]; state: PixelState }>('/api/ads/pixel')); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (ready) load(); }, [ready, load]);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { await api('/api/ads/pixel', { body }); await load(); }
    catch (e) { toast({ title: 'Couldn’t change the pixel', description: e instanceof Error ? e.message : String(e), variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  if (!ready) return <p className="text-muted-foreground">Connect and choose the ad account first.</p>;
  if (error) return <p className="text-destructive">{error}</p>;
  if (!data) return <p className="text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> Reading the ad account’s pixels…</p>;
  const st = data.state;
  const listed = new Set(data.pixels.map(p => p.id));
  // Pixels the house's own sites already carry (House of Mina's Shopify store, through Shopify's Facebook app).
  const carried = [...new Set(st.sites.flatMap(x => x.ids ?? []))];
  const onWhich = (id: string) => st.sites.filter(x => x.ids?.includes(id)).map(x => host(x.url)).join(' and ');
  const chosenCarried = !!st.id && carried.includes(st.id);
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">With a pixel on the website, Meta can retarget people who looked at a piece, build audiences of them, buy page views instead of clicks — and, once it records orders, look for people who buy (“Online orders” on New ad).</p>
      {carried.filter(id => id !== st.id).map(id => (
        <div key={id} className="rounded-lg p-2 text-xs space-y-1 bg-primary/5 border border-primary/30">
          <p className="font-medium flex items-center gap-1.5"><Globe className="h-3.5 w-3.5" /> {onWhich(id)} already carries pixel {id}</p>
          {listed.has(id)
            ? <p>Use it rather than making another: one pixel keeps every visit and order in one place, and its history is already there.</p>
            : <p>It isn’t shared with this ad account yet, so Meta won’t let ads use it. In Meta Business settings → Data sources → Datasets, open {id} → Assign assets → this ad account (full control); then it appears in the list below. A shop app (Shopify’s Facebook &amp; Instagram channel) usually made it under its own business portfolio — the owner of that portfolio shares it.</p>}
          <Button size="sm" variant={listed.has(id) ? 'default' : 'outline'} disabled={busy} onClick={() => act({ action: 'choose', id })}>{listed.has(id) ? 'Use this pixel' : 'Use it anyway (after sharing it)'}</Button>
        </div>
      ))}
      {st.id ? (
        <div className={cn('rounded-lg p-2 text-xs space-y-0.5', st.live ? 'bg-success/10' : 'bg-warning/10')}>
          <p className="font-medium flex items-center gap-1.5">{st.live ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />} Pixel {st.id} {st.live ? 'is receiving from the website' : 'has not received anything this week'}</p>
          {st.lastFired && <p>Last received {new Date(st.lastFired).toLocaleString()}.</p>}
          {chosenCarried && <p className="flex items-center gap-1"><Globe className="h-3 w-3" /> On {onWhich(st.id!)}.</p>}
          {st.onSite === false && <p className="flex items-center gap-1"><Globe className="h-3 w-3" /> {st.sites.map(x => host(x.url)).join(' and ')} {st.sites.length > 1 ? 'don’t' : 'doesn’t'} load it yet — {carried.length ? 'the site carries a different pixel (above)' : 'the website needs its loader (it reads the id from this ERP’s /api/public/pixel)'}.</p>}
          {st.events && <p>This week: {eventLine(st.events)}.</p>}
          {st.live && <p>Website ads now buy landing-page views{(st.events?.Purchase ?? 0) > 0 ? '; “Online orders” can buy purchases' : ''}.</p>}
        </div>
      ) : <p className="text-xs text-warning">No pixel chosen: website ads buy clicks, and nobody who visits can be retargeted.</p>}
      {data.pixels.length > 0 && (
        <ul className="space-y-1">
          {data.pixels.map(p => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate">{p.name} <span className="text-muted-foreground">· {p.id}{p.lastFired ? ` · last ${new Date(p.lastFired).toLocaleDateString()}` : ' · never fired'}</span></span>
              {st.id === p.id ? <span className="text-success font-medium">In use</span> : <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: 'choose', id: p.id })}>Use this</Button>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-base sm:text-xs max-w-[14rem]" aria-label="New pixel’s name" />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (carried.length && !confirm(`The site already carries pixel ${carried.join(', ')}. A second pixel splits visits and orders between two — make one anyway?`)) return; act({ action: 'create', name }); }}>{busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Make a new pixel</Button>
        {st.id && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act({ action: 'choose', id: null })}>Stop using it</Button>}
      </div>
    </div>
  );
}
