'use client';

/**
 * What the month has to cover before anything is profit.
 *
 * The sheet is a benchmark, not a ledger. Nothing on it is written to the
 * expenses collection, counted against profit, or entered in the hisaab — the
 * real payments are recorded separately as they go out. This page only answers
 * "how much do we have to sell this month to stand still", and shows how far
 * along we are.
 */

import React from 'react';
import Link from 'next/link';
import {
  startOfMonth, endOfMonth, isWithinInterval, parseISO, format,
} from 'date-fns';
import {
  Target, Plus, Trash2, Save, RotateCcw, TrendingUp, CalendarDays, Loader2,
} from 'lucide-react';
import { useAppStore, getInvoiceRevenueDate, type Order } from '@/lib/store';
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
  DEFAULT_OVERHEADS, overheadTotal, overheadProgress, newOverheadId, type OverheadItem,
} from '@/lib/overheads';

const PKR = (n: number) => `PKR ${Math.round(n).toLocaleString()}`;

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

  const saved = settings.monthlyOverheads;
  const [items, setItems] = React.useState<OverheadItem[]>(saved?.length ? saved : DEFAULT_OVERHEADS);
  const [saving, setSaving] = React.useState(false);

  // Adopt whatever arrives from Firestore, but never over the top of an edit in
  // progress — settings stream in live and would wipe the row being typed.
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => {
    if (!dirty && saved?.length) setItems(saved);
  }, [saved, dirty]);

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
      // Blank rows are dropped rather than saved: an unnamed zero is someone
      // having second thoughts about adding a line, not a line.
      const clean = items
        .map(i => ({ ...i, label: i.label.trim(), amount: Number(i.amount) || 0 }))
        .filter(i => i.label || i.amount > 0);
      await updateSettings({ monthlyOverheads: clean });
      setItems(clean);
      setDirty(false);
      toast({ title: 'Benchmark saved', description: `${PKR(overheadTotal(clean))} a month.` });
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

  /** Billed this month, by the same rule Analytics uses so the two agree. */
  const earned = React.useMemo(() => {
    const span = { start: startOfMonth(now), end: endOfMonth(now) };
    const ordersById = new Map<string, Pick<Order, 'createdAt'>>(
      (orders || []).map(o => [o.id, o]),
    );
    return (invoices || []).reduce((sum, inv) => {
      if (!inv?.createdAt || inv.status === 'Refunded') return sum;
      try {
        const d = parseISO(getInvoiceRevenueDate(inv, ordersById));
        return isWithinInterval(d, span) ? sum + (inv.grandTotal || 0) : sum;
      } catch {
        return sum;
      }
    }, 0);
  }, [invoices, orders, now]);

  const target = overheadTotal(items);
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
        </p>
      </header>

      {/* The answer first; the sheet that produces it underneath. */}
      <Card>
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Needed this month</p>
              <p className="text-2xl sm:text-3xl font-bold text-primary tabular-nums">{PKR(target)}</p>
            </div>
            <div className="text-right min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Billed so far</p>
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
                <span className="text-muted-foreground">still to bill</span>
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">The sheet</CardTitle>
          <CardDescription>
            A benchmark, not a ledger. Nothing here is recorded as an expense or counted against
            profit — enter the real payments in <Link href="/expenses" className="underline underline-offset-2">Expenses</Link> as
            they go out.
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

      {/* Only when there is something to save, so it never sits there inert. */}
      {dirty && (
        <div className="flex gap-2 justify-end">
          <Button
            variant="ghost"
            onClick={() => { setItems(saved?.length ? saved : DEFAULT_OVERHEADS); setDirty(false); }}
            disabled={saving}
          >
            <RotateCcw className="h-4 w-4 mr-2" />Discard
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save benchmark
          </Button>
        </div>
      )}
    </div>
  );
}
