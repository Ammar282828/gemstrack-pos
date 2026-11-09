'use client';

/**
 * Profit: "What did we keep?" The waterfall from revenue to net profit is the page; under it the same story month by
 * month, how the estimate is made, and the years. Net profit is profit less the running costs only (lib/analytics/
 * net-profit.ts); where a house records its goods (Mina) the middle step is its Gross profit, not an estimate.
 */

import React, { useMemo } from 'react';
import { AnalyticsPage, ChartCard, Explain, Figures, Section, useBooksContext } from '@/components/analytics/kit';
import { GroupedBars, LineSmall, Waterfall } from '@/components/analytics/lazy-charts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { monthlySeries, yearlySummary } from '@/lib/analytics/books';
import { ASSUMED_MARGIN, COST_RATTI_LESS } from '@/lib/margin';
import { GOLD_APART, GOLD_MARGIN_PERCENT } from '@/lib/analytics/gold-apart';
import { revenueSplit } from '@/lib/analytics/gold-split';
import { RECORDS_GOODS } from '@/lib/analytics/net-profit';
import { STORE_EST_MARGIN } from '@/lib/store-config';
import { lacCrore, pkrLac } from '@/lib/money';
import { cn } from '@/lib/utils';

const PROFIT_WORD = RECORDS_GOODS ? 'Gross profit' : 'Est. profit';
const pct = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;

function ProfitSections() {
  const { books, input, setQuick } = useBooksContext();
  const months = useMemo(() => monthlySeries(input, 12), [input]);
  const years = useMemo(() => yearlySummary(input), [input]);

  const { totalSales: revenue, costOfPieces, estProfitAdj: profit, runningExpenses: running, netProfit: net, netMargin } = books;
  // Gold apart (Mina): gold's revenue beside silver's, with its estimate; the profit itself is revenue less expenses.
  const split = revenueSplit(books, pkrLac);
  const steps = [
    { label: 'Revenue', kind: 'total' as const, value: revenue },
    { label: RECORDS_GOODS ? 'Goods bought' : 'Cost of pieces (est.)', kind: 'change' as const, value: -costOfPieces },
    { label: PROFIT_WORD, kind: 'total' as const, value: profit },
    { label: 'Running costs', kind: 'change' as const, value: -running },
    { label: 'Net profit', kind: 'total' as const, value: net },
  ];
  const takeaway = revenue > 0
    ? net >= 0
      ? `Kept PKR ${Math.round(netMargin * 10) / 10} of every PKR 100: ${pkrLac(net)} net profit on ${pkrLac(revenue)} revenue.`
      : `A loss of ${pkrLac(-net)}: running costs of ${pkrLac(running)} were more than the ${pkrLac(profit)} of ${RECORDS_GOODS ? 'gross' : 'estimated'} profit.`
    : 'No sales in this period.';

  const monthRows = months.map(m => ({ label: m.month, estProfit: m.estProfit, running: m.running, netMargin: m.netMargin }));
  const bestMonth = months.reduce<typeof months[number] | null>((b, m) => (m.net > (b?.net ?? -Infinity) ? m : b), null);
  const monthTake = bestMonth && bestMonth.revenue > 0
    ? `Best net profit of the last 12 months: ${bestMonth.month}, ${pkrLac(bestMonth.net)}.`
    : 'No sales in the last 12 months.';

  const margin = Math.round(STORE_EST_MARGIN * 100);
  const assumed = Math.round(ASSUMED_MARGIN * 100);
  const estPct = revenue > 0 ? Math.round(profit / revenue * 1000) / 10 : 0;

  return (
    <>
      <ChartCard title="From revenue to profit" takeaway={takeaway}>
        <Waterfall steps={steps} height={320} />
      </ChartCard>

      {split && (
        <Figures columns={2} items={[
          { label: split.silverLabel, value: split.silver },
          { label: split.goldLabel, value: split.gold, detail: split.goldCaption },
        ]} />
      )}

      <Figures items={[
        { label: 'Revenue', value: revenue },
        { label: PROFIT_WORD, value: profit, detail: revenue > 0 ? `${pct(estPct)} of revenue` : undefined },
        { label: 'Running costs', value: running },
        { label: 'Net profit', value: net, detail: revenue > 0 ? `${pct(netMargin)} margin` : undefined, tint: revenue > 0 ? (net >= 0 ? 'settled' : 'late') : undefined },
      ]} />

      <ChartCard title="Month by month" takeaway={monthTake}>
        <GroupedBars
          data={monthRows}
          series={[{ key: 'estProfit', label: PROFIT_WORD }, { key: 'running', label: 'Running costs' }]}
          height={280}
        />
        <p className="mb-1 mt-4 text-ios-sub font-medium text-foreground">Net margin</p>
        <LineSmall data={monthRows} yKey="netMargin" name="Net margin" height={140} />
      </ChartCard>

      <Explain title="How profit is estimated">
        {split ? (
          <p>
            Profit is revenue (silver and gold together) less the goods bought in the period, and net profit that less the running
            costs. Gold&apos;s revenue is shown apart, with its profit estimated at {GOLD_MARGIN_PERCENT}% beside it for reference.
          </p>
        ) : RECORDS_GOODS ? (
          <p>
            Gross profit is revenue less the goods bought in the period ({estPct}% of revenue here). Stock bought and not yet sold counts as spent.
            At a flat {margin}% it would be {pkrLac(books.estProfit)}.
          </p>
        ) : COST_RATTI_LESS === null || books.salesCosted === 0 ? (
          <p>Est. profit is revenue × {margin}%, before running costs.</p>
        ) : (
          <p>
            {books.salesCosted} of {books.salesCount} sales are worked out from the 24k rate typed when they were made (the piece costs that rate less {COST_RATTI_LESS} ratti);
            the other {Math.max(0, books.salesCount - books.salesCosted)} are taken at {assumed}%. Extra revenue is also at {assumed}%.
          </p>
        )}
        <p>Net profit is that profit less running costs only: not the owners&apos; drawings, and not the goods the margin already allows for.</p>
      </Explain>

      {years.length > 0 && (
        <Section title="Every year">
          <div className="rounded-card bg-card p-2">
            <p className="px-2 pb-1 pt-1 text-ios-foot text-muted-foreground">All of history, whatever range is chosen. Tap a year to look at it.</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Year</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  {GOLD_APART && <TableHead className="hidden text-right sm:table-cell">Silver</TableHead>}
                  {GOLD_APART && <TableHead className="hidden text-right sm:table-cell">Gold (est. {GOLD_MARGIN_PERCENT}%)</TableHead>}
                  <TableHead className="hidden text-right sm:table-cell">Unpaid</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Running costs</TableHead>
                  <TableHead className="hidden text-right md:table-cell">{PROFIT_WORD}</TableHead>
                  <TableHead className="text-right">Net profit</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {years.map(row => (
                  <TableRow key={row.year} className="cursor-pointer hover:bg-muted/50" onClick={() => setQuick(`year-${row.year}`)}>
                    <TableCell className="font-semibold">{row.year}</TableCell>
                    <TableCell className="text-right">{lacCrore(row.revenue)}</TableCell>
                    {GOLD_APART && <TableCell className="hidden text-right sm:table-cell">{lacCrore(row.revenue - row.goldRevenue)}</TableCell>}
                    {GOLD_APART && <TableCell className="hidden text-right sm:table-cell">{row.goldRevenue > 0 ? lacCrore(row.goldRevenue) : '—'}</TableCell>}
                    <TableCell className="hidden text-right sm:table-cell">{row.unpaid > 0 ? lacCrore(row.unpaid) : '—'}</TableCell>
                    <TableCell className="hidden text-right sm:table-cell">{lacCrore(row.expenses)}</TableCell>
                    <TableCell className="hidden text-right md:table-cell">{lacCrore(row.profit)}</TableCell>
                    <TableCell className={cn('text-right font-semibold', row.netProfit < 0 && 'text-destructive')}>{lacCrore(row.netProfit)}</TableCell>
                    <TableCell className="hidden text-right text-muted-foreground sm:table-cell">{row.revenue > 0 ? pct(row.netMargin) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}
    </>
  );
}

export function ProfitPage() {
  return <AnalyticsPage section="profit"><ProfitSections /></AnalyticsPage>;
}
