'use client';

/**
 * Analytics → Products: what sold. Opens with the ten best pieces (by revenue or by pieces sold), then the old
 * ProductBreakdown table underneath, unchanged.
 */

import { useState } from 'react';
import { AnalyticsPage, ChartCard, useBooksContext } from '@/components/analytics/kit';
import { HBars } from '@/components/analytics/lazy-charts';
import { ProductBreakdown } from '@/components/analytics/product-breakdown';
import { SectionBoundary } from '@/components/shared/section-boundary';
import { Segmented } from '@/components/ledger';
import { pkrLac, lacCrore } from '@/lib/money';

type Measure = 'revenue' | 'pieces';

function Sections() {
  const { books, range } = useBooksContext();
  const [measure, setMeasure] = useState<Measure>('revenue');
  const byRevenue = measure === 'revenue';
  const rows = (byRevenue ? books.topProductsByRevenue : books.topProductsByQuantity).slice(0, 10);
  const total = byRevenue
    ? books.topProductsByRevenue.reduce((s, p) => s + p.revenue, 0)
    : books.topProductsByQuantity.reduce((s, p) => s + p.quantity, 0);

  // The takeaway names the leader and how much of the whole it was.
  let takeaway = 'No pieces sold in this period.';
  if (rows.length) {
    const top = rows[0];
    const v = byRevenue ? top.revenue : top.quantity;
    const share = total > 0 ? Math.round((v / total) * 100) : 0;
    takeaway = byRevenue
      ? `${top.name} led with ${pkrLac(top.revenue)}, ${share}% of piece revenue.`
      : `${top.name} sold most: ${top.quantity} piece${top.quantity === 1 ? '' : 's'}, ${share}% of all pieces sold.`;
  }

  return (
    <>
      <ChartCard
        title={byRevenue ? 'Top 10 pieces by revenue' : 'Top 10 pieces by pieces sold'}
        takeaway={takeaway}
        action={<Segmented<Measure> label="Rank by" value={measure} onChange={setMeasure}
          options={[{ value: 'revenue', label: 'Revenue' }, { value: 'pieces', label: 'Pieces sold' }]} />}
      >
        {rows.length > 0 && (
          <HBars
            data={rows.map(p => ({ label: p.name, value: byRevenue ? p.revenue : p.quantity }))}
            format={byRevenue ? lacCrore : (n => String(Math.round(n)))}
            tipFormat={byRevenue ? pkrLac : (n => `${Math.round(n)} pieces`)}
            name={byRevenue ? 'Revenue' : 'Pieces sold'}
            labelWidth={132}
          />
        )}
      </ChartCard>
      <SectionBoundary name="Products"><ProductBreakdown range={range} /></SectionBoundary>
    </>
  );
}

export function ProductsPage() {
  return <AnalyticsPage section="products"><Sections /></AnalyticsPage>;
}
