/**
 * A piece deleted from stock, native on the phone: the piece page's Delete and the Stock list's
 * (lib/writes/product-delete.ts, the copy the browser's store runs), on the Admin SDK.
 *
 * Owners only: Stock is the owners' place and the shop floor has no stock write (roles.ts), as addProduct.
 *
 * It asks for the delete code, checked here before anything is touched, in the store's words ("Delete product
 * Demo ring"). A piece already gone (sold, or deleted on another device) is said before the code is asked for,
 * so no try is spent on it.
 */

import { NextResponse } from 'next/server';
import { adminPort } from '@/lib/db-admin-port';
import { passDeleteCode } from '@/lib/delete-code-gate';
import { deleteProduct, deleteProductWhat } from '@/lib/writes/product-delete';
import type { OpHandler, OpRoles } from './op-context';

/** Who may run each operation: as the browser allows it today. */
export const STOCK3_OPS: OpRoles = {
  deleteProduct: ['owner'],
};

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** A SKU as one path piece: text, no slash, and not absurd. */
const skuOf = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s && s.length <= 200 && !s.includes('/') ? s : '';
};

export const runStock3Op: OpHandler = async (op, body, ctx) => {
  switch (op) {
    case 'deleteProduct': {
      const sku = skuOf(body.sku);
      if (!sku) return bad('Which piece?');
      const piece = await adminPort.get<{ name?: unknown }>('products', sku);
      if (!piece) return bad(`No piece ${sku} is in stock.`, 409);
      const name = typeof piece.name === 'string' ? piece.name : undefined;
      const code = await passDeleteCode(ctx.email, body.deleteCode, deleteProductWhat(sku, name));
      if (!code.ok) return bad(code.error, code.status);
      try {
        const gone = await deleteProduct(adminPort, sku, { log: ctx.log });
        return NextResponse.json({ ok: true, ...gone, followUps: ctx.followUps });
      } catch (e) {
        // Gone between the read and the delete: a refusal, not a crash.
        if (e instanceof Error && /^No such /.test(e.message)) return bad(`No piece ${sku} is in stock.`, 409);
        throw e;
      }
    }
  }
  return null;
};
