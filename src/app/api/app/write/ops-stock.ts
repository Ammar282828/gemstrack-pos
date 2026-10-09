/**
 * The stock operations of the app's write route: a piece put into stock, a piece in stock edited (the ERP's
 * product form, products/add and products/<sku>/edit, native on the phone). Each runs lib/writes/products.ts,
 * the copy the browser's store runs too, on the Admin SDK.
 *
 * Owners only: in the browser these are direct Firestore writes, Stock is the owners' place (nav.ts), and the
 * shop floor has no Firestore access (roles.ts) and no stock write on /api/staff/write.
 *
 * The body carries the piece under `piece`, checked as the form checks it (cleanProductForm): only the fields
 * the form edits, every number a number and none below 0. A sold piece has left `products` for
 * `sold_products`, and the ERP's edit page cannot find it either: it is refused, not written back into stock.
 * There are no follow-ups: the store sends nothing to Shopify or the website for a product.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import type { Product } from '@/lib/store';
import { addProduct, cleanProductForm, updateProduct } from '@/lib/writes/products';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const STOCK_OPS: OpRoles = {
  addProduct: ['owner'],
  updateProduct: ['owner'],
};

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });
const refused = (error: string) => NextResponse.json({ error }, { status: 409 });

/** A SKU as one path piece: text, no slash, and not absurd. */
const skuOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

export const runStockOp: OpHandler = async (op, body, ctx) => {
  switch (op) {
    case 'addProduct': {
      const cleaned = cleanProductForm(body.piece, 'add');
      if (!cleaned.ok) return bad(cleaned.error);
      // The SKUs in stock, as the browser holds them, for the next number under the category's prefix.
      const held = await adminDb.collection('products').select().get();
      const product = await addProduct(adminPort, cleaned.data, { skus: held.docs.map((d) => d.id) }, { log: ctx.log });
      return NextResponse.json({ ok: true, product, followUps: ctx.followUps });
    }

    case 'updateProduct': {
      const sku = skuOf(body.sku);
      if (!sku) return bad('A piece is needed.');
      const current = await adminPort.get<Product>('products', sku);
      if (!current) {
        const sold = await adminPort.get('sold_products', sku);
        return refused(sold ? `${sku} has been sold: it is no longer in stock.` : `No piece ${sku} is in stock.`);
      }
      const cleaned = cleanProductForm(body.piece, 'edit', { currentCategoryId: current.categoryId });
      if (!cleaned.ok) return bad(cleaned.error);
      await updateProduct(adminPort, sku, cleaned.data, { current }, { log: ctx.log });
      // What is on file now, so the phone shows what was saved and not what it sent.
      const product = await adminPort.get('products', sku);
      return NextResponse.json({ ok: true, product, followUps: ctx.followUps });
    }
  }
  return null;
};
