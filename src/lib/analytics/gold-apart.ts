/**
 * Gold apart from silver (owner, 2026-11-09, House of Mina: "I want gold revenue to be separate with a (est 10% profit
 * margin) and silver revenue to be separate. So this takes effect in any place revenue is mentioned").
 *
 * The house's metal is silver; it also sells gold pieces, bought in, whose cost is not among its recorded goods. So:
 * - each sale's value is split by its pieces' metal: an invoice by its lines' totals, an order by its pieces' prices, and
 *   the sale's own adjustments (discount, delivery, exchange) fall on each metal in proportion; extra revenue is silver;
 * - silver's profit is what it was before (revenue less the recorded goods: gross profit, lib/analytics/net-profit.ts);
 * - gold's is its revenue at the house's margin (STORE_GOLD_APART_MARGIN, 10%).
 * Pure; on or off by `STORE_GOLD_APART_MARGIN` (null: one revenue, as Taheri keeps).
 */
import { STORE_GOLD_APART_MARGIN } from '@/lib/store-config';

export const GOLD_APART = STORE_GOLD_APART_MARGIN !== null;
export const GOLD_MARGIN_PERCENT = STORE_GOLD_APART_MARGIN ?? 0;

type Line = { metalType?: string | null; value: number };

/** The share of a sale that is gold, by its lines' values (0 with no lines or no value). */
export function goldShare(lines: Line[]): number {
  let gold = 0, all = 0;
  for (const l of lines) {
    const v = Math.max(0, Number(l.value) || 0);
    all += v;
    if (String(l.metalType || '').toLowerCase() === 'gold') gold += v;
  }
  return all > 0 ? gold / all : 0;
}

/** An invoice's gold part of `saleValue`, by its lines' totals. */
export function invoiceGoldPart(inv: { items?: unknown }, saleValue: number): number {
  const items = Array.isArray(inv.items) ? inv.items as { metalType?: string; itemTotal?: number; quantity?: number; unitPrice?: number }[]
    : inv.items && typeof inv.items === 'object' ? Object.values(inv.items as Record<string, { metalType?: string; itemTotal?: number }>) : [];
  return saleValue * goldShare(items.map(i => ({ metalType: i?.metalType, value: Number(i?.itemTotal) || 0 })));
}

/** An order's gold part of `amount`, by its pieces' prices. */
export function orderGoldPart(order: { items?: { metalType?: string; isManualPrice?: boolean; manualPrice?: number; totalEstimate?: number }[] | null }, amount: number): number {
  const pieces = Array.isArray(order.items) ? order.items : [];
  return amount * goldShare(pieces.map(i => ({ metalType: i?.metalType, value: Number(i?.isManualPrice ? i.manualPrice ?? i.totalEstimate : i?.totalEstimate) || 0 })));
}

/** Profit before running costs with gold apart: silver less the goods, and gold at its margin. */
export function profitWithGoldApart(p: { revenue: number; goldRevenue: number; goods: number }, marginPercent = GOLD_MARGIN_PERCENT): number {
  const gold = p.goldRevenue || 0;
  return ((p.revenue || 0) - gold - (p.goods || 0)) + gold * marginPercent / 100;
}
