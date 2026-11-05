'use client';

/**
 * Analytics → Categories: which kinds of piece. Opens with every category's revenue as bars tagged with its share,
 * then the old CategoryBreakdown underneath, unchanged.
 */

import { AnalyticsPage, ChartCard, useBooksContext } from '@/components/analytics/kit';
import { HBars } from '@/components/analytics/lazy-charts';
import { CategoryBreakdown } from '@/components/analytics/category-breakdown';
import { SectionBoundary } from '@/components/shared/section-boundary';
import { pkrLac, lacCrore } from '@/lib/money';

function Sections() {
  const { books, range } = useBooksContext();
  const rows = [...books.salesByCategory].filter(c => c.sales > 0).sort((a, b) => b.sales - a.sales);
  const total = rows.reduce((s, c) => s + c.sales, 0);
  const pct = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);

  const takeaway = rows.length
    ? `${rows[0].categoryName} were ${pct(rows[0].sales)}% of category sales (${pkrLac(rows[0].sales)} of ${pkrLac(total)}).`
    : 'No sales in this period.';

  return (
    <>
      <ChartCard title="Revenue by category" takeaway={takeaway}>
        {rows.length > 0 && (
          <HBars
            data={rows.map(c => ({ label: c.categoryName, value: c.sales, chip: `${total > 0 && c.sales / total < 0.005 ? '<1' : pct(c.sales)}%` }))}
            format={lacCrore}
            tipFormat={pkrLac}
            name="Revenue"
            labelWidth={96}
          />
        )}
      </ChartCard>
      <SectionBoundary name="Categories"><CategoryBreakdown range={range} /></SectionBoundary>
    </>
  );
}

export function CategoriesPage() {
  return <AnalyticsPage section="categories"><Sections /></AnalyticsPage>;
}
