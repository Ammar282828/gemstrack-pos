'use client';

/**
 * Interest — the house's website, counted the way Shopify's analytics counts a store (the owner, 2026-10-23: "add by
 * location, live visitors, everything Shopify shows for catalogue.hom and taheri.shop"), and which of its pieces people
 * save, ask about on WhatsApp, open and stay on (2026-10-22: "which ones are saved, inquired about, looked at for the
 * longest").
 *
 * One period for the whole page, compared with the one before it. Sessions, visitors, time and bounce; the funnel
 * the shop has (visit → piece → saved → WhatsApp), by source too; where people come from, where they are, on what;
 * the pages they arrive on, read and leave from; what they search; what isn't there. Then the four piece rankings.
 * Counted anonymously by the site itself (POST /api/public/events; lib/website/site-analytics.ts). Live is its own tab.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Line, ComposedChart } from 'recharts';
import { auth as firebaseAuth } from '@/lib/firebase';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Heart, Loader2, MessageCircle, Eye, Clock, RefreshCw, ExternalLink, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';
import { chartMotion } from '@/lib/chart-motion';
import { STORE_LINKS } from '@/lib/store-config';
import { Delta, Tile } from '@/app/insights/insights-kit';
import type { Summary } from '@/lib/website/site-analytics';
import { Card, CHANNEL, DEVICE, duration, pageLabel, pct, placeRows, Ranked, sourceLabel, type RankRow } from './site-kit';

interface Row {
  piece: string; name: string; thumb: string; url: string; collection: string;
  views: number; saves: number; unsaves: number; netSaves: number; enquiries: number;
  dwellMs: number; dwellN: number; avgDwellMs: number;
}

interface Report {
  range: string; from: string; to: string; days: number; previous: { from: string; to: string };
  today: string; since: string | null; visitorsExact: boolean;
  now: Summary; before: Summary;
  series: { day: string; sessions: number; visitors: number; pageviews: number; enquiries: number }[];
  hours: { hour: number; sessions: number; before: number }[] | null;
}

const LISTS = [
  { id: 'saved', label: 'Saved', icon: Heart, rank: (r: Row) => r.netSaves, show: (r: Row) => `${r.netSaves} saved` },
  { id: 'asked', label: 'Asked about', icon: MessageCircle, rank: (r: Row) => r.enquiries, show: (r: Row) => `${r.enquiries} on WhatsApp` },
  // A minimum of three looks, so one long stare doesn't top the list.
  { id: 'longest', label: 'Looked at longest', icon: Clock, rank: (r: Row) => (r.dwellN >= 3 ? r.avgDwellMs : 0), show: (r: Row) => `${secs(r.avgDwellMs)} on average · ${r.dwellN} looks` },
  { id: 'opened', label: 'Opened', icon: Eye, rank: (r: Row) => r.views, show: (r: Row) => `${r.views} opens` },
] as const;
type ListId = typeof LISTS[number]['id'];

const PERIODS = [
  { key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }, { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' }, { key: '90d', label: '90 days' }, { key: 'all', label: 'All time' }, { key: 'custom', label: 'Custom' },
] as const;
type PeriodKey = typeof PERIODS[number]['key'];
const PERIOD_KEY = 'erp.websiteInterest.period';

const secs = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${Math.round(ms / 1000)}s`);
const tip = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const site = (STORE_LINKS.website || '').replace(/\/+$/, '');

async function authHeaders(): Promise<Record<string, string>> {
  try { const t = await firebaseAuth?.currentUser?.getIdToken(); return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}
async function get<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: await authHeaders(), cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Could not load');
  return d as T;
}

export default function InterestPage() {
  const [period, setPeriodState] = useState<PeriodKey>('30d');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [report, setReport] = useState<Report | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [liveNow, setLiveNow] = useState<number | null>(null);
  const [list, setList] = useState<ListId>('saved');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { try { const v = localStorage.getItem(PERIOD_KEY); if (PERIODS.some(p => p.key === v) && v !== 'custom') setPeriodState(v as PeriodKey); } catch { /* private mode */ } }, []);
  const setPeriod = (p: PeriodKey) => { setPeriodState(p); try { if (p !== 'custom') localStorage.setItem(PERIOD_KEY, p); } catch { /* private mode */ } };

  const load = useCallback(async () => {
    if (period === 'custom' && !(custom.from && custom.to)) return;
    setLoading(true); setError('');
    const q = period === 'custom' ? `range=custom&from=${custom.from}&to=${custom.to}` : `range=${period}`;
    try {
      const r = await get<Report>(`/api/website/analytics?${q}`);
      setReport(r);
      // The piece rankings for the same days (the same period on both halves of the page).
      const p = await get<{ pieces: Row[] }>(`/api/website/interest?from=${r.from}&to=${r.to}`);
      setRows(p.pieces);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
    get<{ visitors: number }>('/api/website/analytics/live').then(l => setLiveNow(l.visitors)).catch(() => {});
  }, [period, custom.from, custom.to]);
  useEffect(() => { load(); }, [load]);

  const n = report?.now, b = report?.before;
  const active = LISTS.find(l => l.id === list)!;
  const ranked = useMemo(() => (rows || []).filter(r => active.rank(r) > 0).sort((a, c) => active.rank(c) - active.rank(a)).slice(0, 40), [rows, active]);

  const pageRows = (xs: { key: string; value: number }[]): RankRow[] => xs.map(x => ({ key: x.key, value: x.value, label: pageLabel(x.key), href: site ? site + x.key : undefined }));
  const chart = report?.hours
    ? report.hours.map(h => ({ label: `${String(h.hour).padStart(2, '0')}:00`, sessions: h.sessions, before: h.before }))
    : (report?.series ?? []).map(d => ({ label: shortDay(d.day), sessions: d.sessions, visitors: d.visitors, enquiries: d.enquiries }));

  return (
    <PageShell subtitle={`What visitors to ${site.replace(/^https?:\/\//, '') || 'the website'} do — counted anonymously, no person or address kept`}
      action={<Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Refresh</Button>}>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {PERIODS.map(p => (
          <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
            className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap min-h-0', period === p.key ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>{p.label}</button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Input type="date" className="w-auto" value={custom.from} max={report?.today} onChange={e => setCustom(c => ({ ...c, from: e.target.value }))} aria-label="From" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" className="w-auto" value={custom.to} max={report?.today} onChange={e => setCustom(c => ({ ...c, to: e.target.value }))} aria-label="To" />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !report && <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}

      {report && n && b && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {report.from === report.to ? shortDay(report.from) : `${shortDay(report.from)} → ${shortDay(report.to)}`} · compared with {report.previous.from === report.previous.to ? shortDay(report.previous.from) : `${shortDay(report.previous.from)} → ${shortDay(report.previous.to)}`}
            </p>
            <Link href="/website/interest/live" className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs">
              <Radio className={cn('h-3.5 w-3.5', liveNow ? 'text-success' : 'text-muted-foreground')} />
              {liveNow === null ? 'Live' : `${liveNow} on the site now`}
            </Link>
          </div>

          {!n.sessions && !b.sessions && (
            <p className="rounded-[22px] bg-card p-4 text-sm text-muted-foreground">Nothing counted in this period yet. Visits are counted from 23 October 2026; piece interest from 22 October. It fills as people use the website.</p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <Tile label="Sessions" value={n.sessions.toLocaleString('en-US')} delta={<Delta now={n.sessions} before={b.sessions} />} sub={`${n.pagesPerSession.toFixed(1)} pages each`} />
            <Tile label="Visitors" value={n.visitors.toLocaleString('en-US')} delta={<Delta now={n.visitors} before={b.visitors} />}
              sub={report.visitorsExact ? undefined : 'day by day, added'} title="People, by the random id the site keeps in their browser" />
            <Tile label="Page views" value={n.pageviews.toLocaleString('en-US')} delta={<Delta now={n.pageviews} before={b.pageviews} />} />
            <Tile label="Time on site" value={duration(n.avgSessionMs)} delta={<Delta now={n.avgSessionMs} before={b.avgSessionMs} />} sub="a session, on average" />
            <Tile label="Bounce rate" value={pct(n.bounceRate)} delta={<Delta now={n.bounceRate} before={b.bounceRate} invert />} sub="left after one page" />
            <Tile label="Asked on WhatsApp" value={n.funnel.enquire.toLocaleString('en-US')} delta={<Delta now={n.funnel.enquire} before={b.funnel.enquire} />} sub={`${pct(n.conversion, 1)} of sessions`} />
            <Tile label="Saved a piece" value={n.funnel.save.toLocaleString('en-US')} delta={<Delta now={n.funnel.save} before={b.funnel.save} />} sub="sessions" />
            <Tile label="Returning" value={pct(n.sessions ? n.returningSessions / n.sessions : 0)} delta={<Delta now={n.returningSessions} before={b.returningSessions} />} sub={`${n.returningSessions.toLocaleString('en-US')} sessions · ${n.newVisitors.toLocaleString('en-US')} new people`} />
          </div>

          {chart.length > 0 && (
            <Card title={report.hours ? 'Sessions by the hour' : 'Sessions, day by day'} note={report.hours ? 'Karachi time; the faint bars are the day before' : 'with visitors and WhatsApp enquiries'}>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  {report.hours ? (
                    <BarChart data={chart} margin={{ left: -18, right: 0, top: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} interval={2} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} />
                      <Bar {...chartMotion()} dataKey="before" name="Day before" fill="hsl(var(--muted-foreground) / 0.25)" radius={[3, 3, 0, 0]} maxBarSize={14} />
                      <Bar {...chartMotion()} dataKey="sessions" name="Sessions" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} maxBarSize={14} />
                    </BarChart>
                  ) : (
                    <ComposedChart data={chart} margin={{ left: -18, right: 0, top: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={14} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} />
                      <Bar {...chartMotion()} dataKey="sessions" name="Sessions" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={24} />
                      <Line {...chartMotion()} dataKey="visitors" name="Visitors" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} dot={false} type="monotone" />
                      <Line {...chartMotion()} dataKey="enquiries" name="WhatsApp" stroke="hsl(var(--success))" strokeWidth={2} dot={false} type="monotone" />
                    </ComposedChart>
                  )}
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          <Funnel now={n} before={b} />

          <div className="grid gap-2.5 md:grid-cols-2">
            <Card title="Where they came from" note="sessions">
              <Ranked rows={n.channels.map(c => ({ key: c.key, value: c.value, label: CHANNEL[c.key as keyof typeof CHANNEL] ?? c.key,
                children: n.sources.filter(s => s.channel === c.key).map(s => ({ key: s.key, value: s.sessions, label: sourceLabel(s.key), sub: s.enquire ? `${s.enquire} asked` : undefined })) }))}
                total={n.sessions} empty="No sessions yet." />
            </Card>
            <Card title="Where they are" note="sessions; tap a country for its cities">
              <Ranked rows={placeRows(n.countries, n.cities)} total={n.sessions} empty="No sessions yet." />
            </Card>
          </div>

          <SourceTable now={n} />

          {n.campaigns.length > 0 && (
            <Card title="Campaigns" note="utm_campaign on the link">
              <Ranked rows={n.campaigns.map(c => ({ key: c.key, value: c.value, label: c.key, sub: `${c.piece} opened a piece · ${c.enquire} asked` }))} total={n.sessions} />
            </Card>
          )}

          <div className="grid gap-2.5 md:grid-cols-3">
            <Card title="Device"><Ranked rows={n.devices.map(d => ({ ...d, label: DEVICE[d.key] ?? d.key }))} total={n.sessions} /></Card>
            <Card title="System"><Ranked rows={n.os.map(d => ({ ...d, label: d.key }))} total={n.sessions} /></Card>
            <Card title="Browser" note="Instagram and Facebook are their in-app browsers"><Ranked rows={n.browsers.map(d => ({ ...d, label: d.key }))} total={n.sessions} /></Card>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2">
            <Card title="Pages they arrived on" note="landing pages"><Ranked rows={pageRows(n.landing)} total={n.sessions} /></Card>
            <Card title="Pages they left from" note="exit pages"><Ranked rows={pageRows(n.exits)} total={n.sessions} /></Card>
            <Card title="Most viewed pages"><Ranked rows={pageRows(n.pages)} total={n.pageviews} /></Card>
            <Card title="Collections browsed"><Ranked rows={pageRows(n.collections)} empty="No collection pages opened yet." /></Card>
            <Card title="What they searched for" note="on the site">
              <Ranked rows={n.searches.map(s => ({ key: s.key, value: s.value, label: `“${s.key}”` }))} empty={site.includes('taheri.shop') ? 'taheri.shop has no search box; nothing to count.' : 'No searches yet.'} />
            </Card>
            <Card title="Pages not found" note="404s: a broken link somewhere, or a piece taken down">
              <Ranked rows={pageRows(n.notFound)} empty="None — every page asked for was there." />
            </Card>
          </div>
        </>
      )}

      <section className="space-y-3 pt-2">
        <h2 className="text-lg font-semibold">Pieces</h2>
        <p className="text-sm text-muted-foreground -mt-2">Which pieces people save, ask about on WhatsApp, open and stay on, in the same period.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {LISTS.map(l => (
            <button key={l.id} type="button" onClick={() => setList(l.id)}
              className={cn('flex items-center justify-center gap-2 rounded-full px-3 py-2 text-sm border', list === l.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-card hover:bg-muted')}>
              <l.icon className="h-4 w-4" /> {l.label}
            </button>
          ))}
        </div>
        {rows && !ranked.length && <p className="text-sm text-muted-foreground">Nothing counted for this in the period yet.</p>}
        <ol className="space-y-2">
          {ranked.map((r, i) => (
            <li key={r.piece} className="flex items-center gap-3 rounded-[22px] bg-card p-2.5 pr-4">
              <span className="w-6 text-center text-sm text-muted-foreground tabular-nums">{i + 1}</span>
              {r.thumb ? <img src={r.thumb} alt="" className="h-14 w-14 rounded-xl object-cover bg-muted shrink-0" loading="lazy" /> : <div className="h-14 w-14 rounded-xl bg-muted shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{r.name}</p>
                <p className="text-xs text-muted-foreground truncate">{active.show(r)}{r.collection ? ` · ${r.collection}` : ''}</p>
              </div>
              {r.url && <a href={r.url} target="_blank" rel="noopener" className="text-muted-foreground hover:text-foreground" aria-label={`Open ${r.name} on the website`}><ExternalLink className="h-4 w-4" /></a>}
            </li>
          ))}
        </ol>
      </section>

      <p className="text-[11px] text-muted-foreground">
        A session is one visit; a new one starts after 30 minutes away. Visitors are told apart by a random id their browser keeps, never by name or address;
        visitors who ask not to be tracked (Do Not Track) and bots are not counted. Places come from the visitor&rsquo;s network address, looked up and
        then forgotten — <a href="https://db-ip.com" target="_blank" rel="noopener" className="underline">IP Geolocation by DB-IP</a>; city for Pakistan and the Gulf, the country elsewhere.
      </p>
    </PageShell>
  );
}

/** Visit → opened a piece → saved → asked on WhatsApp: each step's sessions, its share of the step before and of all. */
function Funnel({ now, before }: { now: Summary; before: Summary }) {
  const steps = [
    { label: 'Visited', n: now.funnel.sessions, b: before.funnel.sessions },
    { label: 'Opened a piece', n: now.funnel.piece, b: before.funnel.piece },
    { label: 'Saved a piece', n: now.funnel.save, b: before.funnel.save },
    { label: 'Asked on WhatsApp', n: now.funnel.enquire, b: before.funnel.enquire },
  ];
  const top = Math.max(1, steps[0].n);
  return (
    <Card title="From a visit to a WhatsApp message" note="sessions that reached each step; a step can be skipped (an enquiry from the front page)">
      <ol className="space-y-2.5">
        {steps.map((s, i) => (
          <li key={s.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span>{s.label}</span>
              <span className="tabular-nums">{s.n.toLocaleString('en-US')} <span className="text-xs text-muted-foreground">{i ? `${pct(steps[0].n ? s.n / steps[0].n : 0, 1)} of visits` : ''}</span> <Delta now={s.n} before={s.b} /></span>
            </div>
            <div className="h-2.5 rounded-full bg-muted overflow-hidden"><div className={cn('h-full rounded-full', i === 3 ? 'bg-success' : 'bg-primary/70')} style={{ width: `${(s.n / top) * 100}%` }} /></div>
            {i > 0 && steps[i - 1].n > 0 && <p className="text-[11px] text-muted-foreground">{pct(s.n / steps[i - 1].n, 1)} of those who {steps[i - 1].label.toLowerCase()}</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** Each source's sessions and how far they got: the funnel per source, Shopify's "conversion by source". */
function SourceTable({ now }: { now: Summary }) {
  if (!now.sources.length) return null;
  return (
    <Card title="Which sources bring enquiries" note="per source, the share of its sessions that reached each step">
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr><th className="text-left font-normal px-1 py-1">Source</th><th className="text-right font-normal px-1">Sessions</th><th className="text-right font-normal px-1">Piece</th><th className="text-right font-normal px-1">Saved</th><th className="text-right font-normal px-1">WhatsApp</th></tr>
          </thead>
          <tbody className="divide-y">
            {now.sources.slice(0, 15).map(s => (
              <tr key={s.key}>
                <td className="px-1 py-1.5 truncate max-w-[10rem]">{sourceLabel(s.key)}</td>
                <td className="px-1 text-right">{s.sessions.toLocaleString('en-US')}</td>
                <td className="px-1 text-right">{s.sessions ? pct(s.piece / s.sessions) : '—'}</td>
                <td className="px-1 text-right">{s.sessions ? pct(s.save / s.sessions) : '—'}</td>
                <td className={cn('px-1 text-right', s.enquire > 0 && 'text-success font-medium')}>{s.enquire} <span className="text-xs text-muted-foreground">{s.sessions ? pct(s.enquire / s.sessions, 1) : ''}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
