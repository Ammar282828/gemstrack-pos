/**
 * The tag printer's CSV (Settings → Labels, "Download CSV"): pieces in pairs, a left and a right tag to a
 * row, for a label app like WEPrint. The text only, so the server can make it for the iPhone app
 * (/api/app/labels) and the browser's `generateProductCsv` (lib/csv.ts) can download the same text: that
 * function is this one plus the download, and label-csv.test.ts holds the two to the same output until
 * csv.ts calls this.
 */

import type { Product, Settings } from '@/lib/store';
import { calculateProductCosts } from '@/lib/pricing';

const BASE_HEADERS = [
  // Primary Details
  'sku', 'product_name', 'category_id', 'shop_name', 'image_url',
  // Pricing
  'total_price_pkr', 'is_custom_price', 'custom_price',
  // Primary Metal
  'metal_type', 'metal_weight_g', 'karat',
  // Secondary Metal
  'secondary_metal_type', 'secondary_metal_weight_g', 'secondary_karat',
  // Stones & Diamonds
  'has_stones', 'stone_weight_g', 'has_diamonds', 'stone_details', 'diamond_details',
  // Charges
  'making_charges', 'diamond_charges', 'stone_charges', 'misc_charges', 'wastage_percentage',
  // QR
  'qr_content',
] as const;

/** The file's name as the browser downloads it: `gemstrack_double_tag_export_2026-10-09-08-30-00.csv` (UTC). */
export function labelCsvFileName(now: Date = new Date()): string {
  return `gemstrack_double_tag_export_${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
}

/** The CSV for these pieces at the shop's rates, without the byte-order mark the download puts in front. */
export function productCsv(products: Product[], settings: Settings): string {
  const headers = [...BASE_HEADERS.map((h) => `${h}_1`), ...BASE_HEADERS.map((h) => `${h}_2`)];

  const ratesForCalc = {
    goldRatePerGram24k: settings.goldRatePerGram24k,
    goldRatePerGram22k: settings.goldRatePerGram22k,
    goldRatePerGram21k: settings.goldRatePerGram21k,
    goldRatePerGram18k: settings.goldRatePerGram18k,
    palladiumRatePerGram: settings.palladiumRatePerGram,
    platinumRatePerGram: settings.platinumRatePerGram,
    silverRatePerGram: settings.silverRatePerGram,
  };

  const formatField = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) return `"${str.replace(/"/g, '""')}"`;
    return str;
  };

  const dataOf = (product: Product | undefined): Record<string, string> => {
    if (!product) return Object.fromEntries(BASE_HEADERS.map((h) => [h, '']));
    const costs = calculateProductCosts(product, ratesForCalc);
    return {
      sku: formatField(product.sku),
      product_name: formatField(product.name),
      category_id: formatField(product.categoryId),
      shop_name: formatField(settings.shopName),
      image_url: formatField(product.imageUrl),
      total_price_pkr: costs.totalPrice.toFixed(2),
      is_custom_price: product.isCustomPrice ? 'TRUE' : 'FALSE',
      custom_price: product.customPrice?.toFixed(2) || '0',
      metal_type: formatField(product.metalType),
      metal_weight_g: product.metalWeightG.toFixed(3),
      karat: formatField(product.karat),
      secondary_metal_type: formatField(product.secondaryMetalType),
      secondary_metal_weight_g: product.secondaryMetalWeightG?.toFixed(3) || '0',
      secondary_karat: formatField(product.secondaryMetalKarat),
      has_stones: product.hasStones ? 'TRUE' : 'FALSE',
      stone_weight_g: product.stoneWeightG.toFixed(3),
      has_diamonds: product.hasDiamonds ? 'TRUE' : 'FALSE',
      stone_details: formatField(product.stoneDetails),
      diamond_details: formatField(product.diamondDetails),
      making_charges: product.makingCharges.toFixed(2),
      diamond_charges: product.diamondCharges.toFixed(2),
      stone_charges: product.stoneCharges.toFixed(2),
      misc_charges: product.miscCharges.toFixed(2),
      wastage_percentage: product.wastagePercentage.toFixed(2),
      qr_content: formatField(product.sku),
    };
  };

  const rows: string[] = [];
  // Two pieces to a row; an odd last piece leaves the right tag empty.
  for (let i = 0; i < products.length; i += 2) {
    const left = dataOf(products[i]);
    const right = dataOf(products[i + 1]);
    rows.push([...BASE_HEADERS.map((h) => left[h]), ...BASE_HEADERS.map((h) => right[h])].join(','));
  }
  return [headers.join(','), ...rows].join('\n');
}

/**
 * A piece as Firestore holds it, made safe for the CSV: the SKU from the document's id when the field is
 * missing (an update strips it), and the figures the CSV prints with toFixed as numbers (an old import keeps
 * some as text, and a missing one would stop the whole file).
 */
export function pieceForCsv(sku: string, doc: Record<string, unknown>): Product {
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const opt = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : num(v));
  return {
    ...(doc as unknown as Product),
    sku: typeof doc.sku === 'string' && doc.sku ? doc.sku : sku,
    metalWeightG: num(doc.metalWeightG),
    stoneWeightG: num(doc.stoneWeightG),
    makingCharges: num(doc.makingCharges),
    diamondCharges: num(doc.diamondCharges),
    stoneCharges: num(doc.stoneCharges),
    miscCharges: num(doc.miscCharges),
    wastagePercentage: num(doc.wastagePercentage),
    customPrice: opt(doc.customPrice),
    secondaryMetalWeightG: opt(doc.secondaryMetalWeightG),
  };
}
