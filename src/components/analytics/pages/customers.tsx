'use client';

/**
 * Analytics → Customers: who bought, and how they found us. New vs returning per bucket, the top ten customers, the
 * acquisition sources (share, trend and the numbers), then the old CustomerBreakdown underneath, unchanged.
 * "New" = the customer's first-ever sale falls in the range; walk-ins are in neither count.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { AnalyticsPage, ChartCard, Figures, Section, useBooksContext } from '@/components/analytics/kit';
import { HBars, StackedBars, StackedBar100, SourceTrendChart, SOURCE_COLORS, ana } from '@/components/analytics/lazy-charts';
import { CustomerBreakdown } from '@/components/analytics/customer-breakdown';
import { SectionBoundary } from '@/components/shared/section-boundary';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { bucketCustomerFlow, autoBucket, SOURCE_LABELS } from '@/lib/analytics/books';
import { pkrLac, lacCrore } from '@/lib/money';

function Sections() {
  const { books, range, withRange } = useBooksContext();

  const flow = useMemo(
    () => bucketCustomerFlow(books.customerDays, autoBucket(range), range),
    [books.customerDays, range],
  );
  const named = books.newCustomers + books.returningCustomers;
  const returnShare = books.revenueFromNew + books.revenueFromReturning > 0
    ? Math.round(books.revenueFromReturning / (books.revenueFromNew + books.revenueFromReturning) * 100)
    : 0;

  const flowTakeaway = named === 0
    ? 'No named customers bought in this period.'
    : `${books.newCustomers} new customer${books.newCustomers === 1 ? '' : 's'} brought ${pkrLac(books.revenueFromNew)}; ${books.returningCustomers} returning brought ${pkrLac(books.revenueFromReturning)}.`;

  const top = books.topCustomers.slice(0, 10);

  const sources = books.sourceBreakdown;
  const sourceTotal = sources.reduce((s, r) => s + r.revenue, 0);
  const lead = [...sources].sort((a, b) => b.revenue - a.revenue)[0];
  const sourceTakeaway = lead && sourceTotal > 0
    ? `${lead.label} brought the most: ${Math.round(lead.revenue / sourceTotal * 100)}% of revenue.`
    : 'No sales with a source in this period.';

  return (
    <>
      <ChartCard title="New and returning customers" takeaway={flowTakeaway}>
        {named > 0 && (
          <StackedBars
            data={flow}
            series={[
              { key: 'newCustomers', label: 'New', color: ana(1) },
              { key: 'returningCustomers', label: 'Returning', color: ana(2) },
            ]}
            height={260}
            valueFormat={{ axis: n => String(Math.round(n)), tip: n => `${Math.round(n)} customer${Math.round(n) === 1 ? '' : 's'}` }}
          />
        )}
      </ChartCard>

      <Figures items={[
        { label: 'Customers', value: String(named), detail: 'named, walk-ins left out' },
        { label: 'New', value: String(books.newCustomers), detail: pkrLac(books.revenueFromNew) },
        { label: 'Returning', value: String(books.returningCustomers), detail: pkrLac(books.revenueFromReturning) },
        { label: 'Revenue from returning', value: `${returnShare}%`, detail: 'of named customers\' sales' },
      ]} />

      <ChartCard
        title="Top 10 customers"
        takeaway={top.length ? `${top[0].customerName} spent most: ${pkrLac(top[0].totalSpent)} in ${top[0].orderCount} sale${top[0].orderCount === 1 ? '' : 's'}.` : 'No customers bought in this period.'}
      >
        {top.length > 0 && (
          <>
            <HBars data={top.map(c => ({ label: c.customerName, value: c.totalSpent }))} format={lacCrore} tipFormat={pkrLac} name="Spent" labelWidth={120} />
            {/* The chart's names are drawing; these open the customer. */}
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-ios-foot">
              {top.filter(c => c.customerId).map(c => (
                <li key={c.key} className="min-w-0">
                  <Link href={`/customers/${c.customerId}`} className="block max-w-[11rem] truncate text-primary hover:underline">{c.customerName} ›</Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </ChartCard>

      <Section title="How customers found us">
        <ChartCard title="Revenue by source" takeaway={sourceTakeaway}>
          {sources.length > 0 && (
            <div className="space-y-5">
              <StackedBar100
                legend={false}
                parts={sources.map(s => ({ key: s.key, label: s.label, value: s.revenue, color: SOURCE_COLORS[s.key] ?? ana(6) }))}
              />
              <div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Sales</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Share</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Avg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sources.map(r => (
                      <TableRow key={r.key}>
                        <TableCell>
                          <div className="flex items-center gap-2 font-medium">
                            <span aria-hidden className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: SOURCE_COLORS[r.key] }} />
                            <span className="truncate">{r.label}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{r.orderCount}</TableCell>
                        <TableCell className="text-right font-semibold">{lacCrore(r.revenue)}</TableCell>
                        <TableCell className="hidden text-right text-muted-foreground sm:table-cell">{sourceTotal > 0 ? (r.revenue / sourceTotal * 100).toFixed(1) : '0.0'}%</TableCell>
                        <TableCell className="hidden text-right text-muted-foreground sm:table-cell">{lacCrore(r.avgOrderValue)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="mt-2 text-ios-foot text-muted-foreground">A sale's source is the one on the bill or order, else the customer's saved one; with neither it is Unclassified.</p>
              </div>
            </div>
          )}
        </ChartCard>
        {books.sourceTrend.length > 1 && (
          <ChartCard title="Source by day" takeaway="Revenue per day, a line for each source.">
            <SourceTrendChart data={books.sourceTrend} keys={books.sourceActiveKeys} labels={SOURCE_LABELS} colors={SOURCE_COLORS} />
          </ChartCard>
        )}
      </Section>

      <SectionBoundary name="Customers"><CustomerBreakdown range={range} /></SectionBoundary>
    </>
  );
}

export function CustomersPage() {
  return <AnalyticsPage section="customers"><Sections /></AnalyticsPage>;
}
