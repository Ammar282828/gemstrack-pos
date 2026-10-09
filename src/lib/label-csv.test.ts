import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Product, Settings } from '@/lib/store';
import { labelCsvFileName, pieceForCsv, productCsv } from './label-csv';

// csv.ts reads the pricing through the store; the store itself (Firebase, the browser) stays out of a test.
vi.mock('@/lib/store', async () => ({ calculateProductCosts: (await import('@/lib/pricing')).calculateProductCosts }));

// Made-up pieces and rates.
const settings = {
  shopName: 'Demo, Jewellers', goldRatePerGram24k: 30000, goldRatePerGram22k: 27500, goldRatePerGram21k: 26250, goldRatePerGram18k: 22500,
  palladiumRatePerGram: 12000, platinumRatePerGram: 15000, silverRatePerGram: 300,
} as unknown as Settings;

const ring = {
  sku: 'RIN-000101', name: 'Demo "Rose" ring', categoryId: 'cat001', imageUrl: 'https://example.com/r.jpg', metalType: 'gold', karat: '21k',
  metalWeightG: 4.25, hasStones: true, stoneWeightG: 0.4, stoneDetails: 'Two small, pink', hasDiamonds: false, diamondCharges: 0,
  makingCharges: 6000, stoneCharges: 1500, miscCharges: 0, wastagePercentage: 10, isCustomPrice: false,
} as unknown as Product;
const pendant = {
  sku: 'LCK-000007', name: 'Demo pendant', categoryId: 'cat004', metalType: 'gold', karat: '22k', metalWeightG: 2,
  secondaryMetalType: 'platinum', secondaryMetalWeightG: 0.5, hasStones: false, stoneWeightG: 0, hasDiamonds: true, diamondDetails: 'VS',
  diamondCharges: 20000, makingCharges: 3000, stoneCharges: 0, miscCharges: 250, wastagePercentage: 8, isCustomPrice: true, customPrice: 99000,
} as unknown as Product;

/** What the browser's download would hold: lib/csv.ts run with a stand-in for the page. */
async function browserCsv(products: Product[]): Promise<{ text: string; name: string }> {
  let blob: Blob | null = null;
  let name = '';
  const link = { style: {}, click: () => undefined, setAttribute: (k: string, v: string) => { if (k === 'download') name = v; } };
  vi.stubGlobal('document', { createElement: () => link, body: { appendChild: () => undefined, removeChild: () => undefined } });
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { blob = b as Blob; return 'blob:x'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const { generateProductCsv } = await import('./csv');
  generateProductCsv(products, settings);
  // Blob.text() would drop the byte-order mark; the bytes keep it.
  const bytes = await (blob as unknown as Blob).arrayBuffer();
  return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), name };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('productCsv', () => {
  it('is the browser\'s download, byte for byte, without the mark in front', async () => {
    for (const pieces of [[ring], [ring, pendant], [pendant, ring, ring]]) {
      const { text } = await browserCsv(pieces);
      expect(text).toBe(`﻿${productCsv(pieces, settings)}`);
    }
  });

  it('puts two tags to a row, the right one empty for an odd last piece', () => {
    const lines = productCsv([ring], settings).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].split(',')).toHaveLength(50);
    expect(lines[0].startsWith('sku_1,product_name_1,')).toBe(true);
    expect(lines[1]).toContain('"Demo ""Rose"" ring"');
    expect(lines[1]).toContain('"Demo, Jewellers"');
    expect(lines[1].endsWith(',RIN-000101' + ','.repeat(25))).toBe(true);
  });

  it('names the file as the browser does', async () => {
    const { name } = await browserCsv([ring]);
    expect(name).toMatch(/^gemstrack_double_tag_export_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
    expect(labelCsvFileName(new Date('2026-10-09T08:30:05.000Z'))).toBe('gemstrack_double_tag_export_2026-10-09-08-30-05.csv');
  });
});

describe('pieceForCsv', () => {
  it('takes the SKU from the document id and reads figures kept as text', () => {
    const p = pieceForCsv('RIN-000102', { name: 'Old import', categoryId: 'cat001', metalType: 'gold', metalWeightG: '3.5', makingCharges: '1,000' });
    expect(p.sku).toBe('RIN-000102');
    expect(p.metalWeightG).toBe(3.5);
    // Not a number at all: 0, so the file is still made.
    expect(p.makingCharges).toBe(0);
    expect(p.customPrice).toBeUndefined();
    expect(() => productCsv([p], settings)).not.toThrow();
  });
});
