/**
 * Finalize & invoice, priced: what each piece of an order comes to at the figures typed in the
 * dialog (components/order/order-dialogs.tsx), at the rates the order was booked at. One
 * calculation, used by the dialog as you type and by generateInvoiceFromOrder (store.ts) when it
 * writes the invoice, so what the dialog shows is what the invoice says.
 *
 * The owner, 2026-10-05: "when making a final invoice for the order allow me to change the wastage
 * and making … without having to re-edit it". Wastage was not in the dialog at all: the order's
 * percentage went to the invoice as it was, and a different figure meant editing the invoice after.
 */

import { _calculateProductCostsInternal } from './pricing';
import { rupees } from './money';
import type { KaratValue, MetalType, Order, OrderItem, Settings } from './store';

/** What the dialog sends for one piece. */
export type FinalizedItem = {
  description: string;
  metalType: MetalType;
  karat?: KaratValue;
  finalWeightG: number;
  /** Absent: the order's own percentage. */
  finalWastagePercentage?: number;
  finalMakingCharges: number;
  finalDiamondCharges: number;
  finalStoneCharges: number;
  isManualPrice?: boolean;
  finalManualPrice?: number;
};

export type InvoiceRates = Parameters<typeof _calculateProductCostsInternal>[1] & Record<string, number>;

/** The rates the order was booked at; an order from before they were kept takes today's. */
export function orderInvoiceRates(order: Pick<Order, 'ratesApplied'>, settings: Settings): InvoiceRates {
  return (order.ratesApplied || {
    goldRatePerGram24k: settings.goldRatePerGram24k,
    goldRatePerGram22k: settings.goldRatePerGram22k,
    goldRatePerGram21k: settings.goldRatePerGram21k,
    goldRatePerGram18k: settings.goldRatePerGram18k,
    palladiumRatePerGram: settings.palladiumRatePerGram,
    platinumRatePerGram: settings.platinumRatePerGram,
    silverRatePerGram: settings.silverRatePerGram,
  }) as InvoiceRates;
}

/** The rate card an order or invoice carries: the metals a rate can be typed for. */
export const RATE_FIELDS = [
  'goldRatePerGram18k', 'goldRatePerGram21k', 'goldRatePerGram22k', 'goldRatePerGram24k',
  'palladiumRatePerGram', 'platinumRatePerGram', 'silverRatePerGram',
  // Palladium's own 18k and 12k rates, which price a palladium piece of that karat before the flat one (pricing.ts).
  'palladiumRatePerGram18k', 'palladiumRatePerGram12k',
] as const;
export type RateField = typeof RATE_FIELDS[number];

/**
 * The booked rates with any typed at Finalize laid over them: gold moves daily and an order is delivered
 * weeks after it was booked, so the counter may price it at today's. Only positive figures win; none given
 * is the booked rates exactly.
 */
export function finalizeRates(order: Pick<Order, 'ratesApplied'>, settings: Settings, typed?: Partial<Record<RateField, number>>): InvoiceRates {
  const booked = orderInvoiceRates(order, settings);
  if (!typed) return booked;
  const out: Record<string, number> = { ...booked };
  for (const f of RATE_FIELDS) {
    const n = Number(typed[f]);
    if (Number.isFinite(n) && n > 0) out[f] = n;
  }
  return out as InvoiceRates;
}

export interface RateRow { field: RateField; label: string }

/**
 * The rates an order's pieces are priced at, one box each: gold per karat in use, palladium per karat
 * (its flat rate with no karat), platinum, silver. Only what is in use, as the order form shows them.
 */
export function finalizeRateRows(items: Pick<OrderItem, 'metalType' | 'karat'>[]): RateRow[] {
  const rows: RateRow[] = [];
  const add = (field: RateField, label: string) => { if (!rows.some((r) => r.field === field)) rows.push({ field, label }); };
  const gold = new Set(items.filter((i) => i.metalType === 'gold').map((i) => String(i.karat || '')));
  for (const k of ['24k', '22k', '21k', '18k'] as const) if (gold.has(k)) add(`goldRatePerGram${k}` as RateField, `Gold ${k}`);
  for (const i of items.filter((x) => x.metalType === 'palladium')) {
    const k = String(i.karat || '');
    if (k === '18k') add('palladiumRatePerGram18k', 'Palladium 18k');
    else if (k === '12k') add('palladiumRatePerGram12k', 'Palladium 12k');
    else add('palladiumRatePerGram', 'Palladium');
  }
  if (items.some((i) => i.metalType === 'platinum')) add('platinumRatePerGram', 'Platinum');
  // Silver's rate is all-in: it holds the making and the wastage (pricing.ts), so only the number changes.
  if (items.some((i) => i.metalType === 'silver')) add('silverRatePerGram', 'Silver (all-in)');
  return rows;
}

/** The figure a rate box holds: a palladium karat with no rate of its own is priced at the flat one. */
export function rateShown(rates: Partial<Record<RateField, number>>, field: RateField): number {
  const own = Number(rates[field]) || 0;
  if (own > 0) return own;
  return field === 'palladiumRatePerGram18k' || field === 'palladiumRatePerGram12k' ? Number(rates.palladiumRatePerGram) || 0 : 0;
}

/** Wastage is a percentage of the metal — the weight less the stones (pricing.ts). */
export const netMetalG = (weightG: number, stoneWeightG = 0) => Math.max(0, (Number(weightG) || 0) - (Number(stoneWeightG) || 0));

/** The grams a percentage stands for — what the invoice prints (invoice-item-cell.ts wastageGrams). */
export const wastageGramsFor = (percent: number, weightG: number, stoneWeightG = 0) =>
  netMetalG(weightG, stoneWeightG) * (Number(percent) || 0) / 100;

/** The percentage that many grams is, as the karigar writes it ("6.500 + 0.650"); 0 with no weight yet. */
export function wastagePercentFor(grams: number, weightG: number, stoneWeightG = 0): number {
  const net = netMetalG(weightG, stoneWeightG);
  // Eight places: 2 g on 20.3 g is 9.85221675% and prices exactly 2 g; four places came to 12 paisa short.
  return net > 0 ? Math.round((Number(grams) || 0) / net * 100 * 1e8) / 1e8 : 0;
}

/** Silver's rate per gram already holds its making and wastage (pricing.ts), so neither is asked for. */
export const takesWastageAndMaking = (metalType: MetalType) => metalType !== 'silver';

export interface FinalizedCosts {
  price: number;
  metalCost: number;
  wastageCost: number;
  wastagePercentage: number;
  makingCharges: number;
  diamondCharges: number;
  stoneCharges: number;
}

export function finalizedItemCosts(original: OrderItem, f: FinalizedItem, rates: InvoiceRates): FinalizedCosts {
  if (f.isManualPrice) {
    return {
      price: rupees(f.finalManualPrice),
      metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0,
      wastagePercentage: Number(original.wastagePercentage) || 0,
    };
  }
  const wastagePercentage = Number(f.finalWastagePercentage ?? original.wastagePercentage) || 0;
  const costs = _calculateProductCostsInternal({
    metalType: original.metalType,
    karat: original.karat,
    metalWeightG: Number(f.finalWeightG) || 0,
    stoneWeightG: Number(original.stoneWeightG) || 0,
    wastagePercentage,
    makingCharges: Number(f.finalMakingCharges) || 0,
    // A diamond charge typed here counts even if the order never ticked "Has diamonds" — it was
    // silently dropped before.
    hasDiamonds: !!original.hasDiamonds || (Number(f.finalDiamondCharges) || 0) > 0,
    diamondCharges: Number(f.finalDiamondCharges) || 0,
    stoneCharges: Number(f.finalStoneCharges) || 0,
    miscCharges: 0,
  }, rates);
  return {
    price: costs.totalPrice,
    metalCost: costs.metalCost,
    wastageCost: costs.wastageCost,
    wastagePercentage,
    makingCharges: costs.makingCharges,
    diamondCharges: costs.diamondCharges,
    stoneCharges: costs.stoneCharges,
  };
}
