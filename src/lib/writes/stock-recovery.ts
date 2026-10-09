/**
 * Settings → Backups' two stock tools (src/app/settings/backups): a sold piece put back into stock
 * ("Sold Product Recovery", Re-Add) and the latest pieces deleted (the Danger Zone). The one copy, for the
 * iPhone app (/api/app/write `reAddSoldProduct`, `deleteLatestProducts`, ops-settings2.ts) on the Admin SDK;
 * the store's `reAddSoldProductToInventory` and `deleteLatestProducts` do the same with the client SDK.
 *
 * - Re-Add makes a new piece from the sold one under a new SKU (lib/writes/products.ts addProduct, the same
 *   numbering as any new piece): everything it was, but its old SKU and its tag's QR. The sold record stays
 *   where it is, for the record. Not a delete, so no code.
 * - "Delete the latest N" deletes the N pieces with the highest SKUs, as Firestore orders document ids
 *   (`orderBy('__name__', 'desc')`: by the text, so XXX- before TOP- before RIN-). It is a delete of stock:
 *   the caller checks the delete code first (decision "Delete code": products, and "delete latest").
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Product } from '@/lib/store';
import { addProduct, type ProductData } from './products';

const SOLD = 'sold_products';
const PRODUCTS = 'products';
/** Firestore takes 500 writes a batch; a little under, as the page's restore does. */
const CHUNK = 400;

/** The sold piece as a new piece's data: all of it but the SKU, the tag's QR and the id the reader added. */
export function soldPieceData(sold: Record<string, unknown>): ProductData {
  const { sku: _sku, qrCodeDataUrl: _qr, id: _id, ...rest } = sold;
  void _sku; void _qr; void _id;
  return rest as unknown as ProductData;
}

/** Re-Add: the sold piece `sku` back in stock under a new SKU, numbered after `skus` (the stock held). */
export async function reAddSoldProduct(
  db: DbPort,
  sku: string,
  opts: { skus: Iterable<string> },
  fx: SideEffects = {},
): Promise<Product> {
  const sold = await db.get<Record<string, unknown>>(SOLD, sku);
  if (!sold) throw new Error(`No such sold piece: ${sku}.`);
  return addProduct(db, soldPieceData(sold), { skus: opts.skus }, fx);
}

/** The `count` highest document ids, as Firestore orders them, highest first. */
export function latestProductSkus(skus: Iterable<string>, count: number): string[] {
  if (!(count > 0)) return [];
  // Firestore compares ids by their UTF-8 bytes; for the ASCII SKUs the shop uses that is plain text order.
  return [...skus].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)).slice(0, Math.floor(count));
}

/** The pieces deleted from stock, a batch at a time, each logged as the store logs one. Returns how many went. */
export async function deleteProducts(db: DbPort, pieces: { sku: string; name?: string }[], fx: SideEffects = {}): Promise<number> {
  let gone = 0;
  for (let i = 0; i < pieces.length; i += CHUNK) {
    const chunk = pieces.slice(i, i + CHUNK);
    const b = db.batch();
    for (const p of chunk) b.delete(PRODUCTS, p.sku);
    await b.commit();
    gone += chunk.length;
    for (const p of chunk) {
      void Promise.resolve(fx.log?.('product.delete', `Deleted product: ${p.name ?? p.sku}`, `SKU: ${p.sku}`, p.sku)).catch(() => undefined);
    }
  }
  return gone;
}
