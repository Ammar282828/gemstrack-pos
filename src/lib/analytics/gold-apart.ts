/**
 * Gold apart from silver (owner, 2026-11-09, House of Mina: "I want gold revenue to be separate with a (est 10% profit
 * margin) and silver revenue to be separate. So this takes effect in any place revenue is mentioned").
 *
 * The house's metal is silver; it also sells gold pieces, bought in, whose cost is not among its recorded goods. So:
 * - each sale's value is split by its pieces' metal: an invoice by its lines' totals, an order by its pieces' prices, and
 *   the sale's own adjustments (discount, delivery, exchange) fall on each metal in proportion; extra revenue is silver;
 * - gold's profit is shown as an estimate beside its revenue, at the house's margin (STORE_GOLD_APART_MARGIN, 10%);
 * - the overall profit is unchanged: revenue less the expenses (owner, 2026-11-09: "profit over all will still be revenue
 *   less expenses"; lib/analytics/net-profit.ts).
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
