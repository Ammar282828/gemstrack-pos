/**
 * The tag printer's CSV (Settings → Labels, "Download CSV"): pieces in pairs, a left and a right tag to a
 * row, for a label app like WEPrint. The text only, so the server can make it for the iPhone app
 * (/api/app/labels) and the browser's `generateProductCsv` (lib/csv.ts) can download the same text: that
 * function is this one plus the download, and label-csv.test.ts holds the two to the same output until
 * csv.ts calls this.
 */

import type { Product, Settings } from '@/lib/store';
import { calculateProductCosts } from '@/lib/pricing';

/** One tag's columns, in order; the file has each twice, `_1` for the left tag and `_2` for the right. */
export const BASE_HEADERS = [
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

  const formatField = (value: string): string =>
    value.includes(',') || value.includes('"') || value.includes('\n') ? `"${value.replace(/"/g, '""')}"` : value;
  const dataOf = (product: Product | undefined): Record<string, string> => {
    const raw = labelCsvValues(product, settings);
    return Object.fromEntries(BASE_HEADERS.map((h) => [h, formatField(raw[h])]));
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

export type LabelCsvColumn = typeof BASE_HEADERS[number];

/**
 * One tag's values as the CSV has them, unquoted: what a label design built on this file (House of Mina's
 * "minalabel" in Label LIVE) reads, so lib/label-live.ts fills such a design exactly as an import of the file
 * would. No piece (the right tag of an odd last row): every column empty.
 */
export function labelCsvValues(product: Product | undefined, settings: Settings): Record<LabelCsvColumn, string> {
  if (!product) return Object.fromEntries(BASE_HEADERS.map((h) => [h, ''])) as Record<LabelCsvColumn, string>;
  const costs = calculateProductCosts(product, {
    goldRatePerGram24k: settings.goldRatePerGram24k,
    goldRatePerGram22k: settings.goldRatePerGram22k,
    goldRatePerGram21k: settings.goldRatePerGram21k,
    goldRatePerGram18k: settings.goldRatePerGram18k,
    palladiumRatePerGram: settings.palladiumRatePerGram,
    platinumRatePerGram: settings.platinumRatePerGram,
    silverRatePerGram: settings.silverRatePerGram,
  });
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  return {
    sku: text(product.sku),
    product_name: text(product.name),
    category_id: text(product.categoryId),
    shop_name: text(settings.shopName),
    image_url: text(product.imageUrl),
    total_price_pkr: Math.round(costs.totalPrice).toString(),
    is_custom_price: product.isCustomPrice ? 'TRUE' : 'FALSE',
    custom_price: product.customPrice != null ? String(Math.round(product.customPrice)) : '0',
    metal_type: text(product.metalType),
    metal_weight_g: product.metalWeightG.toFixed(3),
    karat: text(product.karat),
    secondary_metal_type: text(product.secondaryMetalType),
    secondary_metal_weight_g: product.secondaryMetalWeightG?.toFixed(3) || '0',
    secondary_karat: text(product.secondaryMetalKarat),
    has_stones: product.hasStones ? 'TRUE' : 'FALSE',
    stone_weight_g: product.stoneWeightG.toFixed(3),
    has_diamonds: product.hasDiamonds ? 'TRUE' : 'FALSE',
    stone_details: text(product.stoneDetails),
    diamond_details: text(product.diamondDetails),
    making_charges: Math.round(product.makingCharges).toString(),
    diamond_charges: Math.round(product.diamondCharges).toString(),
    stone_charges: Math.round(product.stoneCharges).toString(),
    misc_charges: Math.round(product.miscCharges).toString(),
    wastage_percentage: product.wastagePercentage.toFixed(2),
    qr_content: text(product.sku),
  };
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
