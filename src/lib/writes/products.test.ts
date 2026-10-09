import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { Product } from '@/lib/store';
import { addProduct, cleanProductForm, nextProductSku, updateProduct, type ProductData } from './products';

// All data made up.
function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
  const apply = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };
  const db: DbPort = {
    async runTransaction(fn) {
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => apply(c, id, d, merge)); },
        update(c, id, d) { writes.push(() => apply(c, id, d, true)); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      return out;
    },
    async queryEquals() { return []; },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
    async add() { return 'x'; },
    async update(c, id, d) { apply(c, id, d, true); },
    batch() {
      const writes: (() => void)[] = [];
      return {
        set(c, id, d, merge) { writes.push(() => apply(c, id, d, merge)); },
        update(c, id, d) { writes.push(() => apply(c, id, d, true)); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
        async commit() { writes.forEach((w) => w()); },
      };
    },
    newId() { return 'n1'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data };
}

/** A piece as the product form sends it for a new gold ring (its defaults, a weight typed). */
const ring: ProductData = {
  name: '', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 4.2,
  hasStones: true, stoneWeightG: 0, wastagePercentage: 10, makingCharges: 3_000,
  hasDiamonds: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0,
  isCustomPrice: false, customPrice: 0, description: '', size: '12',
};

const logger = () => {
  const lines: string[][] = [];
  return { lines, fx: { log: (a: string, t: string, d: string, r?: string) => { lines.push([a, t, d, r ?? '']); } } };
};

describe('the next SKU', () => {
  it('is one past the highest number under the category prefix, as parseInt reads it', () => {
    expect(nextProductSku('cat001', ['RIN-000007', 'RIN-000012', 'TOP-000099', 'RIN-x', 'RING-000500']).sku).toBe('RIN-000013');
    expect(nextProductSku('cat008', []).sku).toBe('CHN-000001');
    // A category with no prefix of its own numbers under XXX, as the store always has.
    expect(nextProductSku('cat020', ['XXX-000004']).sku).toBe('XXX-000005');
  });
});

describe('addProduct', () => {
  it('numbers, names and logs a new piece as the store does', async () => {
    const { db, data } = fakeDb({ products: { 'RIN-000004': { name: 'Old ring' } } });
    const { lines, fx } = logger();
    const p = await addProduct(db, ring, { skus: ['RIN-000004'] }, fx);
    expect(p.sku).toBe('RIN-000005');
    expect(p.name).toBe('Rings - RIN-000005');
    expect(data.products['RIN-000005']).toEqual({ ...ring, name: 'Rings - RIN-000005', sku: 'RIN-000005' });
    expect(lines).toEqual([['product.create', 'Created product: Rings - RIN-000005', 'SKU: RIN-000005', 'RIN-000005']]);
  });

  it('passes over a number already taken instead of writing over it', async () => {
    const { db, data } = fakeDb({ products: { 'RIN-000001': { name: 'Landed a moment ago' }, 'RIN-000002': { name: 'And another' } } });
    const p = await addProduct(db, ring, { skus: [] });
    expect(p.sku).toBe('RIN-000003');
    expect(data.products['RIN-000001']).toEqual({ name: 'Landed a moment ago' });
  });

  it('names a fixed-price piece by its description, and keeps a name typed', async () => {
    const { db } = fakeDb({});
    const fixed = await addProduct(db, { ...ring, isCustomPrice: true, customPrice: 15_000, description: 'Demo silver ring with onyx', name: 'ignored' }, { skus: [] });
    expect(fixed.name).toBe('Demo silver ring with onyx');
    const named = await addProduct(db, { ...ring, name: 'Demo bridal ring' }, { skus: [] });
    expect(named.name).toBe('Demo bridal ring');
  });

  it('prices a gold coin by weight alone, and gives gold with no karat 21k', async () => {
    const { db, data } = fakeDb({});
    const coin = await addProduct(db, { ...ring, categoryId: 'cat017', karat: '24k', hasDiamonds: true, diamondCharges: 9, wastagePercentage: 10, makingCharges: 500, stoneCharges: 4, miscCharges: 3 }, { skus: [] });
    expect(data.products[coin.sku]).toMatchObject({ hasDiamonds: false, diamondCharges: 0, wastagePercentage: 0, makingCharges: 0, stoneCharges: 0, miscCharges: 0, karat: '24k' });
    const bare = await addProduct(db, { ...ring, karat: undefined }, { skus: [] });
    expect(bare.karat).toBe('21k');
    // No diamonds, no diamond charge; undefined is left out of the document.
    const noDiamonds = await addProduct(db, { ...ring, diamondCharges: 7, karat: undefined, metalType: 'silver' }, { skus: [] });
    expect(data.products[noDiamonds.sku].diamondCharges).toBe(0);
    expect('karat' in data.products[noDiamonds.sku]).toBe(false);
  });

  it('refuses a category the shop does not have', async () => {
    const { db } = fakeDb({});
    await expect(addProduct(db, { ...ring, categoryId: 'cat999' }, { skus: [] })).rejects.toThrow(/not found/);
  });
});

describe('updateProduct', () => {
  const held = { ...ring, sku: 'RIN-000005', name: 'Demo ring', imageUrl: 'https://example.com/ring.jpg', qrCodeDataUrl: 'data:image/png;base64,AAAA' } as Product;

  it('merges the fields given and leaves the photo and the QR alone', async () => {
    const { db, data } = fakeDb({ products: { 'RIN-000005': { ...held } } });
    const { lines, fx } = logger();
    await updateProduct(db, 'RIN-000005', { name: 'Demo ring, resized', metalWeightG: 4.5, isCustomPrice: false }, {}, fx);
    expect(data.products['RIN-000005']).toMatchObject({ name: 'Demo ring, resized', metalWeightG: 4.5, imageUrl: held.imageUrl, qrCodeDataUrl: held.qrCodeDataUrl });
    expect(lines).toEqual([['product.update', 'Updated product: Demo ring, resized', 'SKU: RIN-000005', 'RIN-000005']]);
  });

  it('names a blank name from the category and a fixed price from its description', async () => {
    const { db, data } = fakeDb({ products: { 'RIN-000005': { ...held } } });
    await updateProduct(db, 'RIN-000005', { name: '', isCustomPrice: false });
    expect(data.products['RIN-000005'].name).toBe('Rings - RIN-000005');
    await updateProduct(db, 'RIN-000005', { isCustomPrice: true, customPrice: 20_000, description: 'Demo fixed ring' });
    expect(data.products['RIN-000005'].name).toBe('Demo fixed ring');
  });

  it('applies the coin, diamond and karat rules as the store does', async () => {
    const { db, data } = fakeDb({ products: { 'RIN-000005': { ...held, karat: undefined, diamondCharges: 900, hasDiamonds: true } } });
    await updateProduct(db, 'RIN-000005', { name: 'x', hasDiamonds: false, metalType: 'gold' });
    expect(data.products['RIN-000005']).toMatchObject({ diamondCharges: 0, karat: '21k' });
    // A metal that is not gold leaves the old karat on file: undefined is never written (as the store merges).
    await updateProduct(db, 'RIN-000005', { name: 'x', metalType: 'silver', karat: undefined });
    expect(data.products['RIN-000005'].karat).toBe('21k');
    await updateProduct(db, 'RIN-000005', { name: 'x', categoryId: 'cat017', metalType: 'gold', makingCharges: 400, wastagePercentage: 10 });
    expect(data.products['RIN-000005']).toMatchObject({ makingCharges: 0, wastagePercentage: 0, hasDiamonds: false });
  });

  it('refuses a piece that is not in stock', async () => {
    const { db } = fakeDb({ sold_products: { 'RIN-000005': { ...held } } });
    await expect(updateProduct(db, 'RIN-000005', { name: 'x' })).rejects.toThrow(/not found/);
  });
});

describe('cleanProductForm', () => {
  /** The phone's body for a new ring: every field the form edits. */
  const form = {
    name: '', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 4.2, silverRatePerGram: 0,
    secondaryMetalType: '', secondaryMetalWeightG: 0, wastagePercentage: 10, makingCharges: 3_000,
    hasDiamonds: false, hasStones: true, stoneWeightG: 0, diamondCharges: 0, stoneCharges: 0, miscCharges: 0,
    stoneDetails: '', diamondDetails: '', isCustomPrice: false, customPrice: 0, description: '', size: '12',
    platingType: '', platingNote: '', nickelFree: false,
  };

  it('takes the form as the web saves it, a second metal only on a men\'s ring', () => {
    const r = cleanProductForm(form, 'add');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ name: '', karat: '21k', metalWeightG: 4.2 });
    expect(r.data.secondaryMetalType).toBeUndefined();
    const mens = cleanProductForm({ ...form, categoryId: 'cat018', secondaryMetalType: 'gold', secondaryMetalKarat: '18k', secondaryMetalWeightG: 1.5 }, 'add');
    expect(mens.ok && mens.data).toMatchObject({ secondaryMetalType: 'gold', secondaryMetalKarat: '18k', secondaryMetalWeightG: 1.5 });
  });

  it('keeps a karat for gold only, and names a fixed price by its description', () => {
    const silver = cleanProductForm({ ...form, metalType: 'silver', karat: '21k' }, 'add');
    expect(silver.ok && silver.data.karat).toBeUndefined();
    const fixed = cleanProductForm({ ...form, isCustomPrice: true, customPrice: 12_000, description: 'Demo onyx ring', name: 'typed' }, 'add');
    expect(fixed.ok && fixed.data.name).toBe('Demo onyx ring');
  });

  it('checks what the form checks, with its words', () => {
    const err = (body: Record<string, unknown>) => { const r = cleanProductForm({ ...form, ...body }, 'add'); return r.ok ? null : r.error; };
    expect(err({ categoryId: '' })).toBe('Category is required');
    expect(err({ metalWeightG: 0 })).toBe('Metal weight must be a positive number');
    expect(err({ karat: undefined })).toBe('Karat is required for gold items.');
    expect(err({ stoneWeightG: 5 })).toBe('Stone weight cannot be greater than the total metal weight.');
    expect(err({ wastagePercentage: 101 })).toMatch(/between 0 and 100/);
    expect(err({ makingCharges: -1 })).toMatch(/non-negative/);
    expect(err({ isCustomPrice: true, description: 'ab', customPrice: 100 })).toBe('Description is required for custom priced items.');
    expect(err({ isCustomPrice: true, description: 'Demo piece', customPrice: 0 })).toBe('A positive price is required.');
    expect(err({ categoryId: 'cat018', secondaryMetalType: 'gold', secondaryMetalWeightG: 1 })).toBe('Karat is required for secondary gold metal.');
    expect(err({ categoryId: 'cat018', secondaryMetalType: 'platinum', secondaryMetalWeightG: 0 })).toBe('A positive weight is required for secondary metal.');
    // A fixed price needs no weight.
    expect(err({ isCustomPrice: true, description: 'Demo piece', customPrice: 100, metalWeightG: 0 })).toBeNull();
  });

  it('refuses what the form does not edit, and what is not a number', () => {
    const err = (body: Record<string, unknown>) => { const r = cleanProductForm({ ...form, ...body }, 'add'); return r.ok ? null : r.error; };
    expect(err({ sku: 'RIN-000001' })).toMatch(/Not a field of the piece: sku/);
    expect(err({ imageUrl: 'https://example.com/x.jpg' })).toMatch(/imageUrl/);
    expect(err({ metalWeightG: '4.2' })).toMatch(/must be a number/);
    expect(err({ metalType: 'brass' })).toMatch(/metalType/);
    expect(cleanProductForm(null, 'add')).toEqual({ ok: false, error: 'Nothing to save.' });
  });

  it('takes the body the phone builds (StockPieceFields.piece), a fixed price named by its description', () => {
    const phone = { categoryId: 'cat001', customPrice: 12000, description: 'Demo piece', diamondCharges: 0, diamondDetails: '', hasDiamonds: false, hasStones: false, isCustomPrice: true, karat: '24k', makingCharges: 0, metalType: 'gold', metalWeightG: 4.2, miscCharges: 0, name: '', nickelFree: false, platingNote: '', platingType: '', secondaryMetalKarat: '', secondaryMetalType: '', secondaryMetalWeightG: 0, silverRatePerGram: 0, size: '', stoneCharges: 0, stoneDetails: '', stoneWeightG: 0, wastagePercentage: 10 };
    const r = cleanProductForm(phone, 'add');
    expect(r.ok && r.data).toMatchObject({ name: 'Demo piece', isCustomPrice: true, customPrice: 12000, karat: '24k' });
    // Silver: the phone sends no karat at all.
    const { karat: _k, ...silver } = { ...phone, metalType: 'silver', isCustomPrice: false, metalWeightG: 7, wastagePercentage: 0 };
    expect(cleanProductForm(silver, 'add').ok).toBe(true);
  });

  it('takes the ERP\'s own categories, and an edit may keep the one the piece has', () => {
    expect(cleanProductForm({ ...form, categoryId: 'cat-hand-typed' }, 'add').ok).toBe(false);
    expect(cleanProductForm({ ...form, categoryId: 'cat-hand-typed' }, 'edit', { currentCategoryId: 'cat-hand-typed' }).ok).toBe(true);
    expect(cleanProductForm({ ...form, categoryId: 'cat-other' }, 'edit', { currentCategoryId: 'cat-hand-typed' }).ok).toBe(false);
  });
});
