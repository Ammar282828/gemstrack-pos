/**
 * Pieces put into stock in bulk (the ERP's products/bulk-add, native on the phone): the same piece form as
 * ops-stock.ts's addProduct, many times over, each through lib/writes/products.ts `addProduct`, the copy the
 * browser's store runs for every piece of its own bulk add.
 *
 * Owners only, as addProduct is: Stock is the owners' place and the shop floor has no stock write.
 *
 * The body carries `pieces`, each a full product form (the one `cleanProductForm` checks). Every piece is
 * checked before the first is written, so a mistake in the ninth row stops the whole batch and nothing is
 * half in stock; the answer names the row ("Piece 9: …") as the phone counts them. They are then added in
 * order, each numbered from the SKUs in stock including the ones this batch just made, as the browser's
 * loop gets from its live list. Each logs `product.create` on its own, as there.
 *
 * A write that fails after some pieces were added does not undo them (the browser does not either): the
 * answer is a 200 saying `partial`, with the pieces that went in and the words of the failure, so the phone
 * keeps only the rest and a retry cannot add the first ones twice.
 */

import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { adminPort } from '@/lib/db-admin-port';
import type { Product } from '@/lib/store';
import { addProduct, cleanProductForm, type ProductData } from '@/lib/writes/products';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const STOCK2_OPS: OpRoles = {
  addProducts: ['owner'],
};

/** More than a Cloud Run request should spend in one go (each piece is a trip to the database); the phone sends fewer. */
export const MAX_BULK_PIECES = 50;

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

export const runStock2Op: OpHandler = async (op, body, ctx) => {
  switch (op) {
    case 'addProducts': {
      const pieces = body.pieces;
      // The page's own words when the list is empty ("At least one item is required").
      if (!Array.isArray(pieces) || pieces.length === 0) return bad('At least one item is required');
      if (pieces.length > MAX_BULK_PIECES) return bad(`At most ${MAX_BULK_PIECES} pieces at a time.`);

      const cleaned: ProductData[] = [];
      for (let i = 0; i < pieces.length; i++) {
        const c = cleanProductForm(pieces[i], 'add');
        if (!c.ok) return bad(`Piece ${i + 1}: ${c.error}`);
        cleaned.push(c.data);
      }

      // The SKUs in stock, as the browser holds them; each piece made here joins the list for the next number.
      const held = await adminDb.collection('products').select().get();
      const skus = held.docs.map((d) => d.id);
      const added: Product[] = [];
      for (const data of cleaned) {
        try {
          const product = await addProduct(adminPort, data, { skus }, { log: ctx.log });
          skus.push(product.sku);
          added.push(product);
        } catch (e) {
          // Nothing written: the route answers it (and gives the request's name back for a retry).
          if (added.length === 0) throw e;
          const error = e instanceof Error ? e.message : 'Not saved.';
          return NextResponse.json({ ok: true, partial: true, products: added, failedAt: added.length, error, followUps: ctx.followUps });
        }
      }
      return NextResponse.json({ ok: true, products: added, followUps: ctx.followUps });
    }
  }
  return null;
};
