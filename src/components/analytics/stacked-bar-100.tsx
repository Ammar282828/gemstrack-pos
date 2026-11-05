'use client';

/**
 * One row cut into labelled parts, each as wide as its share. Plain CSS, no recharts, so the Overview and the
 * pages can draw it without loading a chart library. Part of the charts kit (charts.tsx re-exports it).
 */

import React from 'react';
import { lacCrore } from '@/lib/money';
import { cn } from '@/lib/utils';

export interface StackPart { key: string; label: string; value: number; color: string }

export interface StackedBar100Props {
  parts: StackPart[];
  /** How a part's value reads; lac and crore by default. */
  format?: (n: number) => string;
  /** The bar's thickness in px. */
  height?: number;
  /** The key under the bar: dot, label, value and share. Off when the bar sits in a card too small for it. */
  legend?: boolean;
  className?: string;
}

export function StackedBar100({ parts, format = n => lacCrore(n), height = 16, legend = true, className }: StackedBar100Props) {
  const shown = parts.filter(p => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <p className={cn('text-ios-foot text-muted-foreground', className)}>Nothing to split yet.</p>;
  const pct = (v: number) => `${v / total * 100 < 1 ? '<1' : Math.round(v / total * 100)}%`;
  return (
    <div className={cn('min-w-0', className)}>
      {/* A 2px gap between the parts; the ends are rounded, the joins are not. */}
      <div role="img" aria-label={shown.map(p => `${p.label} ${pct(p.value)}`).join(', ')} className="flex gap-[2px]" style={{ height }}>
        {shown.map((p, i) => (
          <div
            key={p.key}
            title={`${p.label}: ${format(p.value)} (${pct(p.value)})`}
            className={cn('min-w-[3px]', i === 0 && 'rounded-l-full', i === shown.length - 1 && 'rounded-r-full')}
            style={{ flexGrow: p.value, flexBasis: 0, backgroundColor: p.color }}
          />
        ))}
      </div>
      {legend && (
        <ul className="mt-3 space-y-1.5">
          {shown.map(p => (
            <li key={p.key} className="flex items-center gap-2 text-ios-sub">
              <span aria-hidden className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.label}</span>
              <span className="font-medium tabular-nums text-foreground">{format(p.value)}</span>
              <span className="w-10 text-right tabular-nums text-muted-foreground">{pct(p.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
