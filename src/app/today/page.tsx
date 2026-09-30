"use client";

/**
 * Home → Today's cash: what came in today by how it was paid, what went out, and what the drawer
 * should have gained (lib/analytics/todays-cash.ts — the 9 pm report's "Net cash" reads the same).
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAppStore } from '@/lib/store';
import { useAppReady } from '@/hooks/use-store';
import { todaysCash, METHODS } from '@/lib/analytics/todays-cash';
import { PageShell } from '@/components/shared/page-shell';
import { ListSkeleton } from '@/components/shared/skeletons';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const pkr = (n: number) => `PKR ${Math.round(n).toLocaleString('en-PK')}`;
const SOURCE = { invoice: 'Invoice', advance: 'Order advance', repair: 'Repair', extra: 'Extra revenue' } as const;
const hrefOf = (source: keyof typeof SOURCE, ref: string) =>
  source === 'invoice' ? `/invoices/${ref}` : source === 'advance' ? `/orders/${ref}` : source === 'repair' ? `/repairs?id=${ref}` : '/additional-revenue';

export default function TodaysCashPage() {
  const appReady = useAppReady();
  const s = useAppStore(st => ({
    invoices: st.generatedInvoices, orders: st.orders, repairs: st.repairs, extraRevenues: st.additionalRevenues, expenses: st.expenses,
    loadInvoices: st.loadGeneratedInvoices, loadOrders: st.loadOrders, loadRepairs: st.loadRepairs, loadExtra: st.loadAdditionalRevenues, loadExpenses: st.loadExpenses,
    loading: st.isInvoicesLoading || st.isOrdersLoading || st.isRepairsLoading || st.isAdditionalRevenueLoading || st.isExpensesLoading,
  }));
  const { loadInvoices, loadOrders, loadRepairs, loadExtra, loadExpenses } = s;
  useEffect(() => {
    if (!appReady) return;
    loadInvoices(); loadOrders(); loadRepairs(); loadExtra(); loadExpenses();
  }, [appReady, loadInvoices, loadOrders, loadRepairs, loadExtra, loadExpenses]);

  // Re-read once a minute, so a page left open turns over at Karachi's midnight.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);

  const t = useMemo(() => todaysCash({ invoices: s.invoices, orders: s.orders, repairs: s.repairs, extraRevenues: s.extraRevenues, expenses: s.expenses, now }),
    [s.invoices, s.orders, s.repairs, s.extraRevenues, s.expenses, now]);

  if (!appReady || s.loading) return <PageShell><ListSkeleton /></PageShell>;

  const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  return (
    <PageShell width="medium" subtitle={dayLabel}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Tile label="In the drawer" value={pkr(t.netCash)} hint="Cash in, less what was paid out" strong tone={t.netCash < 0 ? 'bad' : 'good'} />
        <Tile label="Money in" value={pkr(t.totalIn)} hint="Every method" />
        <Tile label="Paid out" value={pkr(t.expenses)} hint={`${t.expenseLines.length} expense${t.expenseLines.length === 1 ? '' : 's'}`} />
        <Tile label="Exchange" value={pkr(t.exchange)} hint="Taken in exchange — not cash" />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">By how it was paid</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {METHODS.map(m => (
            <div key={m} className={cn('rounded-lg border px-3 py-2', !t.byMethod[m] && 'opacity-50')}>
              <p className="text-2xs uppercase tracking-wide text-muted-foreground">{m}</p>
              <p className="font-semibold tabular-nums">{pkr(t.byMethod[m])}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Came in</CardTitle></CardHeader>
        <CardContent>
          {t.lines.length === 0 ? <p className="text-sm text-muted-foreground py-2">Nothing yet today.</p> : (
            <ul className="divide-y">
              {t.lines.map((l, i) => (
                <li key={i} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-12 flex-shrink-0 text-xs text-muted-foreground tabular-nums">{time(l.at)}</span>
                  <Link href={hrefOf(l.source, l.ref)} className="min-w-0 flex-1 truncate hover:underline">
                    <span className="text-muted-foreground">{SOURCE[l.source]}</span> · {l.source === 'extra' ? l.ref : <>{l.ref}{l.who ? ` · ${l.who}` : ''}</>}
                  </Link>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{l.method}</span>
                  <span className="w-28 text-right font-medium tabular-nums flex-shrink-0">{pkr(l.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {t.expenseLines.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Paid out</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {t.expenseLines.map((e, i) => (
                <li key={i} className="flex items-center gap-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{e.description} <span className="text-muted-foreground">· {e.category}</span></span>
                  <span className="w-28 text-right font-medium tabular-nums">{pkr(e.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Expenses carry no method, so every one the business paid today counts as leaving the drawer; one a partner paid out of pocket does not.</p>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function Tile({ label, value, hint, strong, tone }: { label: string; value: string; hint: string; strong?: boolean; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border bg-card p-3 min-w-0">
      <p className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('text-lg sm:text-xl font-bold tabular-nums truncate', strong && 'text-primary', tone === 'bad' && 'text-destructive')}>{value}</p>
      <p className="text-2xs text-muted-foreground truncate">{hint}</p>
    </div>
  );
}
