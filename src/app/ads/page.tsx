'use client';

/**
 * Ads → Overview: what this house's Meta ads cost and brought over a range —
 * spend, reach and the results that matter to a jeweller (chats started, link
 * clicks, profile visits, engagement), each against the same length of time
 * before; day by day; the ads that spent most; who saw them; and anything Meta
 * has stopped or flagged.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Megaphone, Plus, RefreshCw, Loader2, ArrowUpRight, ArrowDownRight, AlertTriangle, ExternalLink, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS } from '@/lib/store-config';
import {
  money, count, compact, pct, headlineActions, resultOf, actionLabel, rangeLabel,
  type Metrics, type RangeKey, type AdsAccount,
} from '@/lib/ads/shape';
import { api, useAdsStatus, useRange, RangePicker, NotReady, AccountAlerts, AccountPill, ErrorLine, StatusPill } from './ads-kit';

interface Breakdown { key: string; label: string; metrics: Metrics }
interface Overview {
  range: RangeKey; account: AdsAccount; since: string | null; until: string | null;
  totals: Metrics; previous: { since: string; until: string; metrics: Metrics } | null;
  daily: { date: string; metrics: Metrics }[];
  topAds: { id: string; name: string; campaign: string; thumbnail: string | null; permalink: string | null; goal: string | null; metrics: Metrics }[];
  breakdowns: { ageGender: Breakdown[]; placement: Breakdown[]; region: Breakdown[] };
  problems: { id: string; name: string; status: string; reasons: string[] }[];
  at: string;
}

export default function AdsOverviewRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop doesn’t run Meta ads from the POS.</p>;
  return <AdsOverview />;
}

/** The result the account mostly buys: chats if there are any, then clicks, then engagement. */
function mainAction(m: Metrics): { key: string; label: string } {
  for (const k of ['onsite_conversion.messaging_conversation_started_7d', 'link_click', 'instagram_profile_visit', 'post_engagement']) {
    if ((m.actions[k] ?? 0) > 0) return { key: k, label: actionLabel(k) };
  }
  return { key: 'reach', label: 'People reached' };
}
const valueOf = (m: Metrics, key: string) => (key === 'reach' ? m.reach : m.actions[key] ?? 0);

/** Against the period before: green up / red down, or grey for spend, which is neither good nor bad by itself. */
function Delta({ now, before, neutral }: { now: number; before: number | null | undefined; neutral?: boolean }) {
  if (before === null || before === undefined || before === 0 || !Number.isFinite(now)) return null;
  const d = ((now - before) / before) * 100;
  if (Math.abs(d) < 0.5) return <span className="text-[11px] text-muted-foreground">same as before</span>;
  const up = d > 0;
  return <span className={cn('inline-flex items-center text-[11px] font-medium', neutral ? 'text-muted-foreground' : up ? 'text-success' : 'text-destructive')}>{up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(d).toFixed(0)}%</span>;
}

function Tile({ label, value, sub, delta }: { label: string; value: string; sub?: React.ReactNode; delta?: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-3 min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      <p className="text-xl md:text-2xl font-semibold tabular-nums leading-tight mt-0.5 truncate">{value}</p>
      <div className="flex items-center gap-1.5 min-h-[1rem]">{delta}{sub && <span className="text-[11px] text-muted-foreground truncate">{sub}</span>}</div>
    </div>
  );
}

function Bars({ title, rows, currency, empty }: { title: string; rows: Breakdown[]; currency: string; empty: string }) {
  const bySpend = rows.some(r => r.metrics.spend > 0);
  const top = rows.slice(0, 8);
  const max = Math.max(1, ...top.map(r => (bySpend ? r.metrics.spend : r.metrics.impressions)));
  return (
    <div className="rounded-xl border p-3 space-y-2 min-w-0">
      <p className="text-sm font-semibold">{title}</p>
      {!top.length ? <p className="text-xs text-muted-foreground">{empty}</p> : top.map(r => {
        const v = bySpend ? r.metrics.spend : r.metrics.impressions;
        return (
          <div key={r.key} className="space-y-0.5" title={`${r.label}: ${money(r.metrics.spend, currency)} · ${count(r.metrics.reach)} reached · ${count(r.metrics.impressions)} views`}>
            <div className="flex justify-between gap-2 text-xs"><span className="truncate min-w-0">{r.label}</span><span className="tabular-nums text-muted-foreground shrink-0">{bySpend ? money(v, currency) : `${compact(v)} views`}</span></div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${(v / max) * 100}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function AdsOverview() {
  const { status, error: statusError, loading: statusLoading, reload, ready } = useAdsStatus();
  const [range, setRange] = useRange();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (fresh = false) => {
    setLoading(true); setError(null);
    try { setData(await api<Overview>(`/api/ads/overview?range=${range}${fresh ? '&fresh=1' : ''}`)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const cur = data?.account.currency ?? status?.account?.currency ?? 'PKR';
  const t = data?.totals;
  const p = data?.previous?.metrics;
  const main = useMemo(() => (t ? mainAction(t) : null), [t]);
  const chart = useMemo(() => (data?.daily ?? []).map(d => ({
    date: d.date.slice(5).replace('-', '/'),
    spend: Math.round(d.metrics.spend * 100) / 100,
    result: main ? valueOf(d.metrics, main.key) : 0,
  })), [data, main]);
  const account = data?.account ?? status?.account ?? null;

  return (
    <PageShell title="Ads" icon={<Megaphone className="h-7 w-7" />}
      subtitle={account ? <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">{account.name} <AccountPill account={account} />{account.funding && <span className="inline-flex items-center gap-1"><Wallet className="h-3 w-3" />{account.funding}</span>}</span> : 'Meta ads for this shop'}
      action={ready ? <>
        <Button variant="outline" onClick={() => load(true)} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Refresh</Button>
        <Button asChild><Link href="/ads/new"><Plus className="h-4 w-4 mr-1.5" /> New ad</Link></Button>
      </> : undefined}>
      {!ready ? <NotReady status={status} error={statusError} loading={statusLoading} onRetry={reload} /> : (
        <>
          {status && <AccountAlerts status={status} />}
          <RangePicker value={range} onChange={setRange} />
          {error && <ErrorLine error={error} onRetry={() => load(true)} />}
          {!data && loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Asking Meta…</div>}

          {data && t && (
            <>
              <p className="text-xs text-muted-foreground -mt-1">
                {data.since && data.until ? `${data.since === data.until ? data.since : `${data.since} → ${data.until}`}` : rangeLabel(range)}
                {data.previous ? ` · compared with ${data.previous.since} → ${data.previous.until}` : ''}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <Tile label="Spent" value={money(t.spend, cur)} delta={<Delta now={t.spend} before={p?.spend} neutral />} sub={account ? `${money(account.amountSpent, cur)} all time` : undefined} />
                <Tile label="People reached" value={compact(t.reach)} delta={<Delta now={t.reach} before={p?.reach} />} sub={`${compact(t.impressions)} views · ${t.frequency ? t.frequency.toFixed(1) : '0'}×`} />
                {main && main.key !== 'reach'
                  ? <Tile label={main.label} value={count(valueOf(t, main.key))} delta={<Delta now={valueOf(t, main.key)} before={p ? valueOf(p, main.key) : null} />} sub={valueOf(t, main.key) ? `${money(t.spend / valueOf(t, main.key), cur, { cents: true })} each` : undefined} />
                  : <Tile label="Clicks" value={count(t.clicks)} delta={<Delta now={t.clicks} before={p?.clicks} />} sub={t.clicks ? `${money(t.cpc, cur, { cents: true })} each` : undefined} />}
                <Tile label="Click-through" value={pct(t.ctr)} delta={<Delta now={t.ctr} before={p?.ctr} />} sub={`${money(t.cpm, cur, { cents: true })} per 1,000 views`} />
              </div>

              {headlineActions(t).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {headlineActions(t, 10).map(a => (
                    <span key={a.type} className="rounded-full border px-2.5 py-1 text-xs"><b className="tabular-nums">{count(a.value)}</b> <span className="text-muted-foreground">{a.label.toLowerCase()}</span></span>
                  ))}
                </div>
              )}

              {data.problems.length > 0 && (
                <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 space-y-2">
                  <p className="text-sm font-semibold flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" /> Meta has stopped or flagged {data.problems.length === 1 ? 'an ad' : `${data.problems.length} ads`}</p>
                  {data.problems.map(a => (
                    <Link key={a.id} href={`/ads/campaigns?ad=${a.id}`} className="block rounded-lg bg-background/60 border p-2 text-sm hover:border-primary/50">
                      <span className="flex items-center gap-2"><span className="font-medium truncate">{a.name}</span><StatusPill status={a.status} /></span>
                      {a.reasons.length > 0 && <span className="block text-xs text-muted-foreground mt-0.5">{a.reasons.join(' · ')}</span>}
                    </Link>
                  ))}
                </div>
              )}

              {chart.length > 1 && (
                <div className="rounded-xl border p-3">
                  <p className="text-sm font-semibold mb-2">Day by day <span className="font-normal text-muted-foreground text-xs">— spend{main ? ` and ${main.label.toLowerCase()}` : ''}</span></p>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chart} margin={{ left: -10, right: 0, top: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={12} />
                        <YAxis yAxisId="s" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
                        <YAxis yAxisId="r" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
                        <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                          formatter={(v: number, name: string) => (name === 'spend' ? [money(v, cur), 'Spent'] : [count(v), main?.label ?? 'Results'])} />
                        <Bar yAxisId="s" dataKey="spend" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} maxBarSize={28} />
                        <Line yAxisId="r" dataKey="result" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} type="monotone" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <div className="rounded-xl border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">The ads that spent most</p>
                  <Link href="/ads/campaigns" className="text-xs text-primary">All campaigns →</Link>
                </div>
                {!data.topAds.length ? <p className="text-sm text-muted-foreground">No ad spent anything in {rangeLabel(range).toLowerCase()}. <Link href="/ads/new" className="text-primary">Make one →</Link></p> : (
                  <ul className="divide-y">
                    {data.topAds.map(a => {
                      const r = resultOf(a.metrics, a.goal ?? undefined);
                      return (
                        <li key={a.id} className="flex items-center gap-3 py-2">
                          <Link href={`/ads/campaigns?ad=${a.id}`} className="shrink-0">
                            {a.thumbnail ? <img src={a.thumbnail} alt="" className="h-12 w-12 rounded-md object-cover bg-muted" /> : <span className="block h-12 w-12 rounded-md bg-muted" />}
                          </Link>
                          <Link href={`/ads/campaigns?ad=${a.id}`} className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">{a.name}</span>
                            <span className="block text-[11px] text-muted-foreground truncate">{a.campaign}</span>
                          </Link>
                          <span className="text-right shrink-0">
                            <span className="block text-sm font-semibold tabular-nums">{money(a.metrics.spend, cur)}</span>
                            <span className="block text-[11px] text-muted-foreground tabular-nums">{r ? `${count(r.value)} ${r.label.toLowerCase()}${r.value ? ` · ${money(a.metrics.spend / r.value, cur, { cents: true })}` : ''}` : `${compact(a.metrics.reach)} reached`}</span>
                          </span>
                          {a.permalink && <a href={a.permalink} target="_blank" rel="noopener" className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Open on Instagram"><ExternalLink className="h-4 w-4" /></a>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="grid gap-2.5 md:grid-cols-3">
                <Bars title="Who saw them" rows={data.breakdowns.ageGender} currency={cur} empty="Nothing yet." />
                <Bars title="Where" rows={data.breakdowns.placement} currency={cur} empty="Nothing yet." />
                <Bars title="Region" rows={data.breakdowns.region} currency={cur} empty="Nothing yet." />
              </div>
              <p className="text-[11px] text-muted-foreground">From Meta, {new Date(data.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Today’s numbers keep changing for a few hours; reach across days can’t be added up, so “people reached” is Meta’s own count for the whole range.</p>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
