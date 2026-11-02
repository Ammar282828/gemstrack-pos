'use client';

/**
 * Insights' charts, in their own module so recharts loads only when a chart is drawn
 * (the pages bring these in with next/dynamic).
 */

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { chartMotion } from '@/lib/chart-motion';
import { compact, count } from '@/lib/ads/shape';

type Rows = Record<string, any>[];

const tip = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };

export function ReachBars({ data }: { data: Rows }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: -10, right: 0, top: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
        <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [count(v), 'Reached']} />
        <Bar {...chartMotion()} dataKey="reach" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function FollowerLine({ data }: { data: Rows }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: -4, right: 6, top: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} domain={['dataMin - 5', 'dataMax + 5']} tickFormatter={v => compact(Number(v))} />
        <Tooltip contentStyle={tip} formatter={(v: number) => [count(v), 'Followers']} />
        <Line {...chartMotion()} dataKey="followers" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} type="monotone" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PageViewBars({ data }: { data: Rows }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: -10, right: 0, top: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={12} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => compact(Number(v))} />
        <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [count(v), 'Views']} />
        <Bar {...chartMotion()} dataKey="views" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OnlineHoursBars({ data }: { data: Rows }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ left: -16, right: 0, top: 5 }}>
        <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={9} tickLine={false} axisLine={false} interval={2} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v: number) => [count(v), 'Followers online']} />
        <Bar {...chartMotion()} dataKey="online" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
