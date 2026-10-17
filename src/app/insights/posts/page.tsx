'use client';

/**
 * Insights → Posts: every Instagram post and reel (the latest 50, with lifetime numbers — an older
 * one still being watched is marked), each Facebook post of the range, and the stories, live or
 * kept by the hourly snapshot. Sorted by what the owner picks; each format's medians on top, so
 * "what works here" is one look.
 */

import React, { useMemo, useState } from 'react';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { ExternalLink, Image as ImageIcon, Loader2, RefreshCw, Rows3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS } from '@/lib/store-config';
import { compact, count } from '@/lib/ads/shape';
import { byKind, KIND_LABEL, type PostKind, type PostRow } from '@/lib/social-insights/shape';
import { ErrorLine } from '@/app/ads/ads-kit';
import { InsightRangePicker, MissingNote, useInsightRange, useInsights } from '../insights-kit';

interface PostsData { posts: PostRow[]; stories: PostRow[]; liveStories: string[]; lastPostAt: string | null }

const SORTS = [
  { key: 'at', label: 'Newest' },
  { key: 'views', label: 'Views' },
  { key: 'reach', label: 'Reach' },
  { key: 'interactions', label: 'Interactions' },
  { key: 'rate', label: 'Engagement rate' },
  { key: 'shares', label: 'Shares' },
  { key: 'saves', label: 'Saves' },
] as const;
type SortKey = typeof SORTS[number]['key'];
const FILTERS: { key: 'all' | PostKind | 'older'; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'reel', label: 'Reels' }, { key: 'post', label: 'Photos' }, { key: 'carousel', label: 'Carousels' },
  { key: 'story', label: 'Stories' }, { key: 'fb', label: 'Facebook' }, { key: 'older', label: 'Older, still earning' },
];

const fmt = (v: number | null) => (v === null ? '—' : compact(v));
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
const secs = (ms: number | null) => (ms === null ? null : `${(ms / 1000).toFixed(1)}s`);

export default function InsightsPostsRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop isn’t connected to Meta.</p>;
  return <InsightsPosts />;
}

function PostCard({ r, live }: { r: PostRow; live: boolean }) {
  const stats: [string, string][] = [
    ['Views', fmt(r.views)], ['Reach', fmt(r.reach)], ['Likes', fmt(r.likes)], ['Comments', fmt(r.comments)],
    ['Shares', fmt(r.shares)], ...(r.saves !== null ? [['Saves', fmt(r.saves)] as [string, string]] : []),
    ['Rate', pct(r.rate)],
    ...(r.profileVisits !== null ? [['Profile visits', fmt(r.profileVisits)] as [string, string]] : []),
    ...(r.follows !== null ? [['Follows', fmt(r.follows)] as [string, string]] : []),
    ...(r.avgWatchMs !== null ? [['Avg watch', secs(r.avgWatchMs)!] as [string, string]] : []),
    ...(r.facebookViews !== null ? [['On Facebook', fmt(r.facebookViews)] as [string, string]] : []),
    ...(r.clicks !== null ? [['Clicks', fmt(r.clicks)] as [string, string]] : []),
    ...(r.replies !== null && r.kind === 'story' ? [['Replies', fmt(r.replies)] as [string, string]] : []),
  ];
  return (
    <li className="rounded-xl border p-2.5 flex gap-3 min-w-0">
      <a href={r.link ?? undefined} target="_blank" rel="noopener" className="shrink-0">
        {r.thumb ? <img src={r.thumb} alt="" loading="lazy" className={cn('rounded-lg object-cover bg-muted', r.kind === 'story' || r.kind === 'reel' ? 'h-24 w-[3.4rem]' : 'h-20 w-20')} />
          : <span className="h-20 w-20 rounded-lg bg-muted grid place-items-center"><ImageIcon className="h-5 w-5 text-muted-foreground" /></span>}
      </a>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
          <span className="rounded-full border px-1.5 py-px text-foreground">{KIND_LABEL[r.kind].replace(/s$/, '')}</span>
          <span>{r.at.slice(0, 10)}</span>
          {r.older && <span className="rounded-full bg-muted px-1.5 py-px">posted before this range</span>}
          {live && <span className="rounded-full bg-success/15 text-success px-1.5 py-px">up now</span>}
          {r.link && <a href={r.link} target="_blank" rel="noopener" className="ml-auto hover:text-foreground" aria-label="Open"><ExternalLink className="h-3.5 w-3.5" /></a>}
        </div>
        {r.caption && <p className="text-xs line-clamp-2">{r.caption}</p>}
        <dl className="grid grid-cols-3 sm:grid-cols-6 gap-x-3 gap-y-0.5">
          {stats.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[10px] text-muted-foreground truncate">{k}</dt><dd className="text-sm font-semibold tabular-nums">{v}</dd></div>)}
        </dl>
      </div>
    </li>
  );
}

function InsightsPosts() {
  const [range, setRange] = useInsightRange();
  const { data, error, loading, reload } = useInsights<PostsData>('posts', range);
  const [sort, setSort] = useState<SortKey>('at');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all');

  const all = useMemo(() => [...(data?.posts ?? []), ...(data?.stories ?? [])], [data]);
  const shown = useMemo(() => {
    const rows = all.filter(r => filter === 'all' ? true : filter === 'older' ? r.older : r.kind === filter);
    const val = (r: PostRow) => (sort === 'at' ? 0 : (r[sort] as number | null) ?? -1);
    return sort === 'at' ? [...rows].sort((a, b) => b.at.localeCompare(a.at)) : [...rows].sort((a, b) => val(b) - val(a));
  }, [all, filter, sort]);
  const kinds = useMemo(() => byKind(all.filter(r => !r.older)), [all]);
  const live = new Set(data?.liveStories ?? []);

  return (
    <PageShell title="Insights" icon={<Rows3 className="h-7 w-7" />} subtitle="Every post, reel and story, with its numbers"
      action={<Button variant="outline" onClick={() => reload(true)} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Refresh</Button>}>
      <InsightRangePicker value={range} onChange={setRange} />
      {error && <ErrorLine error={error} onRetry={() => reload(true)} />}
      {!data && loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Reading every post’s numbers from Meta…</div>}
      {data && (
        <>
          {kinds.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
              {kinds.map(k => (
                <div key={k.kind} className="rounded-xl border p-3 min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground truncate">{KIND_LABEL[k.kind]} · {k.n}</p>
                  <p className="text-lg font-semibold tabular-nums leading-tight">{k.medianReach === null ? '—' : compact(k.medianReach)} <span className="text-xs font-normal text-muted-foreground">median reach</span></p>
                  <p className="text-[11px] text-muted-foreground">{k.medianRate === null ? '' : `${(k.medianRate * 100).toFixed(1)}% engage`}</p>
                </div>
              ))}
            </div>
          )}
          {data.lastPostAt && <p className="text-xs text-muted-foreground">Last Instagram post: {data.lastPostAt.slice(0, 10)} · {count(all.filter(r => r.platform === 'instagram' && !r.older && r.kind !== 'story').length)} in this range</p>}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {FILTERS.map(f => (
              <button key={f.key} type="button" onClick={() => setFilter(f.key)}
                className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap min-h-0', filter === f.key ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground')}>{f.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Sort</span>
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)} className="rounded-md border bg-background px-2 py-1 text-xs">
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          {!shown.length ? <p className="text-sm text-muted-foreground py-4">Nothing here for this range.</p> : (
            <ul className="space-y-2">{shown.map(r => <PostCard key={r.id} r={r} live={live.has(r.id)} />)}</ul>
          )}
          <p className="text-[11px] text-muted-foreground">A post’s numbers are its lifetime so far. A story’s exist only while it’s up, so the ERP reads every live story each hour and keeps the last count; stories from before Insights began aren’t there. Engagement rate is interactions over reach.</p>
          <MissingNote missing={data.missing} />
        </>
      )}
    </PageShell>
  );
}
