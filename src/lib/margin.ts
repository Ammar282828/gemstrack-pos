/**
 * What the shop earns on a sale or an order, as a percentage — for the shop's own screens only
 * (owners and staff: the owner, 2026-10-05, "just make sure the customer does not get any of this").
 *
 * The cost (the owner, 2026-10-05): "whatever the weight of the jewellery we're trying to sell is,
 * we basically get that in 24 karat minus 6 ratti". A tola is 96 ratti, so a gram of jewellery
 * costs the 24k rate × (96 − 6) / 96 = 93.75% of it. The 24k rate is the one typed when the order
 * or sale was made (`costRate24k`) — "ask for the 24 karat rate at that point. If given … calculate
 * the percentage. If it is not given, then assume a 10% profit. For all the previous recorded
 * stuff keep the profit as 10 percent." So nothing here reads a stored selling rate: an order or
 * sale without its own typed 24k rate is 10%, as everything before 2026-10-05 is.
 *
 * Per piece: gold with a weight is its metal (weight less stones) at that cost, plus its stone and
 * diamond charges at what they were charged (no margin assumed on them). A piece that can't be
 * costed that way (no weight, not gold) is taken at the 10% the rest of the sale isn't.
 *
 * NEXT_PUBLIC_STORE_COST_RATTI_LESS is the 6 (Taheri, the default); "none" turns it off (Mina, silver),
 * where every figure is the old estimate.
 */

import { STORE_EST_MARGIN } from '@/lib/store-config';

/** Ratti in a tola: 24k is the whole of it. */
export const RATTI_PER_TOLA = 96;

/** How many ratti short of 24k the shop's jewellery costs it; null when this house doesn't cost by gold. */
export const COST_RATTI_LESS: number | null = (() => {
  // Empty is unset (the env generator writes Mina's variables empty for a local Taheri): the default 6.
  const raw = (process.env.NEXT_PUBLIC_STORE_COST_RATTI_LESS || '6').trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 && n < RATTI_PER_TOLA ? n : null;
})();

/** The figure used where there is no 24k rate to cost with: everything recorded before, and anything not gold. */
export const ASSUMED_MARGIN = STORE_EST_MARGIN;

/** One gram of jewellery, to the shop, at this 24k rate. */
export const goldCostPerGram = (rate24k: number, rattiLess = COST_RATTI_LESS ?? 0) =>
  (Number(rate24k) || 0) * (RATTI_PER_TOLA - rattiLess) / RATTI_PER_TOLA;

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** A piece, as any of the screens hold it. Weight, stones and charges are per piece; price is the line's. */
export interface MarginLine {
  metalType?: string;
  karat?: string;
  weightG?: number;
  stoneWeightG?: number;
  quantity?: number;
  /** What the line comes to (all its pieces). */
  price: number;
  stoneCharges?: number;
  diamondCharges?: number;
  /** A gold coin is pure metal, sold near the 24k rate: costed at its own karat, not jewellery's. */
  isCoin?: boolean;
  /** Sold at a fixed price rather than built from the rate. */
  fixedPrice?: boolean;
  /** Diamonds or stones are set in it. */
  setWithStones?: boolean;
}

export interface Margin {
  /** Earned, as a percentage of what the sale is worth. */
  percent: number;
  /** What the sale is worth (pieces less discount) and what it cost, in rupees. */
  revenue: number;
  cost: number;
  profit: number;
  /** True when no 24k rate was given (or this house doesn't cost by gold): the 10% assumption. */
  assumed: boolean;
  /** The share of the pieces' value that was costed from the gold; the rest was taken at 10%. */
  costedShare: number;
}

export function lineCost(l: MarginLine, rate24k: number): { cost: number; costed: boolean } {
  const qty = n(l.quantity) || 1;
  const price = n(l.price);
  const weight = n(l.weightG);
  // A fixed price with diamonds or stones in it: their cost is inside the price and written nowhere, so
  // costing it from the gold alone would read a diamond ring as 90% profit. Taken at 10%, as before it
  // had a weight (2026-10-07: fixed-price pieces can carry their weight). Plain gold at a fixed price
  // is costed from its gold like any other.
  if (COST_RATTI_LESS === null || !(rate24k > 0) || l.metalType !== 'gold' || !(weight > 0) || (l.fixedPrice && l.setWithStones)) {
    return { cost: price * (1 - ASSUMED_MARGIN), costed: false };
  }
  const net = Math.max(0, weight - n(l.stoneWeightG));
  const karat = parseInt(String(l.karat || ''), 10);
  const perGram = l.isCoin && karat > 0 ? n(rate24k) * Math.min(24, karat) / 24 : goldCostPerGram(rate24k);
  return { cost: (net * perGram + n(l.stoneCharges) + n(l.diamondCharges)) * qty, costed: true };
}

/**
 * The margin on a set of pieces worth `revenue` (their total less any discount; an exchange is
 * payment, not a discount, so it stays in). No 24k rate: the assumed 10%.
 */
export function marginOf(lines: MarginLine[], revenue: number, rate24k?: number | null): Margin {
  const worth = n(revenue);
  const r24 = n(rate24k);
  if (COST_RATTI_LESS === null || !(r24 > 0) || !lines.length) {
    const profit = worth * ASSUMED_MARGIN;
    return { percent: ASSUMED_MARGIN * 100, revenue: worth, cost: worth - profit, profit, assumed: true, costedShare: 0 };
  }
  let cost = 0, costedValue = 0, value = 0;
  for (const l of lines) {
    const c = lineCost(l, r24);
    cost += c.cost;
    value += n(l.price);
    if (c.costed) costedValue += n(l.price);
  }
  const profit = worth - cost;
  return {
    percent: worth > 0 ? profit / worth * 100 : 0,
    revenue: worth, cost, profit, assumed: false,
    costedShare: value > 0 ? costedValue / value : 0,
  };
}

// ── The shapes the ERP keeps ────────────────────────────────────────────────

const GOLD_COIN_CATEGORY = 'cat017';

/** Diamonds or stones in a piece, as any of the shapes records it. */
const setWithStones = (it: { hasDiamonds?: boolean; hasStones?: boolean; stoneDetails?: string; diamondDetails?: string; stoneWeightG?: number }) =>
  !!(it.hasDiamonds || it.hasStones || String(it.stoneDetails || '').trim() || String(it.diamondDetails || '').trim() || n(it.stoneWeightG) > 0);

type InvoiceLike = {
  items?: { metalType?: string; karat?: string; metalWeightG?: number; stoneWeightG?: number; quantity?: number; itemTotal?: number; stoneChargesIfAny?: number; diamondChargesIfAny?: number; categoryId?: string;
    isCustomPrice?: boolean; isManualPrice?: boolean; hasDiamonds?: boolean; hasStones?: boolean; stoneDetails?: string; diamondDetails?: string }[];
  subtotal?: number; discountAmount?: number; costRate24k?: number;
};

/** A sale: its pieces, worth their total less the discount. */
export function invoiceMargin(inv: InvoiceLike): Margin {
  const lines: MarginLine[] = (inv.items || []).map(it => ({
    metalType: it.metalType, karat: it.karat, weightG: it.metalWeightG, stoneWeightG: it.stoneWeightG,
    quantity: it.quantity, price: n(it.itemTotal), stoneCharges: it.stoneChargesIfAny, diamondCharges: it.diamondChargesIfAny,
    isCoin: it.categoryId === GOLD_COIN_CATEGORY,
    fixedPrice: !!(it.isCustomPrice || it.isManualPrice), setWithStones: setWithStones(it),
  }));
  const value = n(inv.subtotal) || lines.reduce((s, l) => s + l.price, 0);
  return marginOf(lines, value - n(inv.discountAmount), inv.costRate24k);
}

type OrderLike = {
  items?: { metalType?: string; karat?: string; estimatedWeightG?: number; stoneWeightG?: number; isManualPrice?: boolean; manualPrice?: number; totalEstimate?: number; stoneCharges?: number; diamondCharges?: number; hasDiamonds?: boolean;
    hasStones?: boolean; stoneDetails?: string; diamondDetails?: string }[];
  subtotal?: number; discountAmount?: number; costRate24k?: number;
};

/** An order: each piece at its agreed or estimated price, less the discount. */
export function orderMargin(order: OrderLike, prices?: number[]): Margin {
  const lines: MarginLine[] = (order.items || []).map((it, i) => ({
    metalType: it.metalType, karat: it.karat, weightG: it.estimatedWeightG, stoneWeightG: it.stoneWeightG,
    price: prices ? n(prices[i]) : n(it.isManualPrice ? it.manualPrice : it.totalEstimate),
    // A fixed price holds whatever stones it has; the charges only exist when it is priced by weight.
    stoneCharges: it.isManualPrice ? 0 : it.stoneCharges,
    diamondCharges: it.isManualPrice || !it.hasDiamonds ? 0 : it.diamondCharges,
    fixedPrice: !!it.isManualPrice, setWithStones: setWithStones(it),
  }));
  const value = prices ? lines.reduce((s, l) => s + l.price, 0) : (n(order.subtotal) || lines.reduce((s, l) => s + l.price, 0));
  return marginOf(lines, value - n(order.discountAmount), order.costRate24k);
}

/** "18.2%" — one decimal under 10, none above, the way the counter reads it. */
export const percentLabel = (m: Pick<Margin, 'percent'>) =>
  `${Math.abs(m.percent) < 10 ? m.percent.toFixed(1) : Math.round(m.percent)}%`;
