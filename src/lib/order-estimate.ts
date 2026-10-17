/**
 * A new order's money as the order form works it out: each piece's price, the subtotal, the
 * discount (never more than the subtotal), and the grand total net of the advance.
 *
 * The server stores an order's totals as sent (lib/writes/create-order.ts), so whatever makes an
 * order must work them out exactly this way. The form (components/order/order-form.tsx) runs this
 * copy, and the iPhone app's contract test (apps/iphone/contract) holds the app's figures to it.
 */

import type { OrderItem, Settings } from '@/lib/store';
import { calculateProductCosts } from '@/lib/pricing';
import { orderMargin } from '@/lib/margin';
import { metalHasKarat } from '@/lib/materials';
import { rupees } from '@/lib/money';

/** A piece as the order form holds it: an OrderItem before its prices are worked out. */
export type OrderFormItem = Omit<OrderItem, 'metalCost' | 'wastageCost' | 'totalEstimate'> &
  Partial<Pick<OrderItem, 'metalCost' | 'wastageCost' | 'totalEstimate'>>;

export interface OrderEstimateInput {
  items: OrderFormItem[];
  discountAmount?: number;
  advancePayment?: number;
  /** The value of what the customer handed over in exchange, taken off like an advance. */
  advanceInExchangeValue?: number;
  costRate24k?: number;
}

const pieceFor = (item: OrderFormItem) => ({
  categoryId: '',
  metalType: item.metalType, karat: item.karat, metalWeightG: item.estimatedWeightG,
  // Silver is sold by weight and making alone: never a wastage.
  wastagePercentage: item.metalType === 'silver' ? 0 : item.wastagePercentage,
  makingCharges: item.makingCharges, hasDiamonds: item.hasDiamonds,
  diamondCharges: item.diamondCharges, stoneCharges: item.stoneCharges, miscCharges: 0,
  stoneWeightG: item.stoneWeightG, hasStones: item.hasStones,
});

/** One piece's price: its fixed price, or its weight at the rates (nothing without a weight). */
export function orderItemPrice(item: OrderFormItem, rates: Partial<Settings>): number {
  if (item.isManualPrice) return rupees(item.manualPrice);
  if (!item.estimatedWeightG || item.estimatedWeightG <= 0) return 0;
  return calculateProductCosts(pieceFor(item) as never, rates).totalPrice;
}

/** The order's subtotal, discount and grand total, with each piece's price (for the margin). */
export function orderEstimate(input: OrderEstimateInput, rates: Partial<Settings>) {
  const prices = (input.items || []).map((item) => orderItemPrice(item, rates));
  const subtotal = prices.reduce((s, p) => s + p, 0);
  // Never more than the subtotal: a discount cannot turn a sale into a debt.
  const discount = Math.max(0, Math.min(subtotal, rupees(input.discountAmount)));
  const totalAdvance = rupees(input.advancePayment) + rupees(input.advanceInExchangeValue);
  const grandTotal = subtotal - discount - totalAdvance;
  const margin = (input.items || []).length
    ? orderMargin({ items: input.items as OrderItem[], discountAmount: discount, costRate24k: Number(input.costRate24k) || 0 }, prices)
    : null;
  return { subtotal, discount, grandTotal, margin, prices };
}

/**
 * What a piece keeps when saved. Karat only means something for a metal sold by karat (gold, and
 * palladium's 18K and 12K, which price differently): the blank piece seeds '21k', and a silver piece
 * saved with it shows a meaningless "21K" everywhere. Plating only applies to silver.
 */
export function stripMeaninglessKarat<T extends { metalType?: string; karat?: unknown }>(item: T): T {
  const o = item as Record<string, unknown>;
  let next: Record<string, unknown> = o;
  if (!metalHasKarat(o.metalType as string | undefined)) {
    const { karat, ...rest } = next;
    void karat;
    next = rest;
  }
  if (o.metalType !== 'silver') {
    const { platingType, platingNote, nickelFree, ...rest } = next;
    void platingType; void platingNote; void nickelFree;
    next = rest;
  }
  return next as T;
}

/** The pieces as saved: each with its metal, wastage and total at the order's rates. */
export function pricedOrderItems(items: OrderFormItem[], rates: Partial<Settings>): OrderItem[] {
  return items.map((item) => {
    if (item.isManualPrice) {
      return stripMeaninglessKarat({ ...item, metalCost: 0, wastageCost: 0, totalEstimate: rupees(item.manualPrice) }) as OrderItem;
    }
    const costs = calculateProductCosts(pieceFor(item) as never, rates);
    return stripMeaninglessKarat({ ...item, metalCost: costs.metalCost, wastageCost: costs.wastageCost, totalEstimate: costs.totalPrice }) as OrderItem;
  });
}
