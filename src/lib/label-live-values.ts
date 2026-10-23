/**
 * A piece's values for a Label LIVE tag (lib/label-live.ts): its price at today's rates the way the
 * tag CSV has always worked it out (csv.ts, calculateProductCosts), in whole rupees.
 */

import { calculateProductCosts, type Product, type Settings } from '@/lib/store';
import { categoryTitle } from '@/lib/categories';
import type { CsvFieldKey, LabelValues } from '@/lib/label-live';
import { labelCsvValues } from '@/lib/label-csv';

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-US')}`;
const grams = (n: number | undefined) => (Number.isFinite(n) ? Number(n).toFixed(3) : '');
const cap = (s: string | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

export function labelValuesFor(p: Product, settings: Settings, today = new Date()): LabelValues {
  const costs = calculateProductCosts(p, {
    goldRatePerGram24k: settings.goldRatePerGram24k, goldRatePerGram22k: settings.goldRatePerGram22k,
    goldRatePerGram21k: settings.goldRatePerGram21k, goldRatePerGram18k: settings.goldRatePerGram18k,
    palladiumRatePerGram: settings.palladiumRatePerGram, platinumRatePerGram: settings.platinumRatePerGram,
    silverRatePerGram: settings.silverRatePerGram,
  });
  const price = p.isCustomPrice && p.customPrice ? p.customPrice : costs.totalPrice;
  const karat = p.karat ? String(p.karat) : '';
  return {
    sku: p.sku,
    name: p.name,
    price: rs(price),
    priceNumber: String(Math.round(price)),
    weight: `${grams(p.metalWeightG)} g`,
    weightNumber: grams(p.metalWeightG),
    metal: [cap(p.metalType), karat].filter(Boolean).join(' '),
    karat,
    category: categoryTitle(p.categoryId) ?? p.categoryId ?? '',
    stones: p.stoneDetails ?? '',
    stoneWeight: p.hasStones ? grams(p.stoneWeightG) : '',
    diamonds: p.diamondDetails ?? '',
    size: p.size ?? '',
    plating: p.platingType ?? '',
    shop: settings.shopName ?? '',
    qr: p.sku,
    date: today.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' }),
    // A design built on the tag CSV reads its columns as the file writes them.
    ...Object.fromEntries(Object.entries(labelCsvValues(p, settings)).map(([k, v]) => [`csv:${k}` as CsvFieldKey, v])),
  };
}
