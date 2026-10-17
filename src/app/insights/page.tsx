'use client';

/**
 * Insights → Overview: this house's Instagram and Facebook over a range, organic beside paid —
 * the account's reach, views, engagement, follows and link taps against the period before; how
 * much of it the ads brought; the Page's views and follows; the ads' spend and results by
 * platform; the follower history the hourly snapshot keeps; and, first, what it all says.
 */

import React, { useMemo } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { AlertTriangle, BarChart3, CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS } from '@/lib/store-config';
import { chartMotion } from '@/lib/chart-motion';
import { compact, count, money, actionLabel, headlineActions, type Metrics } from '@/lib/ads/shape';
import {
  bestHours, byKind, findings, sharesOf, surfaceLabel, type Finding, type PostRow, type Split,
} from '@/lib/social-insights/shape';
import type { Audience, DailySnapshot, FacebookOverview, InstagramOverview, PlatformSpend } from '@/lib/social-insights/fetch';
import { ErrorLine } from '@/app/ads/ads-kit';
import { Delta, InsightRangePicker, MissingNote, Tile, useInsightRange, useInsights } from './insights-kit';

interface OverviewData { instagram: InstagramOverview | null; facebook: FacebookOverview | null; paid: { now: PlatformSpend[]; before: PlatformSpend[] } | null; history: DailySnapshot[]; currency: string }
interface PostsData { posts: PostRow[]; stories: PostRow[]; lastPostAt: string | null }
interface AudienceData { audience: Audience | null }

const tip = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };
const PLATFORM: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', messenger: 'Messenger', audience_network: 'Audience Network', threads: 'Threads', whatsapp: 'WhatsApp' };

export default function InsightsRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop isn’t connected to Meta.</p>;
  return <InsightsOverview />;
}

function Findings({ items }: { items: Finding[] }) {
  if (!items.length) return null;
  const icon = { good: <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />, warn: <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />, info: <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" /> };
  const tone = { good: 'border-success/30 bg-success/5', warn: 'border-warning/50 bg-warning/10', info: 'border-border bg-muted/40' };
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">What the numbers say</p>
      <ul className="space-y-1.5">
        {items.map((f, i) => (
          <li key={i} className={cn('rounded-lg border p-2.5 text-sm flex gap-2', tone[f.tone])}>
            {icon[f.tone]}
            <div className="min-w-0"><p className="font-medium leading-tight">{f.title}</p><p className="text-xs text-muted-foreground mt-0.5">{f.why}</p></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ads against the account's own surfaces, as one two-part bar with both numbers written out. */
function PaidOrganic({ label, split }: { label: string; split: Split | null }) {
  if (!split || split.ads + split.organic === 0) return null;
  const s = split.adsShare ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between gap-2 text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">ads {compact(split.ads)} · own {compact(split.organic)}</span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-muted gap-0.5" role="img" aria-label={`${Math.round(s * 100)}% from ads, ${Math.round((1 - s) * 100)}% from the account's own posts`}>
        {s > 0 && <div className="h-full bg-primary rounded-l-full" style={{ width: `${s * 100}%` }} />}
        {s < 1 && <div className="h-full bg-primary/35 rounded-r-full" style={{ width: `${(1 - s) * 100}%` }} />}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        <span><span className="inline-block h-2 w-2 rounded-full bg-primary mr-1 align-middle" />From ads {Math.round(s * 100)}%</span>
        {split.bySurface.filter(p => p.value > 0).map(p => <span key={p.key}><span className="inline-block h-2 w-2 rounded-full bg-primary/35 mr-1 align-middle" />{surfaceLabel(p.key)} {compact(p.value)}</span>)}
      </div>
    </div>
  );
}

const sum = (rows: PlatformSpend[] | undefined, k: (m: Metrics) => number) => (rows ?? []).reduce((a, r) => a + k(r.metrics), 0);

function InsightsOverview() {
  const [range, setRange] = useInsightRange();
  const o = useInsights<OverviewData>('overview', range);
  // Posts and audience feed the findings; the server keeps them, so their tabs then open at once.
  const p = useInsights<PostsData>('posts', range);
  const a = useInsights<AudienceData>('audience', range);
  const d = o.data;
  const ig = d?.instagram ?? null, fb = d?.facebook ?? null;
  const cur = d?.currency ?? 'PKR';

  const found = useMemo(() => {
    if (!ig) return [];
    const igPosts = (p.data?.posts ?? []).filter(x => x.platform === 'instagram');
    const recent = igPosts.filter(x => !x.older);
    const top = [...igPosts].sort((x, y) => (y.views ?? 0) - (x.views ?? 0))[0];
    return findings({
      reachSplit: ig.reach, nonFollowerReach: ig.nonFollowerReach, follows: ig.follows, followers: ig.account.followers,
      kinds: byKind(recent.length >= 4 ? recent : igPosts), profileViews: ig.totals.profile_views ?? null, websiteTaps: ig.totals.website_clicks ?? null,
      followerCountries: sharesOf(a.data?.audience?.followers.country ?? [], 50), best: bestHours(a.data?.audience?.online ?? null),
      paidSpend: sum(d?.paid?.now, m => m.spend), currency: cur,
      now: Date.now(), lastPostAt: p.data?.lastPostAt ?? null, postsInRange: recent.length, totalViews: ig.totals.views ?? null,
      topPost: top?.views ? { kind: top.kind, at: top.at, views: top.views, older: !!top.older } : null,
    });
  }, [ig, p.data, a.data, d?.paid, cur]);

  const reachDays = (ig?.daily ?? []).map(x => ({ date: x.date.slice(5).replace('-', '/'), reach: x.reach }));
  const followerDays = (d?.history ?? []).filter(x => x.igFollowers !== null).map(x => ({ date: x.date.slice(5).replace('-', '/'), followers: x.igFollowers }));
  const fbDays = (fb?.daily ?? []).map(x => ({ date: x.date.slice(5).replace('-', '/'), views: x.views }));
  const t = ig?.totals ?? {}, pv = ig?.previous ?? {};
  const paidNow = d?.paid?.now.filter(r => r.metrics.spend > 0 || r.metrics.impressions > 0) ?? [];
  const before = new Map((d?.paid?.before ?? []).map(r => [r.platform, r.metrics]));

  return (
    <PageShell title="Insights" icon={<BarChart3 className="h-7 w-7" />}
      subtitle={d ? [d.instagram_username && `@${d.instagram_username}`, d.page_name].filter(Boolean).join(' · ') : 'Instagram and Facebook, organic and paid'}
      action={<Button variant="outline" onClick={() => { o.reload(true); p.reload(true); a.reload(true); }} disabled={o.loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', o.loading && 'animate-spin')} /> Refresh</Button>}>
      <InsightRangePicker value={range} onChange={setRange} />
      {o.error && <ErrorLine error={o.error} onRetry={() => o.reload(true)} />}
      {!d && o.loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Asking Meta…</div>}
      {d && (
        <>
          <p className="text-xs text-muted-foreground -mt-1">{d.since} → {d.until} · compared with {d.previous.since} → {d.previous.until}</p>
          <Findings items={found} />

          {ig && (
            <section className="space-y-2.5">
              <h2 className="text-sm font-semibold flex items-center gap-2">Instagram{ig.account.picture && <img src={ig.account.picture} alt="" className="h-5 w-5 rounded-full" />}<span className="font-normal text-muted-foreground">@{ig.account.username}</span></h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <Tile label="Followers" value={count(ig.account.followers)}
                  sub={ig.follows ? `${ig.follows.net >= 0 ? '+' : '−'}${count(Math.abs(ig.follows.net))} · ${count(ig.follows.follows)} in, ${count(ig.follows.unfollows)} out` : undefined}
                  delta={ig.follows && ig.previousFollows ? <Delta now={ig.follows.net} before={ig.previousFollows.net} /> : undefined} />
                <Tile label="Accounts reached" value={compact(t.reach ?? 0)} delta={<Delta now={t.reach} before={pv.reach} />}
                  sub={ig.nonFollowerReach !== null ? `${Math.round(ig.nonFollowerReach * 100)}% not following` : undefined} />
                <Tile label="Views" value={compact(t.views ?? 0)} delta={<Delta now={t.views} before={pv.views} />} />
                <Tile label="Accounts engaged" value={compact(t.accounts_engaged ?? 0)} delta={<Delta now={t.accounts_engaged} before={pv.accounts_engaged} />} />
                <Tile label="Interactions" value={compact(t.total_interactions ?? 0)} delta={<Delta now={t.total_interactions} before={pv.total_interactions} />}
                  sub={`${compact(t.likes ?? 0)} likes · ${compact(t.comments ?? 0)} comments`} />
                <Tile label="Shares · saves" value={`${compact(t.shares ?? 0)} · ${compact(t.saves ?? 0)}`} sub={`${compact(t.replies ?? 0)} story replies · ${compact(t.reposts ?? 0)} reposts`} />
                <Tile label="Profile visits" value={compact(t.profile_views ?? 0)} delta={<Delta now={t.profile_views} before={pv.profile_views} />} />
                <Tile label="Link taps" value={compact(t.website_clicks ?? 0)} delta={<Delta now={t.website_clicks} before={pv.website_clicks} />}
                  sub={t.profile_views ? `${((100 * (t.website_clicks ?? 0)) / t.profile_views).toFixed(1)}% of visits${t.profile_links_taps ? ` · ${count(t.profile_links_taps)} contact taps` : ''}` : undefined} />
              </div>

              <div className="rounded-xl border p-3 space-y-3">
                <p className="text-sm font-semibold">Ads or the account’s own posts? <span className="font-normal text-muted-foreground text-xs">— Instagram, counted per surface</span></p>
                <PaidOrganic label="Accounts reached" split={ig.reach} />
                <PaidOrganic label="Views" split={ig.views} />
                <PaidOrganic label="Interactions" split={ig.interactions} />
              </div>

              <div className="grid gap-2.5 md:grid-cols-2">
                {reachDays.length > 1 && (
                  <div className="rounded-xl border p-3">
                    <p className="text-sm font-semibold mb-2">Accounts reached, day by day <span className="font-normal text-muted-foreground text-xs">— ads included</span></p>
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={reachDays} margin={{ left: -10, right: 0, top: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={12} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
                          <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [count(v), 'Reached']} />
                          <Bar {...chartMotion()} dataKey="reach" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={24} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
                <div className="rounded-xl border p-3">
                  <p className="text-sm font-semibold mb-2">Followers over time</p>
                  {followerDays.length > 1 ? (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={followerDays} margin={{ left: -4, right: 6, top: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                          <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={12} />
                          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} domain={['dataMin - 5', 'dataMax + 5']} tickFormatter={v => compact(Number(v))} />
                          <Tooltip contentStyle={tip} formatter={(v: number) => [count(v), 'Followers']} />
                          <Line {...chartMotion()} dataKey="followers" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} type="monotone" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <p className="text-xs text-muted-foreground">Meta keeps no follower history, so the ERP writes the count down every day from {d.history[0]?.date ?? 'today'}. The line fills in from there.</p>}
                </div>
              </div>
            </section>
          )}

          <section className="rounded-xl border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Ads by platform</p>
              <Link href="/ads" className="text-xs text-primary">Ads overview →</Link>
            </div>
            {!paidNow.length ? <p className="text-sm text-muted-foreground">No ad ran in this range.</p> : (
              <ul className="divide-y">
                {paidNow.map(r => (
                  <li key={r.platform} className="py-2 space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{PLATFORM[r.platform] ?? r.platform}</span>
                      <span className="text-sm font-semibold tabular-nums whitespace-nowrap">{money(r.metrics.spend, cur)} <Delta now={r.metrics.spend} before={before.get(r.platform)?.spend} /></span>
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {compact(r.metrics.reach)} reached · {compact(r.metrics.impressions)} views · {count(r.metrics.linkClicks)} link clicks
                      {r.metrics.reach ? ` · ${money((r.metrics.spend / r.metrics.reach) * 1000, cur)} per 1,000 reached` : ''}
                    </p>
                    {headlineActions(r.metrics, 4).length > 0 && <p className="text-xs">{headlineActions(r.metrics, 4).map(x => `${count(x.value)} ${actionLabel(x.type).toLowerCase()}`).join(' · ')}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {fb && (
            <section className="space-y-2.5">
              <h2 className="text-sm font-semibold">Facebook <span className="font-normal text-muted-foreground">{fb.page.name}</span></h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <Tile label="Followers" value={count(fb.page.followers)} sub={`+${count(fb.totals.page_daily_follows_unique ?? 0)} · −${count(fb.totals.page_daily_unfollows_unique ?? 0)}`} />
                <Tile label="Views" value={compact(fb.totals.page_media_view ?? 0)} delta={<Delta now={fb.totals.page_media_view} before={fb.previous.page_media_view} />} sub={`${compact(fb.totals.page_total_media_view_unique ?? 0)} people`} />
                <Tile label="Engagement" value={compact(fb.totals.page_post_engagements ?? 0)} delta={<Delta now={fb.totals.page_post_engagements} before={fb.previous.page_post_engagements} />} sub={fb.totals.page_video_views ? `${compact(fb.totals.page_video_views)} video views` : undefined} />
                <Tile label="Page visits" value={compact(fb.totals.page_views_total ?? 0)} delta={<Delta now={fb.totals.page_views_total} before={fb.previous.page_views_total} />} />
              </div>
              {fbDays.length > 1 && fbDays.some(x => x.views > 0) && (
                <div className="rounded-xl border p-3">
                  <p className="text-sm font-semibold mb-2">Page views, day by day</p>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={fbDays} margin={{ left: -10, right: 0, top: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={12} />
                        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
                        <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [count(v), 'Views']} />
                        <Bar {...chartMotion()} dataKey="views" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={24} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </section>
          )}

          <p className="text-[11px] text-muted-foreground">From Meta, {new Date(d.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Instagram’s numbers include what its ads did; the split above takes them apart. Reach is people, not views, so the parts of a split can add up to more than the account’s reach.</p>
          <MissingNote missing={d.missing} />
        </>
      )}
    </PageShell>
  );
}
