'use client';

/**
 * Analytics → Overview: "How is the shop doing?" in one glance (owner, 2026-11-05: "the main page is very complicated").
 * Four headline figures against the period before, then a picture per question; every picture is a door to the page
 * that answers it in depth. No paragraphs: each card has one computed sentence and a small chart, and a card with
 * nothing to show is left out rather than drawn empty.
 */

import React, { useMemo } from 'react';
import { AnalyticsPage, ChartCard, KpiTile, deltaOf, useBooksContext } from '@/components/analytics/kit';
import {
  TrendArea, Waterfall, HBars, StackedBar100, ana, karatColor, KIND_COLORS, KIND_LABELS,
  type StackPart, type WaterfallStep,
} from '@/components/analytics/lazy-charts';
import { autoBucket, bucketSeries, compareSeries, previousPeriod } from '@/lib/analytics/books';
import { revenueSplit } from '@/lib/analytics/gold-split';
import { RECORDS_GOODS } from '@/lib/analytics/net-profit';
import { STORE_METAL_WORD } from '@/lib/store-config';
import { toTola } from '@/lib/units';
import { pkrLac, lacCrore } from '@/lib/money';
import { formatDate } from '@/lib/safe-date';

const tola = (grams: number) => `${toTola(grams).toLocaleString(undefined, { maximumFractionDigits: 1 })} tola`;
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const percent = (part: number, whole: number) => (whole > 0 ? Math.round(part / whole * 100) : 0);

/** The key under a bar that has no room for StackedBar100's own list: dots in a wrapping row. */
function MiniLegend({ parts, format = lacCrore }: { parts: StackPart[]; format?: (n: number) => string }) {
  const shown = parts.filter(p => p.value > 0);
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {shown.map(p => (
        <li key={p.key} className="flex items-center gap-1.5 text-ios-foot text-muted-foreground">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span>{p.label}</span>
          <span className="font-medium tabular-nums text-foreground">{format(p.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A caption, the bar, its key: one measure of a card that compares parts. */
function LabelledStack({ caption, parts, format }: { caption: string; parts: StackPart[]; format?: (n: number) => string }) {
  if (!parts.some(p => p.value > 0)) return <div><p className="mb-1 text-ios-foot font-medium text-foreground">{caption}</p><p className="text-ios-foot text-muted-foreground">Nothing in this period.</p></div>;
  return (
    <div>
      <p className="mb-1.5 text-ios-foot font-medium text-foreground">{caption}</p>
      <StackedBar100 parts={parts} legend={false} height={14} format={format} />
      <MiniLegend parts={parts} format={format} />
    </div>
  );
}

function Overview() {
  const { books, prevBooks, range, previousLabel } = useBooksContext();

  // Revenue per day, week or month (whichever suits the range), the period before on the same axis.
  const trend = useMemo(() => {
    const bucket = autoBucket(range);
    const cur = bucketSeries(books.salesOverTime, bucket, range);
    const prev = previousPeriod(range);
    const before = prev && prevBooks ? bucketSeries(prevBooks.salesOverTime, bucket, prev.range) : null;
    return { rows: compareSeries(cur, before), spark: cur.map(r => r.sales) };
  }, [books, prevBooks, range]);

  const bestDay = useMemo(() => books.salesOverTime.reduce<typeof books.salesOverTime[number] | null>((m, d) => (d.sales > (m?.sales ?? 0) ? d : m), null), [books]);

  // Gold apart (Mina): the total stays "Revenue", the two parts sit under it, gold with its estimated margin.
  const split = revenueSplit(books, pkrLac);
  const tiles = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile label="Revenue" value={pkrLac(books.totalSales)} href="/analytics/sales"
        delta={deltaOf(books.totalSales, prevBooks?.totalSales)} spark={trend.spark}
        sub={split && (
          <>
            <span className="block">{split.silverLabel} {pkrLac(split.silver)}</span>
            <span className="block">{split.goldLabel} {pkrLac(split.gold)}</span>
            <span className="block">{split.goldCaption}</span>
          </>
        )} />
      <KpiTile label="Net profit" value={pkrLac(books.netProfit)} href="/analytics/profit"
        delta={deltaOf(books.netProfit, prevBooks?.netProfit)} sub={`${books.netMargin.toFixed(0)}% margin`} />
      <KpiTile label="Net cash" value={pkrLac(books.netCashFlow)} href="/analytics/cash"
        delta={deltaOf(books.netCashFlow, prevBooks?.netCashFlow)} sub={`in ${pkrLac(books.cashIn)} · out ${pkrLac(books.cashOut)}`} />
      <KpiTile label="Still to collect" value={pkrLac(books.totalUnpaid)} href="/analytics/cash#receivables" tone="owed" />
    </div>
  );

  // ── Sales over time
  const salesCard = books.salesOverTime.length > 0 && (
    <ChartCard key="sales" title="Sales over time" href="/analytics/sales"
      takeaway={bestDay ? `Best day ${formatDate(bestDay.date, 'EEE d MMM')} · ${pkrLac(bestDay.sales)}` : 'No sales in this period'}>
      <TrendArea data={trend.rows} height={180} showPrev={!!previousLabel} prevName={previousLabel ? `Compared with ${previousLabel}` : undefined} />
      {split && (
        <div className="mt-4">
          <LabelledStack caption="Revenue by metal" parts={[
            { key: 'silver', label: split.silverLabel, value: split.silver, color: ana(1) },
            { key: 'gold', label: split.goldLabel, value: split.gold, color: ana(3) },
          ]} />
          <p className="mt-1 text-ios-foot text-muted-foreground">{split.goldCaption}</p>
        </div>
      )}
    </ChartCard>
  );

  // ── Revenue to profit
  const steps: WaterfallStep[] = [
    { label: RECORDS_GOODS ? 'Goods' : 'Pieces cost', kind: 'change', value: -Math.max(0, books.costOfPieces) },
    { label: RECORDS_GOODS ? 'Gross profit' : 'Profit', kind: 'total', value: books.estProfitAdj },
    { label: 'Running', kind: 'change', value: -books.runningExpenses },
    { label: 'Net profit', kind: 'total', value: books.netProfit },
  ];
  const profitCard = books.totalSales > 0 && (
    <ChartCard key="profit" title="From revenue to profit" href="/analytics/profit"
      takeaway={books.netProfit >= 0
        ? `Kept PKR ${Math.round(books.netMargin)} of every PKR 100`
        : `A loss of ${pkrLac(-books.netProfit)} after running costs`}>
      <Waterfall steps={[{ label: 'Revenue', kind: 'total', value: books.totalSales }, ...steps]} height={180} />
    </ChartCard>
  );

  // ── Money in and out
  const inParts: StackPart[] = [
    { key: 'inv', label: 'Invoice payments', value: books.cashInFromInvoicePayments, color: ana(1) },
    { key: 'adv', label: 'Order advances', value: books.cashInFromOrderAdvances, color: ana(2) },
    { key: 'exc', label: 'Exchange', value: books.cashInFromExchange, color: ana(3) },
    { key: 'ext', label: 'Extra revenue', value: books.cashInFromExtraRevenue, color: ana(4) },
  ];
  const outParts: StackPart[] = [
    { key: 'run', label: KIND_LABELS.running, value: books.cashOutRunning, color: KIND_COLORS.running },
    { key: 'gds', label: KIND_LABELS.goods, value: books.cashOutGoods, color: KIND_COLORS.goods },
    { key: 'drw', label: KIND_LABELS.drawings, value: books.cashOutDrawings, color: KIND_COLORS.drawings },
    { key: 'cr', label: 'Credit paid back', value: books.creditPaidBack, color: ana(4) },
  ];
  const cashCard = (books.cashIn > 0 || books.cashOut > 0) && (
    <ChartCard key="cash" title="Money in and out" href="/analytics/cash"
      takeaway={`${pkrLac(books.cashIn)} in, ${pkrLac(books.cashOut)} out: net ${books.netCashFlow < 0 ? '−' : ''}${pkrLac(Math.abs(books.netCashFlow))}`}>
      <div className="space-y-4">
        <LabelledStack caption="In" parts={inParts} />
        <LabelledStack caption="Out" parts={outParts} />
      </div>
    </ChartCard>
  );

  // ── What sold
  const cats = [...books.salesByCategory].sort((a, b) => b.sales - a.sales).slice(0, 5);
  const catTotal = books.salesByCategory.reduce((s, c) => s + c.sales, 0);
  const categoryCard = cats.length > 0 && catTotal > 0 && (
    <ChartCard key="cats" title="What sold" href="/analytics/categories"
      takeaway={`${cats[0].categoryName} were ${percent(cats[0].sales, catTotal)}% of sales`}>
      <HBars data={cats.map(c => ({ label: c.categoryName, value: c.sales }))} />
    </ChartCard>
  );

  // ── Who bought
  const buyers = books.newCustomers + books.returningCustomers;
  const topSource = [...books.sourceBreakdown].filter(s => s.key !== 'unclassified' && s.revenue > 0).sort((a, b) => b.revenue - a.revenue)[0];
  const customerCard = buyers > 0 && (
    <ChartCard key="customers" title="Who bought" href="/analytics/customers"
      takeaway={books.newCustomers > 0
        ? `${plural(books.newCustomers, 'new customer')} brought ${pkrLac(books.revenueFromNew)}`
        : `${plural(books.returningCustomers, 'returning customer')} brought ${pkrLac(books.revenueFromReturning)}, none new`}>
      <div className="space-y-4">
        <LabelledStack caption="Customers" format={n => String(n)} parts={[
          { key: 'new', label: 'New', value: books.newCustomers, color: ana(1) },
          { key: 'ret', label: 'Returning', value: books.returningCustomers, color: ana(2) },
        ]} />
        <LabelledStack caption="Revenue" parts={[
          { key: 'new', label: 'New', value: books.revenueFromNew, color: ana(1) },
          { key: 'ret', label: 'Returning', value: books.revenueFromReturning, color: ana(2) },
        ]} />
        {topSource && <p className="text-ios-foot text-muted-foreground">Most came through {topSource.label} · {pkrLac(topSource.revenue)}</p>}
      </div>
    </ChartCard>
  );

  // ── Metal sold (hidden when nothing was weighed and no coins)
  const coins = books.coinSummary;
  const topKarat = [...books.metalByKarat].sort((a, b) => b.grams - a.grams)[0];
  const metalCard = (books.metalGrams > 0 || coins.coins > 0) && (
    <ChartCard key="metal" title={`${STORE_METAL_WORD} sold`} href="/analytics/metal"
      takeaway={books.metalGrams > 0
        ? `${tola(books.metalGrams)} left the shop${topKarat ? `, mostly ${topKarat.karat}` : ''}`
        : `${plural(coins.coins, 'coin')} sold, no jewellery weighed`}>
      <div className="space-y-3">
        {books.metalGrams > 0 && (
          <>
            <StackedBar100 legend={false} height={16} format={tola}
              parts={books.metalByKarat.map(k => ({ key: k.karat, label: k.karat, value: k.grams, color: karatColor(k.karat) }))} />
            <MiniLegend format={tola} parts={books.metalByKarat.map(k => ({ key: k.karat, label: k.karat, value: k.grams, color: karatColor(k.karat) }))} />
          </>
        )}
        {coins.coins > 0 && (
          <p className="text-ios-foot text-muted-foreground">
            {STORE_METAL_WORD} coins, apart: {plural(coins.coins, 'coin')} · {tola(coins.grams)} · {pkrLac(coins.revenue)}
          </p>
        )}
      </div>
    </ChartCard>
  );

  // ── Where the money went
  const spend = [...books.expensesByCategory].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const spendCard = books.totalExpenses > 0 && spend.length > 0 && (
    <ChartCard key="spend" title="Where the money went" href="/analytics/spending"
      takeaway={`${pkrLac(books.totalExpenses)} spent, ${percent(spend[0].amount, books.totalExpenses)}% on ${spend[0].category}`}>
      <HBars data={spend.map(e => ({ label: e.category, value: e.amount, color: KIND_COLORS[e.kind], chip: KIND_LABELS[e.kind].toLowerCase() }))} />
    </ChartCard>
  );

  // ── Best pieces
  const pieces = books.topProductsByRevenue.slice(0, 5);
  const piecesCard = pieces.length > 0 && (
    <ChartCard key="pieces" title="Best pieces" href="/analytics/products"
      takeaway={`${pieces[0].name} led with ${pkrLac(pieces[0].revenue)}`}>
      <HBars data={pieces.map(p => ({ label: p.name, value: p.revenue }))} />
    </ChartCard>
  );

  const cards = [salesCard, profitCard, cashCard, categoryCard, customerCard, metalCard, spendCard, piecesCard].filter(Boolean);
  return (
    <>
      {tiles}
      <div className="grid grid-cols-1 gap-[22px] md:grid-cols-2">{cards}</div>
    </>
  );
}

export function OverviewPage() {
  return <AnalyticsPage section="overview"><Overview /></AnalyticsPage>;
}
