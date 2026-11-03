'use client';

/**
 * Live — who is on the house's website right now (the owner, 2026-10-23: "live visitors"), as Shopify's live view:
 * visitors in the last five minutes, the page each is on, where they are, how they came, new or returning, and
 * today's running totals. Asked again every 15 seconds while the tab is open and visible.
 * The open pages beat every 30 seconds (the sites' visits.js), so a visitor drops off within five minutes of leaving.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { auth as firebaseAuth } from '@/lib/firebase';
import { PageShell } from '@/components/shared/page-shell';
import { Loader2, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_LINKS, STORE_SHOPIFY_ANALYTICS } from '@/lib/store-config';
import { ShopifyLive } from '../shopify-live';
import { ViewSwitch, useView } from '../view-switch';
import { Tile } from '@/app/insights/insights-kit';
import { Card, cityRows, countryName, DEVICE, duration, flag, pageLabel, pct, Ranked, sourceLabel, SwitchCard } from '../site-kit';
import { FigureTilesSkeleton, ListRowsSkeleton } from '@/components/shared/skeletons';

interface Live {
  at: number; visitors: number; newVisitors: number;
  pages: { key: string; value: number }[]; countries: { key: string; value: number }[]; cities: { key: string; value: number }[];
  sources: { key: string; value: number }[]; devices: { key: string; value: number }[];
  sessions: { path: string; kind: string; cc: string; region: string; city: string; device: string; browser: string; source: string; isNew: boolean; pages: number; forMs: number; ago: number }[];
  today: { sessions: number; visitors: number; pageviews: number; enquiries: number; saves: number; pieces: number; conversion: number; bounceRate: number; avgSessionMs: number };
}

const site = (STORE_LINKS.website || '').replace(/\/+$/, '');

function CatalogueLivePage({ switcher }: { switcher?: React.ReactNode } = {}) {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState('');
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const t = await firebaseAuth?.currentUser?.getIdToken().catch(() => null);
      const r = await fetch('/api/website/analytics/live', { headers: t ? { Authorization: `Bearer ${t}` } : {}, cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not load');
      setLive(d); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { busy.current = false; }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15_000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const cities = (live?.cities ?? []).map(c => { const [cc, region, city] = c.key.split('|'); return { cc, region, city, sessions: c.value }; });

  return (
    <PageShell subtitle={`On ${site.replace(/^https?:\/\//, '') || 'the website'} in the last five minutes · updates by itself`}>
      {switcher}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!live && !error && <div className="space-y-4"><FigureTilesSkeleton tiles={3} /><ListRowsSkeleton rows={4} /></div>}
      {live && (
        <>
          <section className="rounded-[22px] bg-card p-5 flex items-center gap-4">
            <span className={cn('relative flex h-3 w-3', !live.visitors && 'opacity-40')}>
              {live.visitors > 0 && <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-60 animate-ping motion-reduce:animate-none" />}
              <span className="relative inline-flex h-3 w-3 rounded-full bg-success" />
            </span>
            <div>
              <p className="text-4xl font-semibold tabular-nums leading-none font-serif">{live.visitors}</p>
              <p className="text-sm text-muted-foreground mt-1">{live.visitors === 1 ? 'person' : 'people'} on the site now{live.visitors ? ` · ${live.newVisitors} new, ${live.visitors - live.newVisitors} returning` : ''}</p>
            </div>
            <Radio className="h-5 w-5 ml-auto text-muted-foreground" />
          </section>

          <div>
            <h2 className="text-sm font-semibold mb-2">Today so far</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              <Tile label="Sessions" value={live.today.sessions.toLocaleString('en-US')} sub={`${live.today.visitors.toLocaleString('en-US')} people`} />
              <Tile label="Page views" value={live.today.pageviews.toLocaleString('en-US')} sub={`${duration(live.today.avgSessionMs)} a session`} />
              <Tile label="Opened a piece" value={live.today.pieces.toLocaleString('en-US')} sub={`${live.today.saves.toLocaleString('en-US')} saved one`} />
              <Tile label="Asked on WhatsApp" value={live.today.enquiries.toLocaleString('en-US')} sub={`${pct(live.today.conversion, 1)} of sessions`} />
            </div>
          </div>

          {live.visitors > 0 && (
            <>
              <div className="grid gap-2.5 md:grid-cols-2">
                <SwitchCard title="Where they are" views={[
                  { key: 'city', label: 'Cities', node: <Ranked rows={cityRows(live.countries, cities)} total={live.visitors} /> },
                  { key: 'country', label: 'Countries', node: <Ranked rows={live.countries.map(c => ({ key: c.key, value: c.value, label: <>{flag(c.key)} {countryName(c.key)}</> }))} total={live.visitors} /> },
                ]} />
                <Card title="What they're looking at"><Ranked rows={live.pages.map(p => ({ key: p.key, value: p.value, label: pageLabel(p.key), href: site ? site + p.key : undefined }))} total={live.visitors} /></Card>
                <Card title="How they came"><Ranked rows={live.sources.map(s => ({ ...s, label: sourceLabel(s.key) }))} total={live.visitors} /></Card>
                <Card title="On"><Ranked rows={live.devices.map(d => ({ ...d, label: DEVICE[d.key] ?? d.key }))} total={live.visitors} /></Card>
              </div>

              <Card title="Each visit" note="newest first; no names, no addresses">
                <ul className="divide-y">
                  {live.sessions.map((s, i) => (
                    <li key={i} className="py-2 flex items-start gap-3 text-sm">
                      <span className="text-lg leading-none mt-0.5" aria-hidden>{flag(s.cc)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{pageLabel(s.path)}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[s.city, countryName(s.cc)].filter(Boolean).join(', ')} · {sourceLabel(s.source)} · {DEVICE[s.device] ?? s.device}{s.browser ? `, ${s.browser}` : ''} · {s.isNew ? 'new' : 'returning'}
                        </p>
                      </div>
                      <div className="text-right text-xs text-muted-foreground tabular-nums shrink-0">
                        <p>{s.pages} page{s.pages === 1 ? '' : 's'}{s.forMs ? ` · ${duration(s.forMs)}` : ''}</p>
                        <p>{s.ago < 60_000 ? 'now' : `${Math.round(s.ago / 60_000)}m ago`}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}
          {!live.visitors && <p className="text-sm text-muted-foreground">No one on the site at the moment. Visits are counted from 23 October 2026.</p>}
        </>
      )}
    </PageShell>
  );
}

/** House of Mina: the Shopify store's right-now picture first, the catalogue's own live counter a tap away. */
export default function LivePage() {
  const [view, setView] = useView('live');
  if (!STORE_SHOPIFY_ANALYTICS) return <CatalogueLivePage />;
  if (view === 'catalogue') return <CatalogueLivePage switcher={<ViewSwitch view={view} onChange={setView} />} />;
  return (
    <PageShell subtitle="The online store right now — Shopify has no live view, so this is its latest sessions, orders and checkouts">
      <ViewSwitch view={view} onChange={setView} />
      <ShopifyLive />
    </PageShell>
  );
}
