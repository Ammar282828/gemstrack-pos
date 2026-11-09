'use client';

/**
 * Analytics → Sales: "When did the money come in?" The hero is revenue over time (day, week or month) with the period
 * before dashed on the same axis; under it the figures, what the revenue is made of, which weekdays are busy, every
 * month on record, and every day (a row opens that day's invoices and pieces).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Package } from 'lucide-react';
import { AnalyticsPage, ChartCard, Figures, Section, useBooksContext } from '@/components/analytics/kit';
import { TrendArea, WeekdayBars, MonthlyRevenueChart, StackedBar100, StackedBars, ana } from '@/components/analytics/lazy-charts';
import { Segmented } from '@/components/ledger';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { autoBucket, bucketSeries, compareSeries, monthlyRevenue, previousPeriod, type Bucket, type SalesOverTimeData } from '@/lib/analytics/books';
import { revenueSplit, silverGoldRows, SILVER_REVENUE_LABEL, goldRevenueLabel } from '@/lib/analytics/gold-split';
import { GOLD_APART } from '@/lib/analytics/gold-apart';
import { invoiceSaleValue } from '@/lib/analytics/sale-value';
import { pkrLac, lacCrore } from '@/lib/money';
import { formatDate } from '@/lib/safe-date';

const BUCKETS = [
  { value: 'day' as const, label: 'Day' },
  { value: 'week' as const, label: 'Week' },
  { value: 'month' as const, label: 'Month' },
];
const MIX_COLORS = { invoices: ana(1), orders: ana(2), extra: ana(3) };
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** One day's invoices and the pieces on them, as the old Daily Summary dialog showed. */
function DayDialog({ day, onClose }: { day: SalesOverTimeData | null; onClose: () => void }) {
  const { books } = useBooksContext();
  const invoices = day ? books.invoicesByDay[day.date] ?? [] : [];
  const pieces = invoices.flatMap(inv => (inv.items || []).map(item => ({ item, invoiceId: inv.id })));
  return (
    <Dialog open={!!day} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Daily Report for {day && formatDate(day.date, 'MMMM d, yyyy')}</DialogTitle>
          <DialogDescription>A detailed breakdown of all activity for this day.</DialogDescription>
        </DialogHeader>
        {day && (
          <div className="my-4 grid grid-cols-1 gap-4 text-center md:grid-cols-3">
            <div className="rounded-md bg-muted p-3">
              <p className="text-sm text-muted-foreground">Total revenue</p><p className="text-xl font-bold">{pkrLac(day.sales)}</p>
              {GOLD_APART && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {SILVER_REVENUE_LABEL} {pkrLac(day.sales - (day.gold ?? 0))} · {goldRevenueLabel()} {pkrLac(day.gold ?? 0)}
                </p>
              )}
            </div>
            <div className="rounded-md bg-muted p-3"><p className="text-sm text-muted-foreground">Total orders</p><p className="text-xl font-bold">{day.orders}</p></div>
            <div className="rounded-md bg-muted p-3"><p className="text-sm text-muted-foreground">Pieces sold</p><p className="text-xl font-bold">{day.itemsSold}</p></div>
          </div>
        )}
        <div className="mt-4 grid max-h-[60vh] grid-cols-1 gap-6 overflow-y-auto pr-2 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 flex items-center font-semibold"><FileText className="mr-2 h-5 w-5" /> Invoices</h3>
            <ScrollArea className="h-[40vh] rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Invoice ID</TableHead><TableHead>Customer</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>
                  {invoices.map(inv => (
                    <TableRow key={inv.id}><TableCell className="font-medium">{inv.id}</TableCell><TableCell>{inv.customerName}</TableCell><TableCell className="text-right">{lacCrore(invoiceSaleValue(inv))}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
          <div>
            <h3 className="mb-2 flex items-center font-semibold"><Package className="mr-2 h-5 w-5" /> Products Sold</h3>
            <ScrollArea className="h-[40vh] rounded-md border">
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pieces.map(({ item, invoiceId }, i) => (
                    <TableRow key={`${invoiceId}-${item.sku}-${i}`}>
                      <TableCell><div className="font-medium">{item.name}</div><div className="text-xs text-muted-foreground">{item.sku}</div></TableCell>
                      <TableCell className="text-right">{lacCrore(item.itemTotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Sales() {
  const { books, prevBooks, input, range, rangeKey, previousLabel } = useBooksContext();

  // The grain suits the range until the person picks one; a new range starts over.
  const [picked, setPicked] = useState<Bucket | null>(null);
  useEffect(() => setPicked(null), [rangeKey, range?.from?.getTime(), range?.to?.getTime()]);
  const bucket = picked ?? autoBucket(range);
  const [compare, setCompare] = useState(true);
  const [day, setDay] = useState<SalesOverTimeData | null>(null);

  const rows = useMemo(() => {
    const cur = bucketSeries(books.salesOverTime, bucket, range);
    const prev = previousPeriod(range);
    return compareSeries(cur, prev && prevBooks ? bucketSeries(prevBooks.salesOverTime, bucket, prev.range) : null);
  }, [books, prevBooks, bucket, range]);

  const split = revenueSplit(books, pkrLac);
  const metalRows = useMemo(() => (GOLD_APART ? silverGoldRows(books.salesOverTime, bucket, range) : []), [books, bucket, range]);

  const best = rows.reduce<typeof rows[number] | null>((m, r) => (r.value > (m?.value ?? 0) ? r : m), null);
  const canCompare = !!previousLabel && !!prevBooks && prevBooks.totalSales > 0;
  const grain = bucket === 'day' ? 'day' : bucket === 'week' ? 'week' : 'month';
  const trendTakeaway = best
    ? `Best ${grain}: ${best.tip} · ${pkrLac(best.value)}${canCompare && compare && prevBooks ? ` · ${pkrLac(prevBooks.totalSales)} ${previousLabel}` : ''}`
    : 'No sales in this period';

  const mix = books.revenueMix;
  const mixTotal = mix.reduce((s, m) => s + m.value, 0);
  const topMix = [...mix].sort((a, b) => b.value - a.value)[0];

  const weekdays = books.byWeekday;
  const bestWeekday = weekdays.reduce<typeof weekdays[number] | null>((m, d) => (d.avg > (m?.avg ?? 0) ? d : m), null);

  const monthly = useMemo(() => monthlyRevenue(input), [input]);
  const bestMonth = monthly.data.find(m => m.key === monthly.best);

  const days = [...books.salesOverTime].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <>
      <ChartCard
        title="Revenue over time"
        takeaway={trendTakeaway}
      >
        {/* Under the title, not beside it: on a phone the two controls do not fit in the header. */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Segmented<Bucket> label="Group by" value={bucket} options={BUCKETS} onChange={setPicked} />
          {canCompare && (
            <label className="flex cursor-pointer items-center gap-2 text-ios-sub text-muted-foreground">
              <Switch checked={compare} onCheckedChange={setCompare} aria-label={`Compare with ${previousLabel}`} />
              <span>Compare with {previousLabel}</span>
            </label>
          )}
        </div>
        <TrendArea data={rows} height={280} showPrev={canCompare && compare} prevName={previousLabel ? `Compared with ${previousLabel}` : undefined} />
      </ChartCard>

      {split && (
        <ChartCard title="Silver and gold" takeaway={`${split.silverLabel} ${pkrLac(split.silver)} · ${split.goldLabel} ${pkrLac(split.gold)}. ${split.goldCaption}`}>
          <StackedBars data={metalRows} series={[
            { key: 'silver', label: split.silverLabel, color: ana(1) },
            { key: 'gold', label: split.goldLabel, color: ana(3) },
          ]} height={240} />
        </ChartCard>
      )}

      <Figures items={[
        { label: 'Sales', value: books.totalOrders.toLocaleString(), detail: 'Invoices and booked orders' },
        { label: 'Average sale', value: pkrLac(books.averageOrderValue) },
        { label: 'Pieces sold', value: books.totalItemsSold.toLocaleString(), detail: `${books.averageItemsPerOrder.toFixed(1)} per sale` },
        { label: 'Discounts given', value: pkrLac(books.totalDiscounts) },
      ]} />

      <ChartCard title="Revenue mix" takeaway={mixTotal > 0 && topMix ? `${topMix.label} made ${Math.round(topMix.value / mixTotal * 100)}% of ${pkrLac(mixTotal)}` : 'No revenue in this period'}>
        <StackedBar100 height={18} parts={mix.map(m => ({ key: m.key, label: m.label, value: m.value, color: MIX_COLORS[m.key] }))} />
      </ChartCard>

      <ChartCard title="By weekday" takeaway={bestWeekday && bestWeekday.avg > 0 ? `${bestWeekday.label} is busiest: ${pkrLac(bestWeekday.avg)} on an average one` : 'No sales in this period'}>
        <WeekdayBars data={weekdays.map(d => ({ label: d.label, avg: d.avg, revenue: d.revenue, count: d.count, days: d.days }))} height={200} />
      </ChartCard>

      {monthly.data.length > 0 && (
        <ChartCard title="Every month" takeaway={bestMonth ? `Best month ${bestMonth.month} · ${pkrLac(bestMonth.revenue)}; the dashed line is the ${pkrLac(monthly.average)} average` : undefined}>
          <MonthlyRevenueChart data={monthly.data} average={monthly.average} best={monthly.best} height={260} />
        </ChartCard>
      )}

      <Section title="Every day">
        <div className="rounded-card bg-card p-2 sm:p-4">
          {days.length > 0 ? (
            <ScrollArea className="h-[400px] w-full" type="auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Items</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map(d => (
                    <TableRow key={d.date} onClick={() => setDay(d)} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-medium">
                        <span className="hidden sm:inline">{formatDate(d.date, 'EEE, MMM d, yyyy')}</span>
                        <span className="sm:hidden">{formatDate(d.date, 'MMM d')}</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{lacCrore(d.sales)}</TableCell>
                      <TableCell className="text-right">{d.orders}</TableCell>
                      <TableCell className="hidden text-right sm:table-cell">{d.itemsSold}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          ) : (
            <p className="py-10 text-center text-muted-foreground">No daily data available for the selected period.</p>
          )}
        </div>
        <p className="text-ios-foot text-muted-foreground">{plural(days.length, 'day')} with sales. Tap a day to see its invoices and pieces.</p>
      </Section>

      <DayDialog day={day} onClose={() => setDay(null)} />
    </>
  );
}

export function SalesPage() {
  return <AnalyticsPage section="sales"><Sales /></AnalyticsPage>;
}
