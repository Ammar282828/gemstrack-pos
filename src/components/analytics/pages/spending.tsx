'use client';

/**
 * Spending: "Where did it go?" The expenses by category, each tagged with what kind of money it is (running cost, goods
 * for the pieces, or the owners' drawings), because only the running costs come off profit. Entering an expense is
 * Money → Expenses; this is its analysis.
 */

import React, { useMemo } from 'react';
import Link from 'next/link';
import { AnalyticsPage, ChartCard, Figures, Section, useBooksContext } from '@/components/analytics/kit';
import { HBars, KIND_COLORS, KIND_LABELS, StackedBars } from '@/components/analytics/lazy-charts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { monthlySeries, type ExpenseKind } from '@/lib/analytics/books';
import { lacCrore, pkrLac } from '@/lib/money';
import { formatDate } from '@/lib/safe-date';

const KINDS: ExpenseKind[] = ['running', 'goods', 'drawings'];
const CHIP: Record<ExpenseKind, string> = { running: 'running', goods: 'goods', drawings: 'drawings' };

function SpendingSections() {
  const { books, input } = useBooksContext();
  const months = useMemo(() => monthlySeries(input, 12), [input]);
  const rows = months.map(m => ({ label: m.month, running: m.running, goods: m.goods, drawings: m.drawings }));

  const { totalExpenses, expensesByCategory, expenseKinds, largestExpenses } = books;
  const top = expensesByCategory[0];
  const takeaway = top && totalExpenses > 0
    ? `${top.category} was the biggest at ${pkrLac(top.amount)}, ${Math.round(top.amount / totalExpenses * 100)}% of ${pkrLac(totalExpenses)} spent.`
    : 'No expenses in this period.';

  // Only the kinds this house has to show (a house that records no goods has no Goods line).
  const kinds = KINDS.filter(k => rows.some(r => r[k] > 0) || expenseKinds[k] > 0);
  const monthTake = (() => {
    const m = months.reduce<typeof months[number] | null>((b, x) => (x.running + x.goods + x.drawings > (b ? b.running + b.goods + b.drawings : 0) ? x : b), null);
    return m ? `Most spent in the last 12 months: ${m.month}, ${pkrLac(m.running + m.goods + m.drawings)}.` : 'No expenses in the last 12 months.';
  })();

  return (
    <>
      <ChartCard
        title="Expenses by category"
        takeaway={takeaway}
        action={<Link href="/expenses" className="text-ios-sub font-medium text-primary hover:underline">Open expenses ›</Link>}
      >
        {expensesByCategory.length > 0 ? (
          <HBars
            data={expensesByCategory.map(c => ({ label: c.category, value: c.amount, color: KIND_COLORS[c.kind], chip: CHIP[c.kind] }))}
            labelWidth={120}
            name="Spent"
          />
        ) : <p className="text-ios-sub text-muted-foreground">Nothing spent in this period.</p>}
      </ChartCard>

      <Figures columns={4} items={[
        { label: 'Spent in all', value: totalExpenses },
        ...kinds.map(k => ({ label: KIND_LABELS[k], value: expenseKinds[k], detail: k === 'running' ? 'comes off profit' : k === 'goods' ? 'for the pieces' : 'owners’ share, not a cost' })),
      ]} />

      <ChartCard title="Month by month" takeaway={monthTake}>
        {kinds.length > 0 && rows.some(r => r.running + r.goods + r.drawings > 0)
          ? <StackedBars data={rows} series={kinds.map(k => ({ key: k, label: KIND_LABELS[k], color: KIND_COLORS[k] }))} height={280} />
          : <p className="text-ios-sub text-muted-foreground">Nothing to draw: no expenses in the last 12 months.</p>}
      </ChartCard>

      <Section title="Largest expenses" action={<Link href="/expenses" className="text-ios-sub font-medium text-primary hover:underline">Open expenses ›</Link>}>
        {largestExpenses.length === 0 ? (
          <div className="rounded-card bg-card p-4 text-ios-sub text-muted-foreground">No expenses in this period.</div>
        ) : (
          <div className="rounded-card bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="hidden sm:table-cell">Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {largestExpenses.map(e => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(e.date, 'MMM d')}</TableCell>
                    <TableCell>
                      <span className="block max-w-[11rem] truncate sm:max-w-none">{e.category}</span>
                      <span className="block text-ios-foot text-muted-foreground sm:hidden">{e.description}</span>
                    </TableCell>
                    <TableCell className="hidden max-w-[22rem] truncate text-muted-foreground sm:table-cell">{e.description}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{lacCrore(e.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </>
  );
}

export function SpendingPage() {
  return <AnalyticsPage section="spending"><SpendingSections /></AnalyticsPage>;
}
