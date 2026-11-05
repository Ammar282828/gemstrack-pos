'use client';

/**
 * Cash: "What actually moved?" Money in against money out, month by month, then this period's two sides taken apart.
 * Revenue counts what was earned (open orders and unpaid bills included); cash counts only what physically moved, and
 * the gap between them is who still owes us, listed at the bottom (the Overview's "Still to collect" opens here).
 */

import React, { useMemo } from 'react';
import Link from 'next/link';
import { AnalyticsPage, ChartCard, Figures, Section, useBooksContext } from '@/components/analytics/kit';
import { GroupedBars, StackedBar100, ana } from '@/components/analytics/lazy-charts';
import { monthlySeries } from '@/lib/analytics/books';
import { lacCrore, pkrLac } from '@/lib/money';
import { formatDate } from '@/lib/safe-date';

const signedLac = (n: number) => `${n < 0 ? '−' : '+'}${pkrLac(Math.abs(n))}`;

function CashSections() {
  const { books, input, withRange } = useBooksContext();
  const months = useMemo(() => monthlySeries(input, 12), [input]);
  const rows = months.map(m => ({ label: m.month, cashIn: m.cashIn, cashOut: m.cashOut, net: m.cashIn - m.cashOut }));

  const best = months.reduce<typeof months[number] | null>((b, m) => (m.cashIn - m.cashOut > (b ? b.cashIn - b.cashOut : -Infinity) ? m : b), null);
  const heroTake = best && (best.cashIn > 0 || best.cashOut > 0)
    ? `Most cash kept in the last 12 months: ${best.month}, ${signedLac(best.cashIn - best.cashOut)}.`
    : 'No money moved in the last 12 months.';

  const { cashIn, cashOut, netCashFlow, accrualVsCashGap, receivables, receivablesTotal, creditPaidBack } = books;

  const inParts = [
    { key: 'invoice', label: 'Invoice payments', value: books.cashInFromInvoicePayments, color: ana(1) },
    { key: 'advance', label: 'Order advances', value: books.cashInFromOrderAdvances, color: ana(2) },
    { key: 'exchange', label: 'Exchange', value: books.cashInFromExchange, color: ana(3) },
    { key: 'extra', label: 'Extra revenue', value: books.cashInFromExtraRevenue, color: ana(4) },
  ];
  const outParts = [
    { key: 'running', label: 'Running costs', value: books.cashOutRunning, color: ana(1) },
    { key: 'goods', label: 'Goods', value: books.cashOutGoods, color: ana(2) },
    { key: 'drawings', label: 'Drawings', value: books.cashOutDrawings, color: ana(3) },
    { key: 'credit', label: 'Credit paid back', value: creditPaidBack, color: ana(4) },
  ];

  const gapLine = accrualVsCashGap > 0
    ? `${pkrLac(accrualVsCashGap)} of the revenue is not collected yet: it sits in unpaid invoices and open orders. That gap is revenue (what was earned) less cash in (what moved), gold taken off a bill left out.`
    : 'Everything earned in this period has been collected.';

  const shown = receivables.slice(0, 15);

  return (
    <>
      <ChartCard title="Money in and out" takeaway={heroTake}>
        <GroupedBars
          data={rows}
          series={[{ key: 'cashIn', label: 'In', color: 'hsl(var(--tone-settled))' }, { key: 'cashOut', label: 'Out', color: 'hsl(var(--tone-late))' }]}
          line={{ key: 'net', label: 'Net' }}
          height={320}
        />
      </ChartCard>

      <Figures columns={3} items={[
        { label: 'Cash in', value: cashIn, tint: 'settled' },
        { label: 'Cash out', value: cashOut, tint: cashOut > 0 ? 'late' : undefined },
        { label: 'Net cash', value: signedLac(netCashFlow), detail: netCashFlow >= 0 ? 'Cash grew this period' : 'More went out than came in', tint: netCashFlow >= 0 ? 'settled' : 'late' },
      ]} />

      <div className="grid grid-cols-1 gap-[22px] lg:grid-cols-2">
        <ChartCard title="Where the cash came from" takeaway={cashIn > 0 ? `${pkrLac(cashIn)} came in.` : 'No cash came in during this period.'}>
          {cashIn > 0 ? <StackedBar100 parts={inParts} format={pkrLac} /> : null}
        </ChartCard>
        <ChartCard title="Where the cash went" takeaway={cashOut > 0 ? `${pkrLac(cashOut)} went out.` : 'No cash went out during this period.'}>
          {cashOut > 0 ? <StackedBar100 parts={outParts} format={pkrLac} /> : null}
        </ChartCard>
      </div>

      <p className="px-1 text-ios-sub text-muted-foreground">{gapLine}</p>

      <Section id="receivables" title="Who still owes us">
        {receivables.length === 0 ? (
          <div className="rounded-card bg-card p-4 text-ios-sub text-muted-foreground">Nobody owes anything on this period&apos;s sales.</div>
        ) : (
          <div className="rounded-card bg-card">
            <ul className="divide-y divide-border">
              {shown.map(r => (
                <li key={r.id}>
                  <Link href={`/invoices/${r.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ios-body font-medium text-foreground">{r.customerName}</span>
                      <span className="block text-ios-foot text-muted-foreground">
                        {formatDate(r.date, 'MMM d, yyyy')}{r.coinDue > 0 ? ` · ${lacCrore(r.coinDue)} of it on coins` : ''}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums text-foreground">{lacCrore(r.balanceDue)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-ios-sub">
              <span className="text-muted-foreground">
                {receivables.length > shown.length ? `Largest ${shown.length} of ${receivables.length} unpaid` : `${receivables.length} unpaid`}
              </span>
              <span>Total owed <span className="font-semibold tabular-nums text-foreground">{pkrLac(receivablesTotal)}</span></span>
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

export function CashPage() {
  return <AnalyticsPage section="cash"><CashSections /></AnalyticsPage>;
}
