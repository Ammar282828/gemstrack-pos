'use client';

/**
 * Insights → Audience: who follows this house on Instagram, who it reached this month and who
 * engaged — age, gender, city, country — side by side, so a gap shows (reaching men, followed by
 * women; followed abroad, selling in Karachi); and the hours followers are online, in Karachi time.
 * Meta keeps no history of these; it is always "now".
 */

import React, { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { PageShell } from '@/components/shared/page-shell';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STORE_META_ADS } from '@/lib/store-config';
import { chartMotion } from '@/lib/chart-motion';
import { count } from '@/lib/ads/shape';
import { bestHours, countryLabel, genderLabel, hourLabel, sharesOf, type Part } from '@/lib/social-insights/shape';
import type { Audience } from '@/lib/social-insights/fetch';
import { ErrorLine } from '@/app/ads/ads-kit';
import { InsightRangePicker, MissingNote, ShareBars, useInsightRange, useInsights } from '../insights-kit';

const GROUPS = [
  { key: 'followers', label: 'Followers', note: 'everyone following now' },
  { key: 'reached', label: 'Reached', note: 'this month' },
  { key: 'engaged', label: 'Engaged', note: 'this month' },
] as const;
type Group = typeof GROUPS[number]['key'];

const label = (dim: string, k: string) => (dim === 'gender' ? genderLabel(k) : dim === 'country' ? countryLabel(k) : k);
const bars = (dim: string, parts: Part[], top = 8) => sharesOf(parts, top).map(s => ({ ...s, label: s.key === 'Other' ? 'Other' : label(dim, s.key) }));

export default function InsightsAudienceRoute() {
  if (!STORE_META_ADS) return <p className="container mx-auto px-4 py-8 text-sm text-muted-foreground">This shop isn’t connected to Meta.</p>;
  return <InsightsAudience />;
}

function InsightsAudience() {
  const [range, setRange] = useInsightRange();
  const { data, error, loading, reload } = useInsights<{ audience: Audience | null }>('audience', range);
  const [group, setGroup] = useState<Group>('followers');
  const a = data?.audience ?? null;
  const g = a ? a[group] : null;
  const hours = a?.online ?? null;
  const best = bestHours(hours);
  const hourRows = (hours ?? []).map((v, h) => ({ hour: hourLabel(h), online: v }));

  return (
    <PageShell title="Insights" icon={<UsersRound className="h-7 w-7" />} subtitle="Who follows, who was reached, who engaged"
      action={<Button variant="outline" onClick={() => reload(true)} disabled={loading}><RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} /> Refresh</Button>}>
      <InsightRangePicker value={range} onChange={setRange} />
      {error && <ErrorLine error={error} onRetry={() => reload(true)} />}
      {!data && loading && <div className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="h-4 w-4 animate-spin" /> Asking Meta…</div>}
      {data && !a && <p className="text-sm text-muted-foreground">Choose this shop’s Instagram account on Ads → Setup.</p>}
      {a && g && (
        <>
          <div className="flex gap-1.5">
            {GROUPS.map(x => (
              <button key={x.key} type="button" onClick={() => setGroup(x.key)}
                className={cn('rounded-full border px-3 py-1.5 text-xs min-h-0', group === x.key ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground')}>{x.label}</button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground -mt-1">{GROUPS.find(x => x.key === group)!.note} · the date range doesn’t apply here; Meta gives these only as they are now</p>
          <div className="grid gap-2.5 md:grid-cols-2">
            <ShareBars title="Age" rows={bars('age', g.age, 10)} />
            <ShareBars title="Gender" rows={bars('gender', g.gender)} />
            <ShareBars title="Cities" rows={bars('city', g.city)} note="top 8" />
            <ShareBars title="Countries" rows={bars('country', g.country)} note="top 8" />
          </div>

          {/* The gap between who follows and who the posts reach, in one line per dimension. */}
          {group !== 'followers' && (() => {
            const top = (ps: Part[]) => sharesOf(ps, 1)[0];
            const lines = (['gender', 'country'] as const).map(dim => {
              const f = top(a.followers[dim]), r = top(g[dim]);
              if (!f || !r || f.key === r.key) return null;
              return `Followers are mostly ${label(dim, f.key)} (${Math.round(f.share * 100)}%), but ${group === 'reached' ? 'the reach' : 'engagement'} is mostly ${label(dim, r.key)} (${Math.round(r.share * 100)}%).`;
            }).filter(Boolean);
            return lines.length ? <div className="rounded-lg border border-warning/50 bg-warning/10 p-2.5 text-sm space-y-0.5">{lines.map((l, i) => <p key={i}>{l}</p>)}</div> : null;
          })()}

          <div className="rounded-xl border p-3">
            <p className="text-sm font-semibold mb-1">When followers are online <span className="font-normal text-muted-foreground text-xs">— Karachi time</span></p>
            {!hours ? <p className="text-xs text-muted-foreground">Meta isn’t sharing this for the account yet (it holds it back for smaller accounts). It appears here once Meta does.</p> : (
              <>
                {best && <p className="text-xs text-muted-foreground mb-2">Busiest: {hourLabel(best.start)}–{hourLabel((best.start + 2) % 24)} ({Math.round(best.share * 100)}% of the day’s online followers). Post just before.</p>}
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourRows} margin={{ left: -16, right: 0, top: 5 }}>
                      <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} interval={2} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [count(v), 'Followers online']} />
                      <Bar {...chartMotion()} dataKey="online" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
          <MissingNote missing={data?.missing ?? []} />
        </>
      )}
    </PageShell>
  );
}
