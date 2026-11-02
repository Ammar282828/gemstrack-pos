'use client';

/** Interest's sessions chart, in its own module so recharts loads only when it is drawn. */

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Line, ComposedChart } from 'recharts';
import { chartMotion } from '@/lib/chart-motion';

const tip = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 };

export function SessionsChart({ data, hours }: { data: Record<string, any>[]; hours: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {hours ? (
        <BarChart data={data} margin={{ left: -18, right: 0, top: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} interval={2} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} />
          <Bar {...chartMotion()} dataKey="before" name="Day before" fill="hsl(var(--muted-foreground) / 0.25)" radius={[3, 3, 0, 0]} maxBarSize={14} />
          <Bar {...chartMotion()} dataKey="sessions" name="Sessions" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} maxBarSize={14} />
        </BarChart>
      ) : (
        <ComposedChart data={data} margin={{ left: -18, right: 0, top: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={14} />
          <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tip} cursor={{ fill: 'hsl(var(--muted))' }} />
          <Bar {...chartMotion()} dataKey="sessions" name="Sessions" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={24} />
          <Line {...chartMotion()} dataKey="visitors" name="Visitors" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} dot={false} type="monotone" />
          <Line {...chartMotion()} dataKey="enquiries" name="WhatsApp" stroke="hsl(var(--success))" strokeWidth={2} dot={false} type="monotone" />
        </ComposedChart>
      )}
    </ResponsiveContainer>
  );
}
