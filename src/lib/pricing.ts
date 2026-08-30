/**
 * What a piece costs, and therefore what it sells for.
 *
 * Lifted out of the store so it can be used off the browser as well as in it.
 * The shop floor's writes run on the server — staff have no database access —
 * and the server cannot import the store without dragging the whole client
 * SDK and zustand along with it. The alternative was a second copy of the
 * pricing, which is the one function in this codebase where two versions
 * quietly disagreeing would be worst.
 *
 * Pure: a product and a rate card in, money out. No Firestore, no state.
 */

import type { MetalType, KaratValue } from './materials';

/** Gold with no karat recorded is priced as 21k — the shop's common case. */
export const DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL: KaratValue = '21k';
/** Coins are sold by metal weight alone, with no making or wastage. */
export const GOLD_COIN_CATEGORY_ID_INTERNAL = 'cat017';

function _getRateForKarat(karat: KaratValue | string | undefined, rates: { goldRatePerGram24k: number; goldRatePerGram22k: number; goldRatePerGram21k: number; goldRatePerGram18k: number }): number {
    const k = String(karat || DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL) as KaratValue;
    switch(k) {
        case '24k': return rates.goldRatePerGram24k;
        case '22k': return rates.goldRatePerGram22k;
        case '21k': return rates.goldRatePerGram21k;
        case '18k': return rates.goldRatePerGram18k;
        default: return 0;
    }
}


function _calculateSingleMetalCost(
    metalType: MetalType,
    karat: KaratValue | string | undefined,
    weightG: number,
    rates: { 
        goldRatePerGram24k: number; goldRatePerGram22k: number; goldRatePerGram21k: number; goldRatePerGram18k: number;
        palladiumRatePerGram: number; platinumRatePerGram: number; silverRatePerGram: number; 
    }
): number {
    let cost = 0;
    const { palladiumRatePerGram, platinumRatePerGram, silverRatePerGram } = rates;
    const validWeightG = Math.max(0, Number(weightG) || 0);

    if (metalType === 'gold') {
        const rate = _getRateForKarat(karat, rates);
        if (rate > 0) {
            cost = validWeightG * rate;
        }
    } else if (metalType === 'palladium' && palladiumRatePerGram > 0) {
        cost = validWeightG * palladiumRatePerGram;
    } else if (metalType === 'platinum' && platinumRatePerGram > 0) {
        cost = validWeightG * platinumRatePerGram;
    } else if (metalType === 'silver' && silverRatePerGram > 0) {
        cost = validWeightG * silverRatePerGram;
    }
    return cost;
}


export function _calculateProductCostsInternal(
  product: {
    categoryId?: string;
    name?: string;
    metalType: MetalType;
    karat?: KaratValue | string;
    metalWeightG: number;
    secondaryMetalType?: MetalType;
    secondaryMetalKarat?: KaratValue;
    secondaryMetalWeightG?: number;
    stoneWeightG: number;
    wastagePercentage: number;
    makingCharges: number;
    hasDiamonds: boolean;
    diamondCharges: number;
    stoneCharges: number;
    miscCharges: number;
    isCustomPrice?: boolean;
    customPrice?: number;
    silverRatePerGram?: number;
  },
  rates: { 
      goldRatePerGram24k: number; goldRatePerGram22k: number; goldRatePerGram21k: number; goldRatePerGram18k: number;
      palladiumRatePerGram: number; platinumRatePerGram: number; silverRatePerGram: number; 
  }
) {
  // If manual price override is active, just return that price.
  if (product.isCustomPrice) {
    return {
      metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0,
      totalPrice: product.customPrice || 0,
    };
  }

  // NEW: Special simplified calculation for Silver
  if (product.metalType === 'silver') {
    // Prioritize the product-specific rate, fall back to the global rate.
    const silverRatePerGram = product.silverRatePerGram || rates.silverRatePerGram || 0;
    
    // For silver, the provided rate is all-inclusive for metal, making, and wastage.
    const allInSilverCost = (Number(product.metalWeightG) || 0) * silverRatePerGram;
    
    const stoneChargesValue = Number(product.stoneCharges) || 0;
    const miscChargesValue = Number(product.miscCharges) || 0;
    const diamondChargesValue = Number(product.diamondCharges) || 0;

    const totalPrice = allInSilverCost + stoneChargesValue + diamondChargesValue + miscChargesValue;

    if (isNaN(totalPrice)) {
      console.error("[GemsTrack Store _calculateProductCostsInternal] CRITICAL: Produced NaN for Silver. Details:", { product, rates });
      return { metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, totalPrice: 0 };
    }

    return {
      metalCost: allInSilverCost, // This represents the (rate * grams) part.
      wastageCost: 0, // Considered bundled into the rate.
      makingCharges: 0, // Considered bundled into the rate.
      diamondCharges: diamondChargesValue,
      stoneCharges: stoneChargesValue,
      miscCharges: miscChargesValue,
      totalPrice: totalPrice,
    };
  }

  // --- Existing logic for Gold, Platinum, etc. ---
  const primaryMetalNetWeightG = Math.max(0, (Number(product.metalWeightG) || 0) - (Number(product.stoneWeightG) || 0));
  if (primaryMetalNetWeightG < 0) {
      console.warn(`[GemsTrack Store _calculateProductCostsInternal] Net primary metal weight is negative for ${product.name}. Clamping to 0.`);
  }

  const primaryMetalCost = _calculateSingleMetalCost(product.metalType, product.karat, primaryMetalNetWeightG, rates);
  
  let secondaryMetalCost = 0;
  if (product.secondaryMetalType && product.secondaryMetalWeightG) {
      secondaryMetalCost = _calculateSingleMetalCost(product.secondaryMetalType, product.secondaryMetalKarat, product.secondaryMetalWeightG, rates);
  }

  const totalMetalCost = primaryMetalCost + secondaryMetalCost;
  
  const isActualGoldCoin = product.categoryId === GOLD_COIN_CATEGORY_ID_INTERNAL && product.metalType === 'gold';
  // Exclude silver from wastage calculation
  const applyWastage = product.metalType === 'gold' || product.metalType === 'platinum' || product.metalType === 'palladium';
  const wastagePercentage = isActualGoldCoin || !applyWastage ? 0 : (Number(product.wastagePercentage) || 0);
  const makingCharges = isActualGoldCoin ? 0 : (Number(product.makingCharges) || 0);
  const hasDiamondsValue = isActualGoldCoin ? false : product.hasDiamonds;
  const diamondChargesValue = hasDiamondsValue ? (Number(product.diamondCharges) || 0) : 0;
  const stoneChargesValue = isActualGoldCoin ? 0 : (Number(product.stoneCharges) || 0);
  const miscChargesValue = isActualGoldCoin ? 0 : (Number(product.miscCharges) || 0);

  const wastageCost = totalMetalCost * (wastagePercentage / 100);
  const validWastageCost = Number(wastageCost) || 0;
  const totalPrice = totalMetalCost + validWastageCost + makingCharges + diamondChargesValue + stoneChargesValue + miscChargesValue;
  
  if (isNaN(totalPrice)) {
    console.error("[GemsTrack Store _calculateProductCostsInternal] CRITICAL: Produced NaN. Details:", { product, rates });
    return { metalCost: 0, wastageCost: 0, makingCharges: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0, totalPrice: 0 };
  }

  return {
    metalCost: totalMetalCost,
    wastageCost: validWastageCost,
    makingCharges: makingCharges,
    diamondCharges: diamondChargesValue,
    stoneCharges: stoneChargesValue,
    miscCharges: miscChargesValue,
    totalPrice: totalPrice,
  };
}

/** Public helper — computes the selling price for a product given current settings rates. */
export function calculateProductPrice(product: {
  metalType: MetalType;
  karat?: KaratValue | string;
  metalWeightG: number;
  secondaryMetalType?: MetalType;
  secondaryMetalKarat?: KaratValue;
  secondaryMetalWeightG?: number;
  stoneWeightG: number;
  wastagePercentage: number;
  makingCharges: number;
  hasDiamonds: boolean;
  diamondCharges: number;
  stoneCharges: number;
  miscCharges: number;
  isCustomPrice?: boolean;
  customPrice?: number;
  categoryId?: string;
  name?: string;
  silverRatePerGram?: number;
}, rates: {
  goldRatePerGram24k: number; goldRatePerGram22k: number; goldRatePerGram21k: number; goldRatePerGram18k: number;
  palladiumRatePerGram: number; platinumRatePerGram: number; silverRatePerGram: number;
}): number {
  return _calculateProductCostsInternal(product, rates).totalPrice;
}
