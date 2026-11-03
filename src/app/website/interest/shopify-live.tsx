'use client';

/**
 * Live for the Shopify store. Shopify has no Live View API, so this is what can stand in: sessions by the minute (the hour
 * where the minute isn't offered — Shopify's reports lag a few minutes), today's sessions by place, and the orders and
 * checkouts of the last 30 minutes. Asked every 60 seconds (the server caches that long).
 */

import React from 'react';
import { Radio } from 'lucide-react';
import { Tile } from '@/app/insights/insights-kit';
import { Card, flag, Ranked } from './site-kit';
import { Gate, agoLabel, int, moneyFormatter, useShopify, type Section } from './shopify-kit';
import { FigureTilesSkeleton, ListRowsSkeleton } from '@/components/shared/skeletons';

interface Activity { kind: 'order' | 'checkout'; ago: number; label: string; amount: number | null; currency: string; place: string; items: { title: string; quantity: number }[]; status?: string }
interface Live {
  at: number; windowMinutes: number;
  live: { sessionsLastHalfHour: number | null; note: string };
  sections: {
    sessions: Section<{ grain: 'minute' | 'hour'; points: { at: string; sessions: number }[] }>;
    places: Section<{ key: string; label: string; code?: string; value: number }[]>;
    today: Section<Record<string, { value: number }>>;
    recent: Section<Activity[]>;
  };
}

export function ShopifyLive() {
  const { data: l, error, loading } = useShopify<Live>('/api/website/shopify-analytics/live', 60_000);
  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && !l && <div className="space-y-4"><FigureTilesSkeleton tiles={3} /><ListRowsSkeleton rows={4} /></div>}
      {l && (
        <>
          <section className="rounded-[22px] bg-card p-5 flex items-center gap-4">
            <span className="relative flex h-3 w-3"><span className="relative inline-flex h-3 w-3 rounded-full bg-success" /></span>
            <div>
              <p className="text-4xl font-semibold tabular-nums leading-none font-serif">{l.live.sessionsLastHalfHour === null ? '–' : l.live.sessionsLastHalfHour}</p>
              <p className="text-sm text-muted-foreground mt-1">sessions on the store in the last {l.windowMinutes} minutes</p>
            </div>
            <Radio className="h-5 w-5 ml-auto text-muted-foreground" />
          </section>
          <p className="text-xs text-muted-foreground">{l.live.note}</p>

          <Gate title="Today so far" section={l.sections.today}>
            {k => (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <Tile label="Sessions" value={int(k.sessions?.value ?? 0)} sub="today" />
                <Tile label="Visitors" value={int(k.visitors?.value ?? 0)} />
                <Tile label="Added to cart" value={int(k.addedToCart?.value ?? 0)} sub="sessions" />
                <Tile label="Reached checkout" value={int(k.reachedCheckout?.value ?? 0)} sub={`${int(k.completedCheckout?.value ?? 0)} completed`} />
              </div>
            )}
          </Gate>

          <Gate title="Orders and checkouts, last 30 minutes" section={l.sections.recent}>
            {list => (
              <Card title="Recent activity" note="orders and checkouts, newest first">
                {list.length === 0 ? <p className="text-xs text-muted-foreground">No orders or checkouts in the last {l.windowMinutes} minutes.</p> : (
                  <ul className="divide-y">
                    {list.map((a, i) => {
                      const money = moneyFormatter(a.currency);
                      return (
                        <li key={i} className="py-2 flex justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">
                            <span className="font-medium">{a.kind === 'order' ? `Order ${a.label}` : a.label}</span>
                            <span className="text-xs text-muted-foreground"> · {[a.items.map(x => `${x.title} ×${x.quantity}`).join(', '), a.place].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-right">{a.amount === null ? '' : money(a.amount)} <span className="text-xs text-muted-foreground">{agoLabel(a.ago)}</span></span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            )}
          </Gate>

          <div className="grid gap-2.5 md:grid-cols-2">
            <Gate title="Sessions by the minute" section={l.sections.sessions}>
              {d => {
                const pts = d.points.slice(-30);
                const max = Math.max(1, ...pts.map(p => p.sessions));
                return (
                  <Card title={d.grain === 'minute' ? 'Sessions by the minute' : 'Sessions by the hour, today'} note={d.grain === 'minute' ? 'last hour' : 'Shopify gave no minute grain'}>
                    {pts.length === 0 ? <p className="text-xs text-muted-foreground">Nothing yet.</p> : (
                      <div className="flex items-end gap-0.5 h-20" role="img" aria-label="Sessions over time">
                        {pts.map(p => <div key={p.at} className="flex-1 rounded-t bg-primary/70 min-h-[2px]" style={{ height: `${(p.sessions / max) * 100}%` }} title={`${p.at.slice(11, 16)} · ${p.sessions}`} />)}
                      </div>
                    )}
                  </Card>
                );
              }}
            </Gate>
            <Gate title="Where they are today" section={l.sections.places}>
              {d => <Card title="Where they are" note="sessions today"><Ranked rows={d.map(x => ({ key: x.key, value: x.value, label: <>{x.code ? flag(x.code) : '🌐'} {x.label}</> }))} empty="No sessions yet today." /></Card>}
            </Gate>
          </div>
        </>
      )}
    </div>
  );
}
