'use client';

/**
 * Shopify's own analytics for House of Mina's store (houseofmina.store), inside Website → Visitors (the owner, 2026-11-03:
 * "add all Shopify website insights … ALL"): the tiles with their change against the period before, sessions and sales
 * over time, the conversion funnel, top products, sources, places, devices, landing pages and searches, each from
 * GET /api/website/shopify-analytics. A section whose scope isn't granted says which one to grant.
 */

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Delta, Tile } from '@/app/insights/insights-kit';
import { Card, countryName, flag, Ranked, type RankRow } from './site-kit';
import { Gate, int, moneyFormatter, rate, secondsLabel, useShopify, type Section } from './shopify-kit';
import { FigureTilesSkeleton, ChartSkeleton } from '@/components/shared/skeletons';
import { LoadError, withBoundary } from '@/components/shared/section-boundary';

type Kpis = Record<string, { value: number; before: number | null }>;
interface ListRow { key: string; label: string; code?: string; value: number; before: number | null; extra?: Record<string, number | null> }
interface Report {
  range: string; from: string; to: string; previous: { from: string; to: string } | null;
  shop: { name: string; currency: string; timezone: string } | null;
  scopes: { granted: string[] | null; checked: boolean; needs: string[] };
  sections: {
    sales: Section<Kpis>; traffic: Section<Kpis>;
    series: Section<{ grain: 'hour' | 'day'; points: { at: string; sessions: number; visitors: number; sales: number; orders: number }[] }>;
    funnel: Section<{ key: string; label: string; value: number; before: number | null }[]>;
    products: Section<ListRow[]>; productPages: Section<ListRow[]>; channels: Section<ListRow[]>; discounts: Section<ListRow[]>; customers: Section<ListRow[]>;
    sources: Section<ListRow[]>; places: Section<ListRow[]>; devices: Section<ListRow[]>; landing: Section<ListRow[]>; searches: Section<ListRow[]>;
  };
}

const PERIODS = [{ key: 'today', label: 'Today' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }, { key: '90d', label: '90 days' }, { key: 'month', label: 'This month' }] as const;
const KEY = 'erp.shopifyAnalytics.period';
const ShopifyChart = withBoundary(dynamic(() => import('./shopify-chart').then(m => m.ShopifyChart), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }), 'Shopify chart');

const shortDay = (d: string) => new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const hourLabel = (at: string) => `${at.slice(11, 13)}:00`;

const rows = (list: ListRow[], sub?: (r: ListRow) => string | undefined): RankRow[] => list.map(r => ({ key: r.key, value: r.value, label: r.label, sub: sub?.(r) }));

export function ShopifyReport({ siteHost }: { siteHost: string }) {
  const [period, setPeriodState] = useState<string>('30d');
  useEffect(() => { try { const v = localStorage.getItem(KEY); if (PERIODS.some(p => p.key === v)) setPeriodState(v!); } catch { /* private mode */ } }, []);
  const setPeriod = (p: string) => { setPeriodState(p); try { localStorage.setItem(KEY, p); } catch { /* private mode */ } };
  const [mode, setMode] = useState<'sessions' | 'sales'>('sessions');
  const { data: r, error, loading, reload } = useShopify<Report>(`/api/website/shopify-analytics?range=${period}&compare=1`);
  const money = moneyFormatter(r?.shop?.currency);
  const s = r?.sections;

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {PERIODS.map(p => (
          <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
            className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap min-h-0', period === p.key ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground hover:text-foreground')}>{p.label}</button>
        ))}
      </div>
      {error && <LoadError title="Shopify’s figures could not be loaded" message={error} onRetry={reload} busy={loading} />}
      {loading && !r && <div className="space-y-4"><FigureTilesSkeleton tiles={4} /><ChartSkeleton height={220} /></div>}
      {r && s && (
        <>
          <p className="text-xs text-muted-foreground">
            {siteHost} on Shopify · {r.from === r.to ? shortDay(r.from) : `${shortDay(r.from)} → ${shortDay(r.to)}`}
            {r.previous && <> · compared with {r.previous.from === r.previous.to ? shortDay(r.previous.from) : `${shortDay(r.previous.from)} → ${shortDay(r.previous.to)}`}</>} · Shopify may take a few minutes to catch up
          </p>

          <Gate title="Sales and sessions" section={s.traffic}>
            {k => (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <Tile label="Sessions" value={int(k.sessions?.value ?? 0)} delta={<Delta now={k.sessions?.value} before={k.sessions?.before} />} sub={`${(k.pageviewsPerSession?.value ?? 0).toFixed(1)} pages each`} />
                <Tile label="Visitors" value={int(k.visitors?.value ?? 0)} delta={<Delta now={k.visitors?.value} before={k.visitors?.before} />} />
                <Tile label="Page views" value={int(k.pageviews?.value ?? 0)} delta={<Delta now={k.pageviews?.value} before={k.pageviews?.before} />} />
                <Tile label="Conversion rate" value={rate(k.conversionRate?.value ?? 0)} delta={<Delta now={k.conversionRate?.value} before={k.conversionRate?.before} />} sub={`${int(k.completedCheckout?.value ?? 0)} checked out`} />
                <Tile label="Bounce rate" value={rate(k.bounceRate?.value ?? 0)} delta={<Delta now={k.bounceRate?.value} before={k.bounceRate?.before} invert />} />
                <Tile label="Time on site" value={secondsLabel(k.avgSessionSeconds?.value ?? 0)} delta={<Delta now={k.avgSessionSeconds?.value} before={k.avgSessionSeconds?.before} />} sub="a session" />
                <Tile label="Searches" value={int(k.searches?.value ?? 0)} delta={<Delta now={k.searches?.value} before={k.searches?.before} />} />
                <Tile label="Products viewed" value={int(k.productsViewed?.value ?? 0)} delta={<Delta now={k.productsViewed?.value} before={k.productsViewed?.before} />} />
              </div>
            )}
          </Gate>
          <Gate title="Sales" section={s.sales}>
            {k => (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <Tile label="Total sales" value={money(k.totalSales?.value ?? 0)} delta={<Delta now={k.totalSales?.value} before={k.totalSales?.before} />} />
                <Tile label="Orders" value={int(k.orders?.value ?? 0)} delta={<Delta now={k.orders?.value} before={k.orders?.before} />} />
                <Tile label="Average order" value={money(k.averageOrderValue?.value ?? 0)} delta={<Delta now={k.averageOrderValue?.value} before={k.averageOrderValue?.before} />} />
                <Tile label="Returning customers" value={rate(k.returningCustomerRate?.value ?? 0)} delta={<Delta now={k.returningCustomerRate?.value} before={k.returningCustomerRate?.before} />} sub={`${int(k.newCustomers?.value ?? 0)} new`} />
                <Tile label="Gross sales" value={money(k.grossSales?.value ?? 0)} delta={<Delta now={k.grossSales?.value} before={k.grossSales?.before} />} />
                <Tile label="Discounts" value={money(k.discounts?.value ?? 0)} delta={<Delta now={k.discounts?.value} before={k.discounts?.before} invert />} />
                <Tile label="Net sales" value={money(k.netSales?.value ?? 0)} delta={<Delta now={k.netSales?.value} before={k.netSales?.before} />} />
                <Tile label="Items sold" value={int(k.itemsSold?.value ?? 0)} delta={<Delta now={k.itemsSold?.value} before={k.itemsSold?.before} />} />
              </div>
            )}
          </Gate>

          <Gate title="Sessions and sales over time" section={s.series} skeleton="chart">
            {d => (
              <Card title={mode === 'sessions' ? 'Sessions over time' : 'Total sales over time'} note={d.grain === 'hour' ? 'by the hour' : 'day by day'}>
                <div className="flex rounded-full bg-muted p-0.5 w-fit" role="tablist">
                  {(['sessions', 'sales'] as const).map(m => (
                    <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                      className={cn('rounded-full px-3 py-1 text-xs min-h-0', mode === m ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground')}>{m === 'sessions' ? 'Sessions' : 'Sales'}</button>
                  ))}
                </div>
                <div className="h-56">
                  <ShopifyChart mode={mode} data={d.points.map(p => ({ label: d.grain === 'hour' ? hourLabel(p.at) : shortDay(p.at), sessions: p.sessions, sales: p.sales }))} />
                </div>
              </Card>
            )}
          </Gate>

          <Gate title="Conversion funnel" section={s.funnel}>
            {steps => (
              <Card title="Conversion funnel" note="sessions that…">
                <ul className="space-y-1.5">
                  {steps.map((st, i) => (
                    <li key={st.key} className="space-y-0.5">
                      <div className="flex justify-between gap-3 text-sm">
                        <span>{st.label}</span>
                        <span className="tabular-nums">{int(st.value)} <span className="text-xs text-muted-foreground">{i && steps[0].value ? `${((st.value / steps[0].value) * 100).toFixed(1)}% of sessions` : ''}</span> <Delta now={st.value} before={st.before} /></span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary/70" style={{ width: `${steps[0].value ? (st.value / steps[0].value) * 100 : 0}%` }} /></div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Gate>

          <div className="grid gap-2.5 md:grid-cols-2">
            <Gate title="Top products" section={s.products}>
              {l => <Card title="Top products" note={`net sales (${r.shop?.currency || ''})`}><Ranked rows={rows(l, x => (x.extra?.net_items_sold ? `${int(x.extra.net_items_sold)} sold` : undefined))} empty="No sales in this period." /></Card>}
            </Gate>
            <Gate title="Product pages people land on" section={s.productPages}>
              {l => <Card title="Product pages people land on" note="sessions; Shopify keeps no per-product views table"><Ranked rows={rows(l)} empty="None in this period." /></Card>}
            </Gate>
            <Gate title="Where they came from" section={s.sources}>
              {l => <Card title="Where they came from" note="sessions"><Ranked rows={rows(l, x => (x.extra?.sessions_that_completed_checkout ? `${x.extra.sessions_that_completed_checkout} bought` : undefined))} empty="No sessions yet." /></Card>}
            </Gate>
            <Gate title="Where they are" section={s.places}>
              {l => <Card title="Where they are" note="sessions"><Ranked rows={l.map(x => ({ key: x.key, value: x.value, label: <>{x.code ? flag(x.code) : '🌐'} {x.label.includes(',') || !x.code ? x.label : `${x.label}, ${countryName(x.code)}`}</> }))} empty="No sessions yet." /></Card>}
            </Gate>
            <Gate title="Devices" section={s.devices}>
              {l => <Card title="Devices"><Ranked rows={rows(l)} empty="No sessions yet." /></Card>}
            </Gate>
            <Gate title="Landing pages" section={s.landing}>
              {l => <Card title="Pages they arrived on" note="landing pages"><Ranked rows={l.map(x => ({ key: x.key, value: x.value, label: x.label, href: siteHost ? `https://${siteHost}${x.key}` : undefined, sub: x.extra?.bounce_rate ? `${rate(x.extra.bounce_rate)} bounced` : undefined }))} empty="No sessions yet." /></Card>}
            </Gate>
            <Gate title="Searches" section={s.searches}>
              {l => <Card title="What they searched for" note="on the store"><Ranked rows={l.map(x => ({ key: x.key, value: x.value, label: `“${x.label}”` }))} empty="No searches yet." /></Card>}
            </Gate>
            <Gate title="Sales by channel" section={s.channels}>
              {l => <Card title="Sales by channel" note="net sales"><Ranked rows={rows(l)} empty="No sales in this period." /></Card>}
            </Gate>
            <Gate title="Discount codes" section={s.discounts}>
              {l => <Card title="Discount codes" note="discounts given"><Ranked rows={rows(l)} empty="No codes used in this period." /></Card>}
            </Gate>
            <Gate title="New and returning customers" section={s.customers}>
              {l => <Card title="New and returning customers" note="total sales"><Ranked rows={rows(l)} empty="No sales in this period." /></Card>}
            </Gate>
          </div>
        </>
      )}
    </div>
  );
}
