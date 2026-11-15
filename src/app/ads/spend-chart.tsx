'use client';

/**
 * Ads → Overview's day-by-day chart, in its own module so recharts loads only when it is drawn.
 * Two small charts on the same days, one axis each (spend above, results below), instead of one chart
 * with two y-axes the reader has to match to their series by colour.
 */

import React from 'react';
import { ResponsiveContainer, BarChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { chartMotion } from '@/lib/chart-motion';
import { compact, count, money } from '@/lib/ads/shape';

const TICK = { fontSize: 11 };
const TIP = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };

export function SpendChart({ data, cur, resultLabel }: { data: Record<string, any>[]; cur: string; resultLabel?: string }) {
  const label = resultLabel ?? 'Results';
  const spend = data.reduce((n, d) => n + (Number(d.spend) || 0), 0);
  const results = data.reduce((n, d) => n + (Number(d.result) || 0), 0);
  const summary = `Day by day over ${data.length} days: ${money(spend, cur)} spent, ${count(results)} ${label.toLowerCase()}.`;
  return (
    <div role="img" aria-label={summary} className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1">
        <p className="text-2xs text-muted-foreground">Spent</p>
        <ResponsiveContainer width="100%" height="85%">
          <BarChart accessibilityLayer data={data} margin={{ left: -10, right: 0, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis stroke="hsl(var(--muted-foreground))" tick={TICK} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
            <Tooltip contentStyle={TIP} formatter={(v: number) => [money(v, cur), 'Spent']} />
            <Bar {...chartMotion()} dataKey="spend" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="min-h-0 flex-1">
        <p className="text-2xs text-muted-foreground">{label}</p>
        <ResponsiveContainer width="100%" height="85%">
          <LineChart accessibilityLayer data={data} margin={{ left: -10, right: 0, top: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" tick={TICK} tickLine={false} axisLine={false} minTickGap={12} />
            <YAxis stroke="hsl(var(--muted-foreground))" tick={TICK} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
            <Tooltip contentStyle={TIP} formatter={(v: number) => [count(v), label]} />
            <Line {...chartMotion()} dataKey="result" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
