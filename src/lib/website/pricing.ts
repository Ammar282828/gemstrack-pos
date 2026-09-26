/**
 * Quoting a photograph.
 *
 * The site's tagger read a weight off the label burned into each photo, and a
 * metal and a stone off the piece itself. That, the shop's per-category making
 * and wastage, and today's rate are enough to price gold the way the counter
 * does — through the same calculateProductPrice an invoice uses, so a website
 * price and a counter price for the same piece can never disagree.
 *
 * It is also enough to know when NOT to price: no weight, no number. A
 * diamond-set piece is worth far more than its gold, so unless the shop has
 * chosen otherwise it stays an enquiry. Nothing here guesses.
 */

import { calculateProductPrice } from '@/lib/pricing';
import type { KaratValue, MetalType } from '@/lib/materials';
import type { PieceAttrs, Quote, WebsiteCategoryPricing, WebsiteConfig } from './types';
import { isMaisonFolder } from './maisons';

/** The rates a quote is struck at — the same fields Settings carries. */
export interface QuoteRates {
  goldRatePerGram24k: number; goldRatePerGram22k: number; goldRatePerGram21k: number; goldRatePerGram18k: number;
  palladiumRatePerGram: number; palladiumRatePerGram18k?: number; palladiumRatePerGram12k?: number;
  platinumRatePerGram: number; silverRatePerGram: number;
}

/** "Rings & Bands/Rings/Ring 12.webp" → "Rings". The site's collection folder. */
export function collectionOfKey(key: string): string {
  const parts = key.split('/');
  return parts.length >= 3 ? parts[1] : parts[0] || '';
}

export function pricingFor(config: WebsiteConfig, collection: string): WebsiteCategoryPricing {
  return { ...config.defaultPricing, ...(config.categoryPricing[collection] || {}) };
}

const isDiamond = (stone: string) => /^diamond/i.test(stone || '');
const hasColouredStones = (stone: string) => !!stone && stone !== 'None' && !isDiamond(stone);

export function quotePiece(key: string, attrs: PieceAttrs | undefined, config: WebsiteConfig, rates: QuoteRates): Quote {
  const collection = collectionOfKey(key);
  if (!attrs) return { key, collection, priceable: false, reason: 'unknown_piece' };
  if (!config.enabled) return { key, collection, priceable: false, reason: 'not_configured' };
  // A great house's own piece is not gold by the gram: its price is asked for, never quoted.
  if (attrs.house || isMaisonFolder(key.split('/').slice(0, 2).join('/'))) return { key, collection, priceable: false, reason: 'maison_enquire' };

  const weightGrams = typeof attrs.weightGrams === 'number' && attrs.weightGrams > 0 ? attrs.weightGrams : 0;
  if (!weightGrams) return { key, collection, priceable: false, reason: 'no_weight' };

  const diamond = isDiamond(attrs.stone);
  if (diamond && config.diamondPolicy === 'enquire') {
    return { key, collection, priceable: false, reason: 'diamond_enquire' };
  }

  const cat = pricingFor(config, collection);
  const metalType: MetalType = attrs.metal === 'Palladium' ? 'palladium' : 'gold';
  const karat: KaratValue = metalType === 'palladium' ? config.palladiumKarat : cat.karat;
  const makingCharges = round(cat.makingChargesPerGram * weightGrams);
  const stoneCharges = hasColouredStones(attrs.stone) ? cat.stoneChargesDefault : 0;
  const diamondCharges = diamond ? config.diamondChargesDefault : 0;

  // Palladium is priced per karat in Settings but calculateProductPrice takes a
  // single palladium rate; hand it the one for the karat we chose.
  const palladiumRate = (karat === '12k' ? rates.palladiumRatePerGram12k : rates.palladiumRatePerGram18k) || rates.palladiumRatePerGram;
  const effectiveRates = { ...rates, palladiumRatePerGram: palladiumRate };
  const ratePerGram = metalType === 'palladium' ? palladiumRate : goldRateFor(effectiveRates, karat);

  const price = round(calculateProductPrice({
    metalType,
    karat,
    metalWeightG: weightGrams,
    stoneWeightG: 0,
    wastagePercentage: cat.wastagePercentage,
    makingCharges,
    hasDiamonds: diamond,
    diamondCharges,
    stoneCharges,
    miscCharges: 0,
    categoryId: config.posCategoryId,
  }, effectiveRates));

  const metalCost = round(ratePerGram * weightGrams);
  return {
    key, collection, priceable: true, price,
    breakdown: {
      metalType, karat, weightGrams, ratePerGram, metalCost,
      wastagePercentage: cat.wastagePercentage,
      wastageCost: round(metalCost * cat.wastagePercentage / 100),
      makingCharges, stoneCharges, diamondCharges,
    },
  };
}

export function goldRateFor(rates: QuoteRates, karat: KaratValue): number {
  switch (karat) {
    case '24k': return rates.goldRatePerGram24k;
    case '22k': return rates.goldRatePerGram22k;
    case '18k': return rates.goldRatePerGram18k;
    case '12k': return rates.goldRatePerGram18k * (12 / 18);
    default: return rates.goldRatePerGram21k;
  }
}

/** The delivery charge for a bag, after the shop's free-delivery threshold. */
export function deliveryChargeFor(config: WebsiteConfig, subtotal: number): number {
  if (config.freeDeliveryOver && subtotal >= config.freeDeliveryOver) return 0;
  return Math.max(0, round(config.deliveryCharge || 0));
}

const round = (n: number) => Math.round(n);
