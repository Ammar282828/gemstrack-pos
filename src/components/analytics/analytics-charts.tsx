'use client';

/**
 * Analytics' charts, each in a component of its own so recharts loads only when a chart is drawn
 * (analytics-view.tsx brings these in with next/dynamic).
 */

import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ReferenceLine, Cell } from 'recharts';
import { format, parseISO } from 'date-fns';
import { chartMotion } from '@/lib/chart-motion';
import { pkrLac, axisLac } from '@/lib/money';

const TIP = {
  contentStyle: { backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))' },
  labelStyle: { color: 'hsl(var(--foreground))' },
  itemStyle: { color: 'hsl(var(--foreground))' },
};

type Rows = Record<string, any>[];

export function ExpensesByCategoryChart({ data }: { data: Rows }) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data} layout="vertical" margin={{ right: 10, left: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => axisLac(Number(value))} />
        <YAxis dataKey="category" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={85} interval={0} />
        <Tooltip {...TIP} formatter={(value: number) => [`${pkrLac(value)}`, "Amount"]} />
        <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
        <Bar {...chartMotion()} dataKey="amount" name="Amount" fill="hsl(var(--chart-5))" radius={[0, 4, 4, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SalesOverTimeChart({ data }: { data: Rows }) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))"/>
        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
        <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => axisLac(Number(value))} />
        <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} />
        <Tooltip
          {...TIP}
          formatter={(value: number, name: string) => {
            if (name === 'Sales') return [`${pkrLac(value)}`, name];
            if (name === 'Orders') return [value.toLocaleString(), name];
            return [value, name];
          }}
        />
        <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
        <Line {...chartMotion()} yAxisId="left" type="monotone" dataKey="sales" name="Sales" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={{ r: 4, fill: 'hsl(var(--chart-1))', strokeWidth:0 }} activeDot={{ r: 6, fill: 'hsl(var(--chart-1))', strokeWidth:0 }}/>
        <Line {...chartMotion()} yAxisId="right" type="monotone" dataKey="orders" name="Orders" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 4, fill: 'hsl(var(--chart-2))', strokeWidth:0 }} activeDot={{ r: 6, fill: 'hsl(var(--chart-2))', strokeWidth:0 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MonthlyRevenueChart({ data, average, best }: { data: { key: string }[] & Rows; average: number; best: string | null | undefined }) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis
          dataKey="month"
          stroke="hsl(var(--muted-foreground))"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={8}
        />
        <YAxis
          stroke="hsl(var(--muted-foreground))"
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => axisLac(Number(v))}
        />
        <Tooltip
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }}
          {...TIP}
          formatter={(value: number, _name: string, entry: { payload?: { sales?: number } }) => [
            `${pkrLac(value)}${entry?.payload?.sales ? ` · ${entry.payload.sales} sale${entry.payload.sales === 1 ? '' : 's'}` : ''}`,
            'Revenue',
          ]}
        />
        {average > 0 && (
          <ReferenceLine
            y={average}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="4 4"
            label={{ value: 'avg', position: 'right', fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
          />
        )}
        <Bar {...chartMotion()} dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
          {/* The best month is picked out so the peak is findable at a glance. */}
          {data.map(d => (
            <Cell key={d.key} fill={d.key === best ? 'hsl(var(--chart-2))' : 'hsl(var(--chart-1))'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SalesByCategoryChart({ data }: { data: Rows }) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data} layout="vertical" margin={{ right: 10, left: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => axisLac(Number(value))} />
        <YAxis dataKey="categoryName" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={85} interval={0} />
        <Tooltip {...TIP} formatter={(value: number) => [`${pkrLac(value)}`, "Sales"]} />
        <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
        <Bar {...chartMotion()} dataKey="sales" name="Sales" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SourceTrendChart({ data, keys, labels, colors }: { data: Rows; keys: string[]; labels: Record<string, string>; colors: Record<string, string> }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => format(parseISO(value), 'MMM d')} />
        <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(value) => axisLac(Number(value))} />
        <Tooltip
          {...TIP}
          labelFormatter={(label) => format(parseISO(label as string), 'EEE, MMM d, yyyy')}
          formatter={(value: number, name: string) => [`${pkrLac(value)}`, name]}
        />
        <Legend wrapperStyle={{ color: 'hsl(var(--muted-foreground))' }} />
        {keys.map((key) => (
          <Line {...chartMotion()}
            key={key}
            type="monotone"
            dataKey={key}
            name={labels[key]}
            stroke={colors[key]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: colors[key], strokeWidth: 0 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
