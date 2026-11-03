'use client';

/** Taken-by-day's bars, in their own module so recharts loads only when the dialog is opened. */

import React from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';
import { chartMotion } from '@/lib/chart-motion';
import { lacCrore } from '@/lib/money';
import { METHOD_KEYS, METHOD_LABEL, type MethodSplit } from '@/lib/taken-by-day';
import { METHOD_COLOR, type DayBar } from './taken-bars';

export function TakenChart({ bars, selected, onSelect }: { bars: DayBar[]; selected: string; onSelect: (day: string) => void }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={bars} margin={{ left: -6, right: 0, top: 5 }} onClick={(s: { activeLabel?: string | number; activePayload?: { payload?: DayBar }[] } | undefined) => {
        const day = s?.activePayload?.[0]?.payload?.day;
        if (day) onSelect(day);
      }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} minTickGap={14} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => lacCrore(Number(v))} width={44} />
        <Tooltip cursor={{ fill: 'hsl(var(--muted) / .5)' }}
          contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
          labelFormatter={(_l, p) => p?.[0]?.payload?.label ?? ''}
          formatter={(v: number, name: string) => [`PKR ${Math.round(v).toLocaleString()}`, METHOD_LABEL[name as keyof MethodSplit] ?? name]} />
        {METHOD_KEYS.map((k, i) => (
          <Bar key={k} {...chartMotion()} dataKey={k} stackId="t" fill={METHOD_COLOR[k]} maxBarSize={36} radius={i === METHOD_KEYS.length - 1 ? [3, 3, 0, 0] : 0} cursor="pointer">
            {bars.map(b => <Cell key={b.day} fillOpacity={selected && b.day !== selected ? 0.45 : 1} />)}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
