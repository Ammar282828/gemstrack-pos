'use client';

/**
 * Analytics → Gold / Silver: how much metal left the shop. Weight, not rupees: the rate moves, the grams do not.
 * Shown in tola (how the trade talks) with grams in the tooltip. Gold coins (Taheri) are kept apart at the bottom.
 */

import { useMemo } from 'react';
import { Coins } from 'lucide-react';
import { AnalyticsPage, ChartCard, Figures, Section, useBooksContext } from '@/components/analytics/kit';
import { StackedBars, GroupedBars, karatColor, ana } from '@/components/analytics/lazy-charts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { monthlySeries, karatsOf } from '@/lib/analytics/books';
import { STORE_METAL_WORD } from '@/lib/store-config';
import { toTola, formatWeight, GRAMS_PER_TOLA } from '@/lib/units';
import { pkrLac } from '@/lib/money';

const tola = (g: number, digits = 2) => toTola(g).toLocaleString(undefined, { maximumFractionDigits: digits });
const grams = (g: number) => g.toLocaleString(undefined, { maximumFractionDigits: 2 });

function Sections() {
  const { books, input } = useBooksContext();
  const months = useMemo(() => monthlySeries(input, 12), [input]);
  const karats = useMemo(() => karatsOf(months), [months]);
  const metal = STORE_METAL_WORD;

  // Chart rows in tola; the tooltip turns a tola value back into grams.
  const rows = months.map(m => ({
    label: m.month,
    ...Object.fromEntries(karats.map(k => [k, toTola(m.metalByKarat[k] ?? 0)])),
  }));
  const hasWeight = months.some(m => m.metalGrams > 0);
  const best = months.reduce((b, m) => (m.metalGrams > (b?.metalGrams ?? 0) ? m : b), null as (typeof months)[number] | null);
  const monthsTakeaway = hasWeight && best
    ? `Most ${metal.toLowerCase()} left in ${best.month}: ${tola(best.metalGrams)} tola (${grams(best.metalGrams)} g).`
    : `No ${metal.toLowerCase()} weighed in the last 12 months.`;

  const coin = books.coinSummary;
  const coinRows = months.map(m => ({ label: m.month, coins: m.coinCount }));
  const coinMonths = months.some(m => m.coinCount > 0);

  return (
    <>
      <ChartCard title={`${metal} sold, month by month`} takeaway={monthsTakeaway}>
        {hasWeight && (
          <StackedBars
            data={rows}
            series={karats.map(k => ({ key: k, label: k.toUpperCase(), color: karatColor(k) }))}
            height={300}
            valueFormat={{
              axis: n => `${Math.round(n * 10) / 10}`,
              tip: n => `${tola(n * GRAMS_PER_TOLA)} tola · ${grams(n * GRAMS_PER_TOLA)} g`,
            }}
          />
        )}
        {hasWeight && <p className="mt-1 text-ios-foot text-muted-foreground">Tola; hover for grams. The last 12 months, whatever range is picked.</p>}
      </ChartCard>

      <Figures columns={3} items={[
        { label: 'Tola', value: tola(books.metalGrams, 3), detail: 'in this period' },
        { label: 'Grams', value: grams(books.metalGrams) },
        { label: 'Pieces weighed', value: String(books.metalPieces) },
      ]} />

      {books.metalByKarat.length > 0 && (
        <Section title="By karat">
          <div className="rounded-card bg-card p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-2">Karat</TableHead>
                  <TableHead className="px-2 text-right">Tola</TableHead>
                  <TableHead className="px-2 text-right">Grams</TableHead>
                  <TableHead className="px-2 text-right">Pieces</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {books.metalByKarat.map(k => (
                  <TableRow key={k.karat}>
                    <TableCell className="px-2">
                      <div className="flex items-center gap-2 font-medium">
                        <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: karatColor(k.karat) }} />
                        {k.karat.toUpperCase()}
                      </div>
                    </TableCell>
                    <TableCell className="px-2 text-right font-semibold tabular-nums">{tola(k.grams, 3)}</TableCell>
                    <TableCell className="px-2 text-right tabular-nums text-muted-foreground">{grams(k.grams)}</TableCell>
                    <TableCell className="px-2 text-right tabular-nums text-muted-foreground">{k.pieces}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Section>
      )}

      {books.hasCoins && (
        <Section title="Gold coins">
          {coin.invoices > 0 ? (
            <Figures items={[
              { label: 'Coin revenue', value: pkrLac(coin.revenue), detail: `${coin.invoices} bill${coin.invoices === 1 ? '' : 's'} in this period` },
              { label: 'Coins sold', value: String(coin.coins), detail: coin.grams > 0 ? formatWeight(coin.grams) : 'no weight recorded' },
              { label: 'Realised / gram', value: coin.ratePerGram > 0 ? pkrLac(coin.ratePerGram) : '—', detail: 'revenue over grams, all-in' },
              ...(coin.outstanding > 0 ? [{ label: 'Outstanding', value: pkrLac(coin.outstanding), detail: 'still owed on coin bills' }] : []),
            ]} />
          ) : (
            <p className="rounded-card bg-card p-4 text-ios-sub text-muted-foreground">No coin bills in this period.</p>
          )}
          {coinMonths && (
            <ChartCard title="Coins sold, month by month" takeaway="Last 12 months, whatever range is picked.">
              <GroupedBars data={coinRows} series={[{ key: 'coins', label: 'Coins', color: ana(1) }]} height={200}
                format={n => `${Math.round(n)}`} />
            </ChartCard>
          )}
          <p className="flex items-start gap-1.5 text-ios-foot text-muted-foreground">
            <Coins aria-hidden className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            Coins are kept apart from sales and profit: a coin sells at the metal price plus a sliver, so counting it with jewellery would inflate revenue and give it a margin it never earned.
          </p>
        </Section>
      )}
    </>
  );
}

export function MetalPage() {
  return <AnalyticsPage section="metal"><Sections /></AnalyticsPage>;
}
