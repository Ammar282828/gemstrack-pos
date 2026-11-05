'use client';

/**
 * Analytics' charts, one component each, so recharts loads only when a chart is drawn (pages import them through
 * lazy-charts.tsx, which brings them in with next/dynamic).
 *
 * The rules every chart here keeps (the owner asked for a simpler page with more pictures; these keep the pictures honest):
 *  - ONE y-axis per chart, ever. Two measures of different scale are two charts.
 *  - Series colours come from `--ana-1…6` (globals.css) in a fixed order and follow the entity, never its rank: a karat,
 *    a source, a kind of expense always wears its own colour (`karatColor`, `SOURCE_COLORS`, `KIND_COLORS`). One series
 *    needs no legend and wears `--ana-1`; two or more always get one. Good and bad are the tones, never a series colour.
 *  - Thin marks: bars rounded 4px at the data end, a 2px gap between stacked segments and neighbours, 2px lines, no dots
 *    but the hovered one. Only horizontal hairlines for a grid, no axis lines, 11px muted ticks, `axisLac` on money.
 *  - A tooltip on every chart; direct labels on the few marks that matter (the top bar, each waterfall step, the last
 *    point), never a number on every point of a line.
 *  - `chartMotion()` on every series; a fixed height inside a full-width ResponsiveContainer.
 */

import React, { useId } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, LineChart, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { format as fmtDate, parseISO } from 'date-fns';
import { chartMotion } from '@/lib/chart-motion';
import { axisLac, lacCrore, pkrLac } from '@/lib/money';
import { formatDate } from '@/lib/safe-date';
import { SOURCE_LABELS } from '@/lib/analytics/books';
import { ana, SOURCE_COLORS } from '@/components/analytics/colors';

export { StackedBar100, type StackedBar100Props, type StackPart } from '@/components/analytics/stacked-bar-100';

export { ana, KARAT_COLORS, karatColor, SOURCE_COLORS, KIND_COLORS, KIND_LABELS } from '@/components/analytics/colors';

// ── Shared pieces ───────────────────────────────────────────────────────────

const MUTED = 'hsl(var(--muted-foreground))';
const FG = 'hsl(var(--foreground))';
const TICK = { fontSize: 11, fill: MUTED };
const AXIS = { tickLine: false, axisLine: false, tick: TICK } as const;
const GRID = <CartesianGrid vertical={false} stroke="hsl(var(--border))" />;
const CROSSHAIR = { stroke: MUTED, strokeWidth: 1, strokeDasharray: '3 3' };
const BAND = { fill: 'hsl(var(--muted))', opacity: 0.35 };

const TIP = {
  contentStyle: { backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 },
  labelStyle: { color: FG },
  itemStyle: { color: FG },
};

type Rows = Record<string, any>[];
type Money = (n: number) => string;

export interface SeriesDef { key: string; label: string; color?: string }

/** The key under a chart of two or more series: colour, name. Dashed for a reference line. */
export function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-ios-foot text-muted-foreground">
      {items.map(i => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0 w-3.5 border-t-2" style={{ borderColor: i.color, borderStyle: i.dashed ? 'dashed' : 'solid' }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** A tooltip of our own for charts whose rows hold more than the series (title from `tip`, one line per series). */
function Tip({ active, payload, label, format, title, hide }: {
  active?: boolean; payload?: any[]; label?: any; format: Money; title?: (row: any, label: any) => React.ReactNode; hide?: (name: string) => boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  const lines = payload.filter(p => p.value != null && !(hide?.(String(p.dataKey))) && p.name !== undefined);
  return (
    <div style={TIP.contentStyle} className="px-3 py-2 shadow-none">
      <p className="mb-1 font-medium text-foreground">{title ? title(row, label) : label}</p>
      {lines.map(p => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 tabular-nums text-foreground">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.stroke || p.fill }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-medium">{format(Number(p.value))}</span>
        </p>
      ))}
    </div>
  );
}

const fits = (s: string, px: number) => (s.length * 6.2 <= px ? s : `${s.slice(0, Math.max(3, Math.floor(px / 6.2) - 1))}…`);

// ── TrendArea ───────────────────────────────────────────────────────────────

export interface TrendRow { label: string; tip?: string; value: number; prev?: number; prevLabel?: string }

/**
 * A measure over time as an area, the period before as a dashed line on the SAME axis (same measure, so one axis).
 * The last point is labelled; hover draws a crosshair. `data` from `compareSeries` (lib/analytics/books.ts).
 */
export function TrendArea({ data, height = 180, name = 'Revenue', prevName = 'Previous period', showPrev = true, format = pkrLac, last = true }: {
  data: TrendRow[]; height?: number; name?: string; prevName?: string; showPrev?: boolean; format?: Money; last?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const withPrev = showPrev && data.some(d => d.prev !== undefined);
  const tail = data[data.length - 1];
  return (
    <div>
      {withPrev && <ChartLegend items={[{ label: name, color: ana(1) }, { label: prevName, color: MUTED, dashed: true }]} />}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 18, right: 14, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ana(1)} stopOpacity={0.28} />
              <stop offset="100%" stopColor={ana(1)} stopOpacity={0} />
            </linearGradient>
          </defs>
          {GRID}
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} tickMargin={6} />
          <YAxis {...AXIS} width={44} tickFormatter={v => axisLac(Number(v))} />
          <Tooltip cursor={CROSSHAIR} content={<Tip format={format} title={(r, l) => r?.tip ?? l} />} />
          {withPrev && (
            <Line {...chartMotion()} type="monotone" dataKey="prev" name={prevName} stroke={MUTED} strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4, fill: MUTED, strokeWidth: 0 }} />
          )}
          <Area {...chartMotion()} type="monotone" dataKey="value" name={name} stroke={ana(1)} strokeWidth={2} fill={`url(#g${id})`} dot={false} activeDot={{ r: 5, fill: ana(1), stroke: 'hsl(var(--card))', strokeWidth: 2 }} />
          {last && tail && tail.value > 0 && (
            <ReferenceDot x={tail.label} y={tail.value} r={3.5} fill={ana(1)} stroke="none" ifOverflow="extendDomain"
              // Ending at the dot, not centred on it: the last point sits on the right edge, where a centred label is cut.
              label={({ viewBox }: any) => viewBox ? (
                <text x={viewBox.x + viewBox.width / 2 + 4} y={viewBox.y - 6} textAnchor="end" fontSize={11} fill={FG}>{lacCrore(tail.value)}</text>
              ) : <g />} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Sparkline ───────────────────────────────────────────────────────────────

/** A line and nothing else, 32px: a trend you glance at beside a number. Decorative, so no tooltip. */
export function Sparkline({ data, height = 32, color = ana(1) }: { data: number[]; height?: number; color?: string }) {
  const rows = data.map((v, i) => ({ i, v }));
  return (
    <div aria-hidden>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 3, right: 2, left: 2, bottom: 3 }}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line {...chartMotion()} type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} activeDot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Waterfall ───────────────────────────────────────────────────────────────

export interface WaterfallStep {
  label: string;
  /** A total stands on the axis; a change moves from where the last step ended (negative takes away). */
  kind: 'total' | 'change';
  value: number;
}

const signed = (n: number) => (n < 0 ? `−${lacCrore(-n)}` : lacCrore(n));

/**
 * Revenue → profit → net: totals stand on zero, costs hang from the level before. Built from a stacked bar chart with
 * an invisible base; every step is labelled. Totals wear the house colour, costs the late tone, a net profit the
 * settled one (or late when it is a loss).
 */
export function Waterfall({ steps, height = 260, format = pkrLac }: { steps: WaterfallStep[]; height?: number; format?: Money }) {
  let level = 0;
  const rows = steps.map((s, i) => {
    const from = s.kind === 'total' ? 0 : level;
    const to = s.kind === 'total' ? s.value : level + s.value;
    level = to;
    const lo = Math.min(from, to), hi = Math.max(from, to);
    // A bar wholly above zero stands on an invisible base; wholly below, hangs from one; across zero, two visible halves.
    const [base, up, down] = lo >= 0 ? [lo, hi - lo, 0] : hi <= 0 ? [hi, 0, lo - hi] : [0, hi, lo];
    const last = i === steps.length - 1;
    const color = s.kind === 'change' ? 'hsl(var(--tone-late))' : last && steps.length > 2 ? (s.value >= 0 ? 'hsl(var(--tone-settled))' : 'hsl(var(--tone-late))') : ana(1);
    return { label: s.label, value: s.value, kind: s.kind, base, up, down, color };
  });
  const label = (which: 'up' | 'down') => ({ x, y, width, height: h, index }: any) => {
    const r = rows[index];
    if (!r || (which === 'down' && r.up !== 0) || (which === 'up' && r.up === 0)) return null;
    const top = Math.min(y, y + h), bottom = Math.max(y, y + h);
    const text = r.kind === 'change' ? signed(r.value) : lacCrore(r.value);
    return <text x={x + width / 2} y={which === 'up' ? top - 6 : bottom + 14} textAnchor="middle" fontSize={11} fontWeight={600} fill={FG}>{text}</text>;
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 24, right: 8, left: 0, bottom: 4 }} barCategoryGap={8}>
        {GRID}
        <XAxis dataKey="label" {...AXIS} interval={0} tickMargin={6} />
        <YAxis {...AXIS} width={44} tickFormatter={v => axisLac(Number(v))} />
        <ReferenceLine y={0} stroke="hsl(var(--border))" />
        <Tooltip cursor={BAND} content={({ active, payload }) => {
          const r = active ? payload?.[0]?.payload : null;
          return r ? (
            <div style={TIP.contentStyle} className="px-3 py-2">
              <p className="font-medium text-foreground">{r.label}</p>
              <p className="tabular-nums text-foreground">{r.kind === 'change' && r.value < 0 ? '−' : ''}{format(Math.abs(r.value))}</p>
            </div>
          ) : null;
        }} />
        <Bar {...chartMotion()} dataKey="base" stackId="w" fill="transparent" stroke="none" isAnimationActive={false} legendType="none" />
        <Bar {...chartMotion()} dataKey="up" stackId="w" maxBarSize={56} radius={[4, 4, 0, 0]}>
          {rows.map((r, i) => <Cell key={i} fill={r.color} />)}
          <LabelList dataKey="up" content={label('up')} />
        </Bar>
        <Bar {...chartMotion()} dataKey="down" stackId="w" maxBarSize={56} radius={[0, 0, 4, 4]}>
          {rows.map((r, i) => <Cell key={i} fill={r.color} />)}
          <LabelList dataKey="down" content={label('down')} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── HBars ───────────────────────────────────────────────────────────────────

export interface HBarRow {
  label: string;
  /** Not negative. */
  value: number;
  /** A fixed colour for this entity (the default is the house colour). */
  color?: string;
  /** A small word after the value ("running", "goods"): the category's kind, so colour is never the only sign. */
  chip?: string;
}

const ROW = 32;

/** Horizontal bars, sorted as given, each with its value at the end (and a chip). Its height follows the row count. */
export function HBars({ data, format = lacCrore, name = 'Amount', labelWidth = 108, tipFormat = pkrLac }: {
  data: HBarRow[]; format?: Money; name?: string; labelWidth?: number; tipFormat?: Money;
}) {
  const hasChip = data.some(d => d.chip);
  const valueTick = ({ x, y, payload }: any) => (
    // From the chart's own left edge (the label column starts there): a name shortened by `fits` can never be cut.
    <text x={4} y={y} dy={4} textAnchor="start" fontSize={11} fill={FG}>
      <title>{payload.value}</title>{fits(String(payload.value), labelWidth - 22)}
    </text>
  );
  const end = ({ x, y, width, height: h, index }: any) => {
    const r = data[index];
    if (!r) return null;
    const text = format(r.value);
    const cx = x + width + 8;
    return (
      <g>
        <text x={cx} y={y + h / 2} dy={4} fontSize={11} fontWeight={600} fill={FG}>{text}</text>
        {r.chip && (
          <g transform={`translate(${cx + text.length * 6.4 + 8}, ${y + h / 2 - 8})`}>
            <rect width={r.chip.length * 5.8 + 12} height={16} rx={8} fill="hsl(var(--muted))" />
            <text x={6} y={11.5} fontSize={10} fill={MUTED}>{r.chip}</text>
          </g>
        )}
      </g>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={Math.max(1, data.length) * ROW + 8}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: hasChip ? 112 : 72, left: 0, bottom: 4 }} barCategoryGap={8}>
        <XAxis type="number" hide domain={[0, 'dataMax']} />
        <YAxis type="category" dataKey="label" {...AXIS} width={labelWidth} interval={0} tick={valueTick} />
        <Tooltip cursor={BAND} {...TIP} formatter={(v: number) => [tipFormat(v), name]} />
        <Bar {...chartMotion()} dataKey="value" name={name} barSize={14} radius={[0, 4, 4, 0]} background={{ fill: 'hsl(var(--muted))', opacity: 0.35, radius: 4 } as any}>
          {data.map((d, i) => <Cell key={i} fill={d.color ?? ana(1)} />)}
          <LabelList dataKey="value" content={end} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── GroupedBars ─────────────────────────────────────────────────────────────

/**
 * Bars side by side per x, on one axis; optionally a line on that SAME axis (the net beside money in and out). Two or
 * more series always get a legend.
 */
export function GroupedBars({ data, series, line, xKey = 'label', height = 260, format = pkrLac }: {
  data: Rows; series: SeriesDef[]; line?: SeriesDef; xKey?: string; height?: number; format?: Money;
}) {
  const colorOf = (s: SeriesDef, i: number) => s.color ?? ana(i + 1);
  const items = [...series.map((s, i) => ({ label: s.label, color: colorOf(s, i) })), ...(line ? [{ label: line.label, color: line.color ?? FG }] : [])];
  const negative = data.some(d => [...series, ...(line ? [line] : [])].some(s => Number(d[s.key]) < 0));
  return (
    <div>
      {items.length > 1 && <ChartLegend items={items} />}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
          {GRID}
          <XAxis dataKey={xKey} {...AXIS} interval="preserveStartEnd" minTickGap={8} tickMargin={6} />
          <YAxis {...AXIS} width={44} tickFormatter={v => axisLac(Number(v))} />
          {negative && <ReferenceLine y={0} stroke="hsl(var(--border))" />}
          <Tooltip cursor={BAND} content={<Tip format={format} />} />
          {series.map((s, i) => (
            <Bar {...chartMotion()} key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s, i)} maxBarSize={16} radius={[4, 4, 0, 0]} />
          ))}
          {line && (
            <Line {...chartMotion()} type="monotone" dataKey={line.key} name={line.label} stroke={line.color ?? FG} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: line.color ?? FG, strokeWidth: 0 }} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── StackedBars ─────────────────────────────────────────────────────────────

/**
 * Parts stacked into a whole per x (or per row with `layout="vertical"`: horizontal bars on one shared scale, the way
 * money in sits beside money out). A 2px gap between segments; a legend always.
 */
export function StackedBars({ data, series, xKey = 'label', height = 260, format = pkrLac, layout = 'horizontal', valueFormat }: {
  data: Rows; series: SeriesDef[]; xKey?: string; height?: number; format?: Money; layout?: 'horizontal' | 'vertical';
  /** The unit on the axis and in the tooltip when it is not rupees (tola). */
  valueFormat?: { axis: (n: number) => string; tip: Money };
}) {
  const axis = valueFormat?.axis ?? axisLac;
  const tip = valueFormat?.tip ?? format;
  const vertical = layout === 'vertical';
  const gap = { stroke: 'hsl(var(--card))', strokeWidth: 2 };
  return (
    <div>
      <ChartLegend items={series.map((s, i) => ({ label: s.label, color: s.color ?? ana(i + 1) }))} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout={vertical ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={vertical ? 14 : '22%'}>
          {vertical ? <CartesianGrid horizontal={false} stroke="hsl(var(--border))" /> : GRID}
          {/* Direct children, never a fragment: recharts finds its axes by walking its own children only. */}
          {vertical && <XAxis type="number" {...AXIS} tickFormatter={v => axis(Number(v))} />}
          {vertical && <YAxis type="category" dataKey={xKey} {...AXIS} width={36} />}
          {!vertical && <XAxis dataKey={xKey} {...AXIS} interval="preserveStartEnd" minTickGap={8} tickMargin={6} />}
          {!vertical && <YAxis {...AXIS} width={44} tickFormatter={v => axis(Number(v))} />}
          <Tooltip cursor={BAND} content={<Tip format={tip} hide={() => false} />} />
          {series.map((s, i) => (
            <Bar {...chartMotion()} key={s.key} dataKey={s.key} name={s.label} stackId="s" fill={s.color ?? ana(i + 1)} {...gap}
              maxBarSize={vertical ? 28 : 32}
              radius={i === series.length - 1 ? (vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── WeekdayBars ─────────────────────────────────────────────────────────────

export interface WeekdayDatum { label: string; avg: number; revenue: number; count: number; days: number }

/** Seven bars, the average revenue of each weekday; the best one carries its value. */
export function WeekdayBars({ data, height = 200, format = pkrLac }: { data: WeekdayDatum[]; height?: number; format?: Money }) {
  const best = data.reduce((m, d, i) => (d.avg > (data[m]?.avg ?? 0) ? i : m), 0);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        {GRID}
        <XAxis dataKey="label" {...AXIS} tickMargin={6} interval={0} />
        <YAxis {...AXIS} width={44} tickFormatter={v => axisLac(Number(v))} />
        <Tooltip cursor={BAND} content={({ active, payload }) => {
          const r: WeekdayDatum | undefined = active ? payload?.[0]?.payload : undefined;
          return r ? (
            <div style={TIP.contentStyle} className="px-3 py-2 tabular-nums">
              <p className="font-medium text-foreground">{r.label}</p>
              <p className="text-foreground">{format(r.avg)} <span className="text-muted-foreground">on average</span></p>
              <p className="text-muted-foreground">{format(r.revenue)} over {r.days} {r.label}{r.days === 1 ? '' : 's'} · {r.count} sale{r.count === 1 ? '' : 's'}</p>
            </div>
          ) : null;
        }} />
        <Bar {...chartMotion()} dataKey="avg" name="Average" fill={ana(1)} maxBarSize={36} radius={[4, 4, 0, 0]}>
          <LabelList dataKey="avg" content={({ x, y, width, index }: any) => index === best && data[best]?.avg > 0 ? (
            // The first and last bars' labels lean inwards, clear of the axis and the card's edge.
            <text x={index === 0 ? x : index === data.length - 1 ? x + width : x + width / 2} y={y - 6}
              textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'} fontSize={11} fontWeight={600} fill={FG}>{lacCrore(data[best].avg)}</text>
          ) : null} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── LineSmall ───────────────────────────────────────────────────────────────

/** A small line on its own axis (net margin %), the last point labelled. Never share it with a money chart. */
export function LineSmall({ data, yKey, name, xKey = 'label', height = 140, color = ana(1), format = (n: number) => `${n.toFixed(1)}%` }: {
  data: Rows; yKey: string; name: string; xKey?: string; height?: number; color?: string; format?: (n: number) => string;
}) {
  const tail = data[data.length - 1];
  const values = data.map(d => Number(d[yKey]) || 0);
  const crossesZero = Math.min(...values) < 0;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 18, right: 14, left: 0, bottom: 0 }}>
        {GRID}
        <XAxis dataKey={xKey} {...AXIS} interval="preserveStartEnd" minTickGap={16} tickMargin={6} />
        <YAxis {...AXIS} width={44} tickFormatter={v => `${Math.round(Number(v))}%`} />
        {crossesZero && <ReferenceLine y={0} stroke="hsl(var(--border))" />}
        <Tooltip cursor={CROSSHAIR} {...TIP} formatter={(v: number) => [format(v), name]} />
        <Line {...chartMotion()} type="monotone" dataKey={yKey} name={name} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 5, fill: color, strokeWidth: 0 }} />
        {tail && (
          <ReferenceDot x={tail[xKey]} y={Number(tail[yKey]) || 0} r={3.5} fill={color} stroke="none"
            label={{ value: format(Number(tail[yKey]) || 0), position: 'top', fill: FG, fontSize: 11 }} />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Month by month, and the sources' trend (moved from analytics-charts.tsx) ─

/**
 * Revenue per calendar month, every month on record. One series in the house colour; the average is a dashed
 * reference line on the same axis and the best month carries its value.
 */
export function MonthlyRevenueChart({ data, average, best, height = 280 }: { data: { key: string }[] & Rows; average: number; best: string | null | undefined; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 12, left: 0, bottom: 0 }} barCategoryGap="22%">
        {GRID}
        <XAxis dataKey="month" {...AXIS} interval="preserveStartEnd" minTickGap={8} tickMargin={6} />
        <YAxis {...AXIS} width={44} tickFormatter={v => axisLac(Number(v))} />
        <Tooltip
          cursor={BAND}
          {...TIP}
          formatter={(value: number, _name: string, entry: { payload?: { sales?: number } }) => [
            `${pkrLac(value)}${entry?.payload?.sales ? ` · ${entry.payload.sales} sale${entry.payload.sales === 1 ? '' : 's'}` : ''}`,
            'Revenue',
          ]}
        />
        {average > 0 && (
          <ReferenceLine y={average} stroke={MUTED} strokeDasharray="4 4" label={{ value: 'avg', position: 'insideTopRight', fill: MUTED, fontSize: 11 }} />
        )}
        <Bar {...chartMotion()} dataKey="revenue" name="Revenue" fill={ana(1)} maxBarSize={32} radius={[4, 4, 0, 0]}>
          <LabelList dataKey="revenue" content={({ x, y, width, index }: any) => data[index]?.key === best && data[index]?.revenue > 0 ? (
            <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill={FG}>{lacCrore(data[index].revenue)}</text>
          ) : null} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Revenue per day by acquisition source, a line each in the source's own colour (`SOURCE_COLORS`). */
export function SourceTrendChart({ data, keys, labels = SOURCE_LABELS, colors = SOURCE_COLORS, height = 280 }: {
  data: Rows; keys: string[]; labels?: Record<string, string>; colors?: Record<string, string>; height?: number;
}) {
  return (
    <div>
      {keys.length > 1 && <ChartLegend items={keys.map(k => ({ label: labels[k] ?? k, color: colors[k] ?? ana(6) }))} />}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="date" {...AXIS} interval="preserveStartEnd" minTickGap={24} tickMargin={6} tickFormatter={v => formatDate(v, 'MMM d')} />
          <YAxis {...AXIS} width={44} tickFormatter={v => axisLac(Number(v))} />
          <Tooltip
            cursor={CROSSHAIR}
            {...TIP}
            labelFormatter={label => fmtDate(parseISO(label as string), 'EEE, MMM d, yyyy')}
            formatter={(value: number, name: string) => [pkrLac(value), name]}
          />
          {keys.map(key => (
            <Line {...chartMotion()} key={key} type="monotone" dataKey={key} name={labels[key] ?? key} stroke={colors[key] ?? ana(6)}
              strokeWidth={2} dot={false} activeDot={{ r: 5, fill: colors[key] ?? ana(6), strokeWidth: 0 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
