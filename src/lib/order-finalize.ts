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
      price: Number(f.finalManualPrice) || 0,
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
