'use client';

/** Ads → Overview's day-by-day chart, in its own module so recharts loads only when it is drawn. */

import React from 'react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { chartMotion } from '@/lib/chart-motion';
import { compact, count, money } from '@/lib/ads/shape';

export function SpendChart({ data, cur, resultLabel }: { data: Record<string, any>[]; cur: string; resultLabel?: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ left: -10, right: 0, top: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis yAxisId="s" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
        <YAxis yAxisId="r" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
        <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
          formatter={(v: number, name: string) => (name === 'spend' ? [money(v, cur), 'Spent'] : [count(v), resultLabel ?? 'Results'])} />
        <Bar {...chartMotion()} yAxisId="s" dataKey="spend" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Line {...chartMotion()} yAxisId="r" dataKey="result" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} type="monotone" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
