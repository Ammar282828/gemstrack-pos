/**
 * An order's or a sold piece's making details, from the Workshop's Details dialog (workshop/page.tsx
 * EditDetailsDialog; store.ts updateOrderItemDetails, updateInvoiceItemDetails), as one copy the browser's
 * store and the iPhone app (/api/app/write, ops-work2.ts) both run.
 *
 * Only the fields a karigar needs: the piece's name (it prints on the customer's estimate and invoice, so it
 * changes when given and is never cleared), its size, an order piece's estimated weight, reference SKU and
 * sample picture, and the instructions. Price, customer and quantity cannot be touched from here, so the
 * Workshop can offer it without risk to the commercial side. A sold piece's weight is what the bill was
 * priced from, so it is not changed either (withItemDetails).
 *
 * The browser's merge-writes would make an order out of a patch for one that is gone; here a record or a
 * piece that is not on file is refused (`PieceDetailsRefusal`).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { ORDER_PHOTOS, MAX_PIECE_PHOTOS, droppedPhotoIds, splitItemPhotos, type ExtraPhoto } from '@/lib/order-photos';
import { withItemDetails, type InvoiceItemDetails } from '@/lib/workshop-details';
import type { InvoiceItem } from '@/lib/store';

const ORDERS = 'orders';
const INVOICES = 'invoices';

export type OrderItemDetails = {
  description?: string; size?: string; stoneDetails?: string; diamondDetails?: string;
  adminNote?: string; referenceSku?: string; estimatedWeightG?: number;
  /** A new picture (a data URI) replaces whatever the piece had; '' takes it off. Absent leaves it. */
  sampleImageDataUri?: string;
  /** The piece's other reference photos (2..n), replacing the list it had: `{ id }` keeps a stored one, `{ dataUri }` adds one. [] takes them all off. Absent leaves them. */
  extraPhotos?: ExtraPhoto[];
};

type OrderPiece = {
  description?: string; size?: string; stoneDetails?: string; diamondDetails?: string; adminNote?: string;
  referenceSku?: string; estimatedWeightG?: number; sampleImageDataUri?: string; samplePhotoId?: string; samplePhotoHash?: string; extraPhotos?: ExtraPhoto[];
} & Record<string, unknown>;

/** A write refused because of what is on file (the order, the invoice or the piece is gone): nothing is written. */
export class PieceDetailsRefusal extends Error {}

const refuse = (message: string): never => { throw new PieceDetailsRefusal(message); };

const log = (fx: SideEffects, a: string, t: string, d: string, id: string) =>
  void Promise.resolve(fx.log?.(a, t, d, id)).catch(() => undefined);

/**
 * The order's pieces with one piece's making details changed (store.ts updateOrderItemDetails). A blank size,
 * note, stone or diamond line or reference is removed; the weight is a figure, 0 when it is not one.
 */
export function withOrderItemDetails<I extends object>(items: readonly I[], itemIndex: number, patch: OrderItemDetails): I[] {
  if (!items[itemIndex]) refuse('Item not found');
  return items.map((item, i) => {
    if (i !== itemIndex) return item;
    const next = { ...item } as OrderPiece;
    const setOrClear = (key: 'size' | 'stoneDetails' | 'diamondDetails' | 'adminNote' | 'referenceSku', value?: string) => {
      const v = (value ?? '').trim();
      if (v) next[key] = v;
      else delete next[key];
    };
    // The description prints on the customer's estimate/invoice, so it is updated when given but never
    // cleared to an empty string.
    if (patch.description !== undefined && patch.description.trim()) next.description = patch.description.trim();
    if ('size' in patch) setOrClear('size', patch.size);
    if ('stoneDetails' in patch) setOrClear('stoneDetails', patch.stoneDetails);
    if ('diamondDetails' in patch) setOrClear('diamondDetails', patch.diamondDetails);
    if ('adminNote' in patch) setOrClear('adminNote', patch.adminNote);
    if ('referenceSku' in patch) setOrClear('referenceSku', patch.referenceSku);
    if (patch.estimatedWeightG !== undefined) next.estimatedWeightG = Number(patch.estimatedWeightG) || 0;
    if (patch.sampleImageDataUri !== undefined) {
      // A new photo replaces whatever the piece had (an old inline one or an earlier document); removing it
      // clears both.
      delete next.samplePhotoId;
      delete next.samplePhotoHash;
      if (patch.sampleImageDataUri) next.sampleImageDataUri = patch.sampleImageDataUri;
      else delete next.sampleImageDataUri;
    }
    if (patch.extraPhotos !== undefined) {
      // Only ids this piece already holds may be kept: a caller cannot point a piece at someone else's document.
      const held = new Set((item as OrderPiece).extraPhotos?.map(e => e.id));
      const extras = patch.extraPhotos.slice(0, MAX_PIECE_PHOTOS - 1)
        .filter(e => e && (e.dataUri || (e.id && held.has(e.id))))
        .map(e => (e.dataUri ? { dataUri: e.dataUri } : { id: e.id, ...(e.hash ? { hash: e.hash } : {}) }));
      if (extras.length) next.extraPhotos = extras; else delete next.extraPhotos;
    }
    return next as unknown as I;
  });
}

/**
 * An order piece's making details, in one commit: the order's pieces (a new picture moved to a document of
 * its own, lib/order-photos.ts) and the photo documents it no longer points at deleted. Logged as the store
 * logs it.
 */
export async function updateOrderPieceDetails(
  db: DbPort, input: { orderId: string; itemIndex: number; patch: OrderItemDetails; now?: string }, fx: SideEffects = {},
): Promise<{ orderId: string; itemIndex: number; description: string }> {
  const at = input.now ?? new Date().toISOString();
  const before = await db.runTransaction(async (tx) => {
    const order = await tx.get<{ items?: OrderPiece[] }>(ORDERS, input.orderId);
    if (!order) return refuse(`No such order: ${input.orderId}.`);
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items[input.itemIndex]) return refuse('That piece is no longer on the order.');
    const split = splitItemPhotos(withOrderItemDetails(items, input.itemIndex, input.patch));
    tx.set(ORDERS, input.orderId, { items: split.items }, true);
    for (const ph of split.photos) tx.set(ORDER_PHOTOS, ph.id, { dataUri: ph.dataUri, hash: ph.hash, orderId: input.orderId, createdAt: at });
    for (const id of droppedPhotoIds(items, split.items)) tx.delete(ORDER_PHOTOS, id);
    return items[input.itemIndex];
  });
  const what = before?.description || `Item ${input.itemIndex + 1}`;
  log(fx, 'order.update', `Making details updated on ${input.orderId}`, what, input.orderId);
  return { orderId: input.orderId, itemIndex: input.itemIndex, description: what };
}

/** A sold piece's making details: its name and size (both print on the bill) and the instructions. */
export async function updateInvoicePieceDetails(
  db: DbPort, input: { invoiceId: string; itemIndex: number; patch: InvoiceItemDetails }, fx: SideEffects = {},
): Promise<{ invoiceId: string; itemIndex: number; name: string }> {
  const before = await db.runTransaction(async (tx) => {
    const inv = await tx.get<{ items?: InvoiceItem[] | Record<string, InvoiceItem> }>(INVOICES, input.invoiceId);
    if (!inv) return refuse(`No such invoice: ${input.invoiceId}.`);
    // A list kept as a map is written back as a list, as the store writes it.
    const items = (Array.isArray(inv.items) ? inv.items : Object.values(inv.items || {})) as InvoiceItem[];
    if (!items[input.itemIndex]) return refuse('That piece is no longer on the invoice.');
    tx.set(INVOICES, input.invoiceId, { items: withItemDetails(items, input.itemIndex, input.patch) }, true);
    return items[input.itemIndex];
  });
  const what = before?.name || `Item ${input.itemIndex + 1}`;
  log(fx, 'invoice.update', `Making details updated on ${input.invoiceId}`, what, input.invoiceId);
  return { invoiceId: input.invoiceId, itemIndex: input.itemIndex, name: what };
}
