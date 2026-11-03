'use client';

/** The Shopify report's sales-and-sessions chart, in its own module so recharts loads only when it is drawn. */

import React from 'react';
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Line, Bar, ComposedChart } from 'recharts';
import { chartMotion } from '@/lib/chart-motion';

const tip = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };

export function ShopifyChart({ data, mode }: { data: { label: string; sessions: number; sales: number }[]; mode: 'sessions' | 'sales' }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ left: -12, right: 0, top: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={14} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} />
        {mode === 'sessions'
          ? <Bar {...chartMotion()} dataKey="sessions" name="Sessions" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={24} />
          : <Line {...chartMotion()} dataKey="sales" name="Total sales" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} type="monotone" />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
