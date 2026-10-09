/**
 * A piece put into stock, or a piece in stock edited. The one copy, run by the browser (store.ts
 * `addProduct`, `updateProduct`, on the client SDK) and by the iPhone app (/api/app/write, ops-stock.ts,
 * on the Admin SDK).
 *
 * Two layers, as in people.ts, so the browser's other callers (bulk add, a sold piece put back, the cart's
 * new piece, the voice assistant's change to a piece) keep exactly what they had:
 * - `addProduct` and `updateProduct` apply the store's own rules to what they are given: the SKU from the
 *   category's prefix and the highest number in stock, the name made up when none is given, a gold coin's
 *   charges at nothing, gold's karat at 21k when none is set.
 * - `cleanProductForm` is the phone's door: the product form's own checks (components/product/product-form.tsx,
 *   its zod schema and `processAndSubmit`) applied to a body nobody has checked. Only the fields that form
 *   edits get through: never the SKU, the photo, the tag's QR or a Shopify id, which an edit leaves as they are.
 *
 * Nothing goes to Shopify or the website: the store never pushes a product (the Shopify catalogue is kept
 * by hand), so neither does the phone.
 */

import * as z from 'zod';
import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Product } from '@/lib/store';
import { staticCategories } from '@/lib/categories';
import { KARAT_VALUES, METAL_TYPES } from '@/lib/materials';
import { DEFAULT_KARAT_VALUE_FOR_CALCULATION_INTERNAL as DEFAULT_KARAT, GOLD_COIN_CATEGORY_ID_INTERNAL as GOLD_COIN } from '@/lib/pricing';
import { cleanObject } from './create-invoice';

const PRODUCTS = 'products';

/** Each category's SKU prefix: RIN-000001 is a ring. A category with none numbers under XXX, as it always has. */
export const CATEGORY_SKU_PREFIXES: Record<string, string> = {
  'cat001': 'RIN', 'cat002': 'TOP', 'cat003': 'BAL', 'cat004': 'LCK',
  'cat005': 'BRC', 'cat006': 'BRS', 'cat007': 'BNG', 'cat008': 'CHN',
  'cat009': 'BND', 'cat010': 'LSW', 'cat011': 'LSB', 'cat012': 'STR',
  'cat013': 'SNX', 'cat014': 'SNB', 'cat015': 'GNX', 'cat016': 'GNW',
  'cat017': 'GCN', 'cat018': 'MRN', 'cat019': 'LBR',
};

/** Men's rings can carry a second metal (store.ts MENS_RING_CATEGORY_ID); no other piece can. */
export const MENS_RING_CATEGORY = 'cat018';

/** What a new piece is made from: everything but its SKU and its tag's QR, which the piece page draws. */
export type ProductData = Omit<Product, 'sku' | 'qrCodeDataUrl'>;
type PickableCategory = { id: string; title: string };

/** A number after the prefix that a taken SKU is skipped past, at most: a list that far behind is not a list. */
const MAX_SKIPS = 50;

const log = (fx: SideEffects, action: string, title: string, detail: string, id: string) =>
  void Promise.resolve(fx.log?.(action, title, detail, id)).catch(() => undefined);

const skuFor = (prefix: string, n: number) => `${prefix}-${n.toString().padStart(6, '0')}`;

/** The category's prefix, and the next number after the highest one already in stock under it. */
export function nextProductSku(categoryId: string, skus: Iterable<string>): { prefix: string; next: number; sku: string } {
  const prefix = CATEGORY_SKU_PREFIXES[categoryId] || 'XXX';
  let maxNum = 0;
  for (const sku of skus) {
    if (!sku.startsWith(prefix + '-')) continue;
    const n = parseInt(sku.substring(prefix.length + 1), 10);
    if (!isNaN(n) && n > maxNum) maxNum = n;
  }
  return { prefix, next: maxNum + 1, sku: skuFor(prefix, maxNum + 1) };
}

/**
 * A new piece in stock, numbered from the SKUs in `skus` (the stock as the caller holds it). Refuses a
 * category that is not one of `categories` (the store's list; the ERP's twenty by default), as the store
 * always has. The stock held can be a moment old (another phone, a bulk add still landing), so a number
 * already taken is passed over for the next free one, in the same transaction, never written over.
 */
export async function addProduct(
  db: DbPort,
  data: ProductData,
  opts: { skus: Iterable<string>; categories?: readonly PickableCategory[] },
  fx: SideEffects = {},
): Promise<Product> {
  const category = (opts.categories ?? staticCategories).find((c) => c.id === data.categoryId);
  if (!category) throw new Error(`Category with id ${data.categoryId} not found.`);
  const { prefix, next } = nextProductSku(data.categoryId, opts.skus);

  const created = await db.runTransaction(async (tx) => {
    let n = next;
    let sku = skuFor(prefix, n);
    for (let skipped = 0; await tx.get(PRODUCTS, sku); skipped++) {
      if (skipped >= MAX_SKIPS) throw new Error(`Product ${sku} already exists — the stock list is out of date. Try again.`);
      sku = skuFor(prefix, ++n);
    }

    let name = data.name;
    if (data.isCustomPrice) {
      name = data.description || 'Custom Item';
    } else if (!name) {
      name = `${category.title} - ${sku}`;
    }

    // A gold coin is sold by its weight alone: no making, wastage, stones or sundries.
    const coin = data.categoryId === GOLD_COIN && data.metalType === 'gold';
    const partial: Partial<Product> = {
      ...data,
      name,
      hasDiamonds: coin ? false : data.hasDiamonds,
      diamondCharges: coin ? 0 : (data.hasDiamonds ? data.diamondCharges : 0),
      wastagePercentage: coin ? 0 : data.wastagePercentage,
      makingCharges: coin ? 0 : data.makingCharges,
      stoneCharges: coin ? 0 : data.stoneCharges,
      miscCharges: coin ? 0 : data.miscCharges,
    };
    if (partial.metalType === 'gold' && !partial.karat) partial.karat = DEFAULT_KARAT;

    const product = cleanObject({ ...partial, sku } as Product);
    tx.set(PRODUCTS, sku, product as unknown as Record<string, unknown>);
    return product;
  });
  log(fx, 'product.create', `Created product: ${created.name}`, `SKU: ${created.sku}`, created.sku);
  return created;
}

/**
 * A piece in stock saved over: the fields given, merged into its document (a field not given, such as
 * its photo or its tag's QR, is left as it is). `current` is the piece as the caller holds it; without
 * it the document is read, and a piece that is not in stock is refused.
 *
 * The store's rules, as it has always applied them: the name follows a fixed price's description, a
 * blank name is made from the category and SKU, a gold coin's charges are nothing, no diamonds means no
 * diamond charge, and gold left without a karat is 21k. A field set to undefined is left out of the
 * write, so it keeps what is on file.
 */
export async function updateProduct(
  db: DbPort,
  sku: string,
  patch: Partial<Omit<Product, 'sku'>> & { sku?: string },
  opts: { current?: Product; categories?: readonly PickableCategory[] } = {},
  fx: SideEffects = {},
): Promise<void> {
  const current = opts.current ?? await db.get<Product>(PRODUCTS, sku);
  if (!current) throw new Error(`Product ${sku} not found.`);

  const merged = { ...current, ...patch };
  const coin = merged.categoryId === GOLD_COIN && merged.metalType === 'gold';

  let fields: Partial<Product> = { ...patch };
  if (fields.isCustomPrice && fields.description) {
    fields.name = fields.description;
  } else if (!fields.isCustomPrice && !fields.name) {
    const category = (opts.categories ?? staticCategories).find((c) => c.id === merged.categoryId);
    fields.name = `${category?.title || 'Item'} - ${sku}`;
  }

  if (coin) {
    fields = { ...fields, hasDiamonds: false, diamondCharges: 0, wastagePercentage: 0, makingCharges: 0, stoneCharges: 0, miscCharges: 0 };
  } else {
    if (patch.hasDiamonds === false) fields.diamondCharges = 0;
    if (patch.metalType && patch.metalType !== 'gold' && 'karat' in fields) {
      fields.karat = undefined;
    } else if (patch.metalType === 'gold' && !fields.karat) {
      if (!('karat' in patch) && !current.karat) fields.karat = DEFAULT_KARAT;
    }
  }

  const { sku: _sku, ...payload } = fields;
  const b = db.batch();
  b.set(PRODUCTS, sku, cleanObject(payload) as unknown as Record<string, unknown>, true);
  await b.commit();
  log(fx, 'product.update', `Updated product: ${fields.name || current.name}`, `SKU: ${sku}`, sku);
}

// ── The phone's door ────────────────────────────────────────────────────────────────────────────────

/** The most a person could mean in one box; a paste gone wrong is not stored. */
const MAX_TEXT = 2000;
const MAX_SHORT = 200;

const text = (max: number) => z.string().max(max, `At most ${max} characters.`);
const amount = (what: string) => z.number({ invalid_type_error: `${what} must be a number.` }).finite().min(0, `${what} must be non-negative`);

/**
 * The product form's schema (product-form.tsx `productFormSchema`), field for field, with its messages. The
 * form coerces typed text to numbers; the phone sends numbers, so a number is required here. `.strict()`:
 * a field the form does not edit (an id, the photo, the QR, a Shopify id) is refused, not quietly dropped.
 */
const productFormSchema = z.object({
  name: text(MAX_SHORT).optional(),
  categoryId: z.string().min(1, 'Category is required').max(MAX_SHORT),
  metalType: z.enum(METAL_TYPES, { required_error: 'Metal type is required' }),
  karat: z.enum(KARAT_VALUES).optional(),
  metalWeightG: amount('Metal weight'),
  silverRatePerGram: amount('Rate per gram').optional(),
  secondaryMetalType: z.union([z.literal(''), z.literal('none'), z.enum(METAL_TYPES)]).optional(),
  secondaryMetalKarat: z.enum(KARAT_VALUES).optional().or(z.literal('')),
  secondaryMetalWeightG: amount('Secondary metal weight').optional(),
  wastagePercentage: amount('Wastage').max(100, 'Wastage must be between 0 and 100'),
  makingCharges: amount('Making charges'),
  hasDiamonds: z.boolean().default(false),
  hasStones: z.boolean().default(false),
  stoneWeightG: amount('Stone weight').default(0),
  diamondCharges: amount('Diamond charges'),
  stoneCharges: amount('Stone charges'),
  miscCharges: amount('Misc charges'),
  stoneDetails: text(MAX_TEXT).optional(),
  diamondDetails: text(MAX_TEXT).optional(),
  isCustomPrice: z.boolean().default(true),
  customPrice: amount('Price').optional(),
  description: text(MAX_TEXT).optional(),
  size: text(MAX_SHORT).optional(),
  platingType: text(MAX_SHORT).optional(),
  platingNote: text(MAX_SHORT).optional(),
  nickelFree: z.boolean().default(false),
}).strict().superRefine((data, ctx) => {
  if (data.isCustomPrice) {
    if (!data.description || data.description.length < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Description is required for custom priced items.', path: ['description'] });
    }
    if (data.customPrice === undefined || data.customPrice <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A positive price is required.', path: ['customPrice'] });
    }
  }

  if (!data.isCustomPrice && (!data.metalWeightG || data.metalWeightG < 0.001)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Metal weight must be a positive number', path: ['metalWeightG'] });
  }

  if (!data.isCustomPrice) {
    if (data.metalType === 'gold' && !data.karat) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Karat is required for gold items.', path: ['karat'] });
    }
    if (data.secondaryMetalType === 'gold' && !data.secondaryMetalKarat) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Karat is required for secondary gold metal.', path: ['secondaryMetalKarat'] });
    }
    if (data.secondaryMetalType && (!data.secondaryMetalWeightG || data.secondaryMetalWeightG <= 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A positive weight is required for secondary metal.', path: ['secondaryMetalWeightG'] });
    }
    const totalMetalWeight = (data.metalWeightG || 0) + (data.secondaryMetalWeightG || 0);
    if (data.stoneWeightG > totalMetalWeight) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Stone weight cannot be greater than the total metal weight.', path: ['stoneWeightG'] });
    }
  }
});

export type ProductForm = z.infer<typeof productFormSchema>;
export type CleanedProduct = { ok: true; data: ProductData } | { ok: false; error: string };

/**
 * The form's fields, checked as the form checks them, then shaped as its `processAndSubmit` shapes them:
 * a fixed-price piece is named by its description, a karat only for gold, and a second metal only on a
 * men's ring. `mode` 'add' takes one of the ERP's own categories only, as the store's addProduct does;
 * an edit may also keep the category the piece already has (`currentCategoryId`), however old.
 */
export function cleanProductForm(input: unknown, mode: 'add' | 'edit', opts: { currentCategoryId?: string } = {}): CleanedProduct {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Nothing to save.' };
  const parsed = productFormSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.code === z.ZodIssueCode.unrecognized_keys) return { ok: false, error: `Not a field of the piece: ${issue.keys.join(', ')}.` };
    if (!issue) return { ok: false, error: 'Not saved.' };
    // The form's own words stand alone; zod's ("Required", "Expected string…", "Invalid enum value…") name the field.
    const zods = issue.message === 'Required' || issue.message.startsWith('Expected') || issue.message.startsWith('Invalid');
    const field = issue.path.join('.');
    return { ok: false, error: zods && field ? `${field}: ${issue.message}` : issue.message };
  }
  const data = parsed.data;
  const known = staticCategories.some((c) => c.id === data.categoryId);
  if (!known && !(mode === 'edit' && data.categoryId === opts.currentCategoryId)) {
    return { ok: false, error: 'Category is required' };
  }

  const mensRing = data.categoryId === MENS_RING_CATEGORY;
  const second = data.secondaryMetalType;
  const out = {
    ...data,
    name: data.isCustomPrice ? (data.description || 'Custom Item') : (data.name || ''),
    karat: data.metalType === 'gold' ? data.karat : undefined,
    secondaryMetalType: mensRing && second !== 'none' ? second : undefined,
    secondaryMetalKarat: mensRing && second === 'gold' ? data.secondaryMetalKarat : undefined,
    secondaryMetalWeightG: mensRing && second !== 'none' ? data.secondaryMetalWeightG : undefined,
  };
  return { ok: true, data: out as unknown as ProductData };
}
