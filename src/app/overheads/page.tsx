'use client';

/**
 * What each month has to cover before anything is profit, and whether it did.
 *
 * The sheet is a benchmark, not a ledger. Nothing on it is written to the
 * expenses collection, counted against profit, or entered in the hisaab — the
 * real payments are recorded separately as they go out. This page answers
 * "how much do we have to sell to stand still", then keeps score month by month
 * from the September the benchmark starts.
 */

import React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  Target, Plus, Trash2, Save, RotateCcw, TrendingUp, TrendingDown, CalendarDays,
  Loader2, Check, Minus,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { AmountInput } from '@/components/ui/amount-input';
import { ListSkeleton } from '@/components/shared/skeletons';
import { PageBack } from '@/components/shared/page-back';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  DEFAULT_OVERHEADS, BENCHMARK_START, overheadTotal, overheadProgress, newOverheadId,
  monthKey, monthLabel, planForMonth, revenueByMonth, monthlyRows, benchmarkSummary,
  type OverheadItem, type OverheadPlan,
} from '@/lib/overheads';

const PKR = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;
const signed = (n: number) => `${n < 0 ? '−' : '+'} ${PKR(Math.abs(n))}`;

export default function OverheadsPage() {
  const appReady = useAppReady();
  const { toast } = useToast();
  const settings = useAppStore(s => s.settings);
  const updateSettings = useAppStore(s => s.updateSettings);
  const invoices = useAppStore(s => s.generatedInvoices);
  const orders = useAppStore(s => s.orders);

  // One clock for the whole screen, so the month boundary and the days-left
  // figure cannot disagree with each other part-way down.
  const [now] = React.useState(() => new Date());
  const thisMonth = monthKey(now);

  /** Saved plans, falling back to the first-shape field and then the seed. */
  const plans: OverheadPlan[] = React.useMemo(() => {
    if (settings.overheadPlans?.length) return settings.overheadPlans;
    if (settings.monthlyOverheads?.length) {
      return [{ from: BENCHMARK_START, items: settings.monthlyOverheads }];
    }
    return [{ from: BENCHMARK_START, items: DEFAULT_OVERHEADS }];
  }, [settings.overheadPlans, settings.monthlyOverheads]);

  const liveItems = planForMonth(plans, thisMonth) ?? DEFAULT_OVERHEADS;
  const [items, setItems] = React.useState<OverheadItem[]>(liveItems);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Adopt what arrives from Firestore, but never over the top of an edit in
  // progress — settings stream in live and would wipe the row being typed.
  React.useEffect(() => {
    if (!dirty) setItems(liveItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(liveItems), dirty]);

  const edit = (id: string, patch: Partial<OverheadItem>) => {
    setDirty(true);
    setItems(list => list.map(i => (i.id === id ? { ...i, ...patch } : i)));
  };
  const remove = (id: string) => {
    setDirty(true);
    setItems(list => list.filter(i => i.id !== id));
  };
  const add = () => {
    setDirty(true);
    setItems(list => [...list, { id: newOverheadId(list), label: '', amount: 0 }]);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Blank rows are dropped: an unnamed zero is someone having second
      // thoughts about adding a line, not a line.
      const clean = items
        .map(i => ({ ...i, label: i.label.trim(), amount: Number(i.amount) || 0 }))
        .filter(i => i.label || i.amount > 0);

      // A change takes effect from THIS month forward. Months already scored
      // keep the plan they were scored against, so a raise today cannot turn
      // last month from met into missed.
      const others = plans.filter(p => p.from !== thisMonth);
      const from = thisMonth < BENCHMARK_START ? BENCHMARK_START : thisMonth;
      const next = [...others.filter(p => p.from !== from), { from, items: clean }]
        .sort((a, b) => a.from.localeCompare(b.from));

      await updateSettings({ overheadPlans: next });
      setItems(clean);
      setDirty(false);
      toast({
        title: 'Benchmark saved',
        description: `${PKR(overheadTotal(clean))} a month, from ${monthLabel(from)}.`,
      });
    } catch (e) {
      toast({
        title: 'Could not save',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const revenue = React.useMemo(() => revenueByMonth(invoices || [], orders || []), [invoices, orders]);
  const rows = React.useMemo(() => monthlyRows(plans, revenue, now), [plans, revenue, now]);
  const summary = React.useMemo(() => benchmarkSummary(rows), [rows]);

  const current = rows.find(r => r.inProgress);
  // Preview against what is on screen, not what is saved, so editing a row
  // moves the bar with it.
  const target = overheadTotal(items);
  const earned = current?.earned ?? 0;
  const p = overheadProgress(target, earned, now);
  const met = p.shortfall === 0 && target > 0;

  if (!appReady) {
    return (
      <div className="container mx-auto px-4 py-5 md:py-6 max-w-3xl">
        <ListSkeleton />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-5 md:py-6 max-w-3xl space-y-4">
      <PageBack fallback="/" label="Back" />

      <header className="min-w-0">
        <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2.5">
          <Target className="w-7 h-7 flex-shrink-0" />Monthly overheads
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          What {format(now, 'MMMM')} has to cover before anything is profit.
          Scored from {monthLabel(BENCHMARK_START)}.
        </p>
      </header>

      {/* This month, first. */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Needed this month</p>
              <p className="text-2xl sm:text-3xl font-bold text-primary tabular-nums">{PKR(target)}</p>
            </div>
            <div className="text-right min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Revenue so far</p>
              <p className="text-2xl sm:text-3xl font-bold tabular-nums">{PKR(earned)}</p>
            </div>
          </div>

          <Progress value={p.percent} className="h-2" />

          <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
            {met ? (
              <span className="flex items-center gap-1.5 font-medium text-success">
                <TrendingUp className="h-4 w-4" />
                Covered — {PKR(earned - target)} above the benchmark
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="font-semibold text-primary tabular-nums">{PKR(p.shortfall)}</span>
                <span className="text-muted-foreground">still to earn</span>
              </span>
            )}
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              {p.daysLeft} day{p.daysLeft === 1 ? '' : 's'} left
              {!met && <> · {PKR(p.perDayNeeded)}/day</>}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* The record. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Month by month</CardTitle>
          <CardDescription>
            {summary.monthsScored === 0
              ? `Nothing scored yet — ${monthLabel(BENCHMARK_START)} is the first full month.`
              : <>
                  {summary.monthsMet} of {summary.monthsScored} finished month
                  {summary.monthsScored === 1 ? '' : 's'} cleared the benchmark
                  {' · '}average {PKR(summary.averageRevenue)}
                  {' · '}running {signed(summary.cumulativeSurplus)}
                </>}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {rows.map(r => (
            <div
              key={r.month}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-2.5',
                r.inProgress && 'border-primary/40 bg-primary/[0.03]',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full',
                  r.inProgress ? 'bg-muted text-muted-foreground'
                    : r.met ? 'bg-success/15 text-success'
                    : 'bg-destructive/10 text-destructive',
                )}
                aria-hidden
              >
                {r.inProgress ? <Minus className="h-3.5 w-3.5" />
                  : r.met ? <Check className="h-3.5 w-3.5" />
                  : <TrendingDown className="h-3.5 w-3.5" />}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {r.label}
                  {r.inProgress && <span className="text-muted-foreground font-normal"> · so far</span>}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {PKR(r.earned)} of {PKR(r.target)}
                </p>
              </div>

              <span
                className={cn(
                  'text-sm font-semibold tabular-nums whitespace-nowrap',
                  r.inProgress ? 'text-muted-foreground'
                    : r.surplus >= 0 ? 'text-success' : 'text-destructive',
                )}
              >
                {signed(r.surplus)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* The sheet that produces the target. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">The sheet</CardTitle>
          <CardDescription>
            A benchmark, not a ledger. Nothing here is recorded as an expense or counted against
            profit — enter the real payments in{' '}
            <Link href="/expenses" className="underline underline-offset-2">Expenses</Link> as they go out.
            Changes apply from {monthLabel(thisMonth)} onward; months already scored keep the target
            they were scored against.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-2">
              <Input
                value={item.label}
                onChange={e => edit(item.id, { label: e.target.value })}
                placeholder="What is it for"
                aria-label="Overhead name"
                className="flex-1 min-w-0"
              />
              <div className="w-32 sm:w-40 flex-shrink-0">
                <AmountInput
                  value={item.amount}
                  onChange={v => edit(item.id, { amount: Number(v) || 0 })}
                  aria-label={`${item.label || 'Overhead'} amount`}
                />
              </div>
              <Button
                variant="ghost" size="icon"
                className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => remove(item.id)}
                aria-label={`Remove ${item.label || 'row'}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" onClick={add}>
              <Plus className="h-4 w-4 mr-2" />Add a line
            </Button>
            <p className="text-sm">
              <span className="text-muted-foreground">Total </span>
              <span className="font-bold text-primary tabular-nums">{PKR(target)}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      {dirty && (
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => { setItems(liveItems); setDirty(false); }} disabled={saving}>
            <RotateCcw className="h-4 w-4 mr-2" />Discard
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save from {format(now, 'MMMM')}
          </Button>
        </div>
      )}
    </div>
  );
}
