/**
 * A piece deleted from stock: the piece page's Delete (src/app/products/[sku]/page.tsx) and the Stock list's.
 * The one copy, run by the browser (store.ts `deleteProduct`, on the client SDK) and by the iPhone app
 * (/api/app/write `deleteProduct`, ops-stock3.ts, on the Admin SDK).
 *
 * Gone for good, as the page says ("This will permanently delete the product"): stock has no Recently removed,
 * and nothing else goes with it. A sold piece is not in stock (it is in sold_products), so it is never deleted
 * this way; its invoice keeps it. Logged `product.delete` as the store logs it (stock-recovery.ts deleteProducts).
 *
 * The delete code is the caller's to ask, before (decision "Delete code": the store's requireDeleteCode, the
 * route's passDeleteCode), in the store's words, `deleteProductWhat`.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { deleteProducts } from './stock-recovery';

const PRODUCTS = 'products';

/** The store's words for it, as its delete-code dialog says them and the ERP's log of tries records them. */
export const deleteProductWhat = (sku: string, name?: string) => `Delete product ${name || sku}`;

/** The piece `sku` out of stock. Throws "No such piece" for one that is not there (sold, or deleted elsewhere). */
export async function deleteProduct(db: DbPort, sku: string, fx: SideEffects = {}): Promise<{ sku: string; name: string }> {
  const piece = await db.get<{ name?: unknown }>(PRODUCTS, sku);
  if (!piece) throw new Error(`No such piece in stock: ${sku}.`);
  const name = typeof piece.name === 'string' && piece.name ? piece.name : sku;
  await deleteProducts(db, [{ sku, name }], fx);
  return { sku, name };
}
