/**
 * What every place that mentions revenue shows when gold is apart from silver (owner, 2026-11-09, House of Mina; see
 * lib/analytics/gold-apart.ts): "Silver revenue" and "Gold revenue (est. 10% margin)", the gold figure always carrying
 * its estimated margin. Pure; `on` defaults to the house's flag, so Taheri (off) gets null and nothing changes.
 */
import { GOLD_APART, GOLD_MARGIN_PERCENT } from '@/lib/analytics/gold-apart';
import { bucketSeries, type Bucket, type BucketRow, type RangeLike, type SalesOverTimeData } from '@/lib/analytics/books';

export const SILVER_REVENUE_LABEL = 'Silver revenue';

/** "Gold revenue (est. 10% margin)". */
export function goldRevenueLabel(percent: number = GOLD_MARGIN_PERCENT): string {
  return `Gold revenue (est. ${percent}% margin)`;
}

type Money = (n: number) => string;

export interface RevenueSplit {
  total: number;
  silver: number;
  gold: number;
  /** Gold's profit at its margin; silver's is revenue less goods. */
  goldProfit: number;
  silverProfit: number;
  /** Goods bought against silver (silver revenue less its profit) and gold's estimated cost (gold less its profit). */
  goods: number;
  goldCost: number;
  silverLabel: string;
  goldLabel: string;
  /** "Profit est. at 10%: PKR 4,000" */
  goldCaption: string;
  /** "Silver PKR 6 lac · Gold PKR 4 lac (est. 10% margin)" for a single line of text. */
  line: string;
}

type BooksLike = { totalSales: number; goldRevenue?: number; silverRevenue?: number; goldProfit?: number; silverProfit?: number };

/** The split of a books-shaped figure set; null where gold is not apart. */
export function revenueSplit(b: BooksLike, fmt: Money, on: boolean = GOLD_APART, percent: number = GOLD_MARGIN_PERCENT): RevenueSplit | null {
  if (!on) return null;
  const gold = b.goldRevenue ?? 0;
  const silver = b.silverRevenue ?? (b.totalSales - gold);
  const goldProfit = b.goldProfit ?? gold * percent / 100;
  return {
    total: b.totalSales, silver, gold, goldProfit, silverProfit: b.silverProfit ?? 0,
    goods: Math.max(0, silver - (b.silverProfit ?? 0)), goldCost: Math.max(0, gold - goldProfit),
    silverLabel: SILVER_REVENUE_LABEL, goldLabel: goldRevenueLabel(percent),
    goldCaption: `Profit est. at ${percent}%: ${fmt(goldProfit)}`,
    line: `Silver ${fmt(silver)} · Gold ${fmt(gold)} (est. ${percent}% margin)`,
  };
}

/** Gold per bucket, by the same grain and frame as `bucketSeries` (silver is each row's sales less this). */
export function goldBucketSeries(series: SalesOverTimeData[], bucket: Bucket, range?: RangeLike | null, now?: Date): BucketRow[] {
  return bucketSeries(series.map(r => ({ ...r, sales: r.gold ?? 0 })), bucket, range, now);
}

/** Rows for a stacked chart: silver then gold per bucket (keys `silver`, `gold`). */
export function silverGoldRows(series: SalesOverTimeData[], bucket: Bucket, range?: RangeLike | null, now?: Date): { label: string; tip: string; silver: number; gold: number }[] {
  const all = bucketSeries(series, bucket, range, now);
  const gold = goldBucketSeries(series, bucket, range, now);
  return all.map((r, i) => {
    const g = Math.min(r.sales, gold[i]?.sales ?? 0);
    return { label: r.label, tip: r.tip, silver: Math.max(0, r.sales - g), gold: g };
  });
}
