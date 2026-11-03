"use client";

/**
 * Home → Taken today → the histogram per day (owner, 2026-11-03). Bars are money taken per day by Home's own rule
 * (lib/taken-by-day.ts, so they add up to Home's figure), stacked by how it was paid; tap or hover a bar for that
 * day's details: total, split by method, count of each kind, and every entry linking to its record.
 */

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { format, parseISO } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Segmented } from '@/components/ledger/segmented';
import { ChartSkeleton } from '@/components/shared/skeletons';
import { lacCrore } from '@/lib/money';
import {
  METHOD_KEYS, METHOD_LABEL, TAKEN_RANGES, takenByDay, takenRange, type TakenInput, type TakenRange, type TakenKind,
} from '@/lib/taken-by-day';
import { barsOf, METHOD_COLOR, type DayBar } from './taken-bars';
import { formatDate } from '@/lib/safe-date';

const TakenChart = dynamic(() => import('./taken-chart').then(m => m.TakenChart), { ssr: false, loading: () => <ChartSkeleton height={220} title={false} /> });

const KIND_LABEL: Record<TakenKind, [string, string]> = {
  invoice: ['invoice', 'invoices'], order: ['order', 'orders'], repair: ['repair payment', 'repair payments'], extra: ['extra revenue', 'extra revenue'],
};
const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;
const dayLabel = (day: string) => formatDate(day, 'd MMM');

export function TakenByDayDialog({ open, onOpenChange, data }: { open: boolean; onOpenChange: (o: boolean) => void; data: TakenInput }) {
  const [now] = useState(() => new Date());
  const [range, setRange] = useState<TakenRange>('month');
  const [picked, setPicked] = useState<string>('');

  const result = useMemo(() => {
    if (!open) return null;
    const { from, to } = takenRange(range, now);
    return takenByDay(data, from, to);
  }, [open, range, data, now]);

  const today = format(now, 'yyyy-MM-dd');
  const days = result?.days ?? [];
  // The picked day, else today if it is in the range, else the last day.
  const selected = days.find(d => d.day === picked) ?? days.find(d => d.day === today) ?? days[days.length - 1];
  const bars: DayBar[] = useMemo(() => barsOf(days, dayLabel), [days]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Taken, day by day</DialogTitle>
          <DialogDescription>
            Sales taken each day, as Home counts them: invoices, counter orders and extra revenue. The unpaid part of a sale is in.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented label="Range" value={range} onChange={v => { setRange(v); setPicked(''); }} options={TAKEN_RANGES.map(r => ({ value: r.id, label: r.label }))} />
          {result && <p className="text-ios-sub tabular-nums"><span className="text-muted-foreground">Total </span><span className="font-semibold">{pkr(result.total)}</span></p>}
        </div>

        <div className="h-[220px]" aria-label="Money taken per day">
          {result ? <TakenChart bars={bars} selected={selected?.day ?? ''} onSelect={setPicked} /> : <ChartSkeleton height={220} title={false} />}
        </div>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-ios-cap text-muted-foreground">
          {METHOD_KEYS.map(k => result && result.methods[k] !== 0 && (
            <li key={k} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: METHOD_COLOR[k] }} />
              {METHOD_LABEL[k]} <span className="tabular-nums text-foreground">{lacCrore(result.methods[k])}</span>
            </li>
          ))}
        </ul>

        {selected && (
          <section className="space-y-3 rounded-card border border-separator p-4" aria-live="polite">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-ios-headline font-semibold">{formatDate(selected.day, 'EEEE, d MMMM')}</h3>
              <span className="text-ios-title3 font-semibold tabular-nums">{pkr(selected.total)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {METHOD_KEYS.map(k => (
                <div key={k} className="rounded-lg bg-muted/50 p-2">
                  <p className="text-ios-cap text-muted-foreground">{METHOD_LABEL[k]}</p>
                  <p className="text-ios-sub font-semibold tabular-nums">{pkr(selected.methods[k])}</p>
                </div>
              ))}
            </div>
            <p className="text-ios-foot text-muted-foreground">
              {(Object.keys(KIND_LABEL) as TakenKind[]).filter(k => selected.counts[k] > 0).map(k => {
                const n = selected.counts[k];
                return `${n} ${KIND_LABEL[k][n === 1 ? 0 : 1]} (${pkr(selected.amounts[k])})`;
              }).join(' · ') || 'Nothing taken this day.'}
              {selected.coins > 0 && ` · gold coins ${pkr(selected.coins)}, counted apart`}
            </p>
            {selected.entries.length > 0 && (
              <ul className="divide-y divide-separator">
                {selected.entries.map(e => {
                  const body = (
                    <>
                      <span className="w-14 shrink-0 text-ios-cap tabular-nums text-muted-foreground">{e.at.length > 10 ? formatDate(e.at, 'h:mm a').toLowerCase() : ''}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ios-sub font-medium">{[e.customer, e.id].filter(Boolean).join(' · ')}</span>
                        <span className="block truncate text-ios-cap text-muted-foreground">{[e.what, e.who && `by ${e.who}`, e.method].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="shrink-0 text-ios-sub font-semibold tabular-nums">{pkr(e.amount)}</span>
                      {e.href && <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
                    </>
                  );
                  const cls = 'flex min-h-11 items-center gap-3 py-2';
                  return (
                    <li key={`${e.kind}-${e.id}-${e.at}`}>
                      {e.href ? <Link href={e.href} className={`${cls} hover:bg-muted/40`}>{body}</Link> : <div className={cls}>{body}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
