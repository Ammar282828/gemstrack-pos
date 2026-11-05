'use client';

/**
 * Analytics' charts as pages should import them: recharts is heavy, so each chart is fetched with next/dynamic when it
 * is first drawn, in its own error boundary, with a skeleton of the chart's height meanwhile (no jump when it lands).
 *
 *   import { TrendArea, HBars, ana } from '@/components/analytics/lazy-charts';
 *
 * Same names and props as charts.tsx. The colours and the CSS-only StackedBar100 are not lazy (no library in them).
 */

import React from 'react';
import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { withBoundary } from '@/components/shared/section-boundary';
import type * as Charts from '@/components/analytics/charts';

export { ana, karatColor, KARAT_COLORS, SOURCE_COLORS, KIND_COLORS, KIND_LABELS } from '@/components/analytics/colors';
export { StackedBar100, type StackedBar100Props, type StackPart } from '@/components/analytics/stacked-bar-100';
export type { TrendRow, WaterfallStep, HBarRow, SeriesDef, WeekdayDatum } from '@/components/analytics/charts';

function lazy<P extends object>(load: () => Promise<React.ComponentType<P>>, name: string, heightOf: (p: P) => number) {
  const Chart = withBoundary(
    dynamic(load, { ssr: false, loading: () => <Skeleton className="h-[var(--chart-h)] w-full rounded-card" /> }) as React.ComponentType<P>,
    name,
  );
  function Lazy(props: P) {
    return (
      <div style={{ ['--chart-h' as string]: `${heightOf(props)}px` }}>
        <Chart {...props} />
      </div>
    );
  }
  Lazy.displayName = `Lazy(${name})`;
  return Lazy;
}

type ChartName = 'TrendArea' | 'Sparkline' | 'Waterfall' | 'HBars' | 'GroupedBars' | 'StackedBars' | 'WeekdayBars' | 'LineSmall' | 'MonthlyRevenueChart' | 'SourceTrendChart';
type Props<K extends ChartName> = React.ComponentProps<(typeof Charts)[K]>;
const h = (p: { height?: number }, d: number) => p.height ?? d;

export const TrendArea = lazy<Props<'TrendArea'>>(() => import('./charts').then(m => m.TrendArea), 'Trend', p => h(p, 180));
export const Sparkline = lazy<Props<'Sparkline'>>(() => import('./charts').then(m => m.Sparkline), 'Sparkline', p => h(p, 32));
export const Waterfall = lazy<Props<'Waterfall'>>(() => import('./charts').then(m => m.Waterfall), 'From revenue to profit', p => h(p, 260));
export const HBars = lazy<Props<'HBars'>>(() => import('./charts').then(m => m.HBars), 'Bars', p => Math.max(1, p.data.length) * 32 + 8);
export const GroupedBars = lazy<Props<'GroupedBars'>>(() => import('./charts').then(m => m.GroupedBars), 'Bars', p => h(p, 260) + 24);
export const StackedBars = lazy<Props<'StackedBars'>>(() => import('./charts').then(m => m.StackedBars), 'Stacked bars', p => h(p, 260) + 24);
export const WeekdayBars = lazy<Props<'WeekdayBars'>>(() => import('./charts').then(m => m.WeekdayBars), 'By weekday', p => h(p, 200));
export const LineSmall = lazy<Props<'LineSmall'>>(() => import('./charts').then(m => m.LineSmall), 'Line', p => h(p, 140));
export const MonthlyRevenueChart = lazy<Props<'MonthlyRevenueChart'>>(() => import('./charts').then(m => m.MonthlyRevenueChart), 'Revenue by month', p => h(p, 280));
export const SourceTrendChart = lazy<Props<'SourceTrendChart'>>(() => import('./charts').then(m => m.SourceTrendChart), 'Source trend', p => h(p, 280) + 24);
