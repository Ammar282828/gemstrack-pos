/**
 * The order page's moves that undo something (src/app/orders/[id]/page.tsx: the invoiced banner's Cancel
 * invoice and Unlock & edit, the ⋯ menu's Refund order and Delete order; store.ts revertOrderFromInvoice,
 * refundOrder, deleteOrder, and the deleteInvoice each of the first two runs). The one copy, for the iPhone
 * app's order page (/api/app/write, ops-orders.ts) and for the store when it takes them up.
 *
 *  - Undo invoice (Unlock & edit is the same write, then the edit form): the invoice goes with its hisaab
 *    rows, its pieces staying where they are (made for the order, never stock); the order is open again,
 *    Completed back to In Progress and any other status kept, and carries the invoice's Shopify order
 *    forward so the next invoice re-uses it.
 *  - Refund order: the invoice goes with its hisaab rows and its pieces go back to stock (a piece made for
 *    the order, ORD-…, was never stock; one another invoice also sold stays sold); the order is Refunded.
 *    Shopify refunds the invoice's order, or the order's own when it has no invoice, and drops its draft.
 *  - Delete order: refused while it has an invoice (it is the invoice's history); its sample photos go
 *    with it and its Shopify draft is dropped.
 *
 * Each reads first and writes once: the invoice's removal (lib/writes/invoice-delete.ts stageInvoiceRemoval, the
 * one copy, which the invoice page's Delete runs too) and the order's change in one commit (the store makes two of it; decision "Saves are
 * one trip"). Shopify is told after the commit, never before, so a
 * write that fails has refunded or cancelled nothing there. The delete code is the caller's to ask (the
 * store's requireDeleteCode, the app route's passDeleteCode), in the store's words: `undoWhat`, `refundWhat`,
 * `deleteWhat`.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { ORDER_PHOTOS } from '@/lib/order-photos';
import { logInvoiceDeleted, stageInvoiceRemoval, type InvoiceDeleteDeps, type StagedInvoiceRemoval } from './invoice-delete';

const ORDERS = 'orders';

/** The store's words for each, as its delete-code dialog says them and the ERP's log of tries records them. */
export const undoWhat = (orderId: string, invoiceId: string) => `Undo invoice ${invoiceId} back to order ${orderId}`;
export const refundWhat = (orderId: string) => `Refund order ${orderId}`;
export const deleteWhat = (orderId: string) => `Delete order ${orderId}`;

/** A refusal in the page's words: the order is not in a state for this. */
export class OrderUndoRefusal extends Error {}

/** A call to one of the ERP's Shopify routes, made once the books are written, without waiting on it. */
export type OrderShopifyCall =
  | { path: '/api/shopify/sync/invoice'; body: { invoiceId?: string; shopifyOrderId?: string; action: 'refund' } }
  | { path: '/api/shopify/sync/order'; body: { orderId: string; shopifyDraftOrderId: string; action: 'cancel' } };

export interface OrderUndoEffects extends SideEffects {
  /** Shopify told: fire-and-forget, never failing the change (store.ts postShopify). */
  shopify?: (call: OrderShopifyCall) => void;
}

/** What the invoice's removal needs (lib/writes/invoice-delete.ts): the SDK's field removal, and every invoice's pieces. */
export type OrderUndoDeps = InvoiceDeleteDeps;

export type OrderDoc = {
  id: string;
  status?: string;
  invoiceId?: string;
  customerName?: string;
  shopifyOrderId?: string;
  shopifyOrderNumber?: number | string;
  shopifyDraftOrderId?: string;
} & Record<string, unknown>;

/** The removal and the order's own change, in one commit: one write to the order, the order's own winning. */
async function commit(db: DbPort, staged: StagedInvoiceRemoval | null, orderId: string, patch: Record<string, unknown>) {
  const b = db.batch();
  staged?.write(b);
  // The removal's change to the order's link: this order's own change below covers it (it clears the link too);
  // an invoice that names another order has that order's link written beside it.
  if (staged?.order && staged.order.id !== orderId) b.set(ORDERS, staged.order.id, staged.order.patch, true);
  b.set(ORDERS, orderId, patch, true);
  await b.commit();
}

const log = (fx: SideEffects, action: string, title: string, detail: string, ref: string) =>
  void Promise.resolve(fx.log?.(action, title, detail, ref)).catch(() => undefined);

async function orderOnFile(db: DbPort, orderId: string): Promise<OrderDoc> {
  const order = await db.get<OrderDoc>(ORDERS, orderId);
  if (!order) throw new OrderUndoRefusal(`No such order: ${orderId}.`);
  return order;
}

/** Completed goes back to In Progress; any other status is kept (a Pending order is not moved on by an undo). */
export const revertedStatus = (status: string | undefined) => (status === 'Completed' ? 'In Progress' : status || 'In Progress');

/** Undo invoice: the order back to an order, the invoice and its hisaab rows gone, its pieces left as they are. */
export async function undoOrderInvoice(
  db: DbPort, input: { orderId: string; invoiceId: string }, deps: OrderUndoDeps, fx: OrderUndoEffects = {},
): Promise<{ orderId: string; invoiceId: string; status: string; removed: boolean }> {
  const { orderId, invoiceId } = input;
  const order = await orderOnFile(db, orderId);
  // What the screen showed is what is undone: an order invoiced again since is checked again first.
  if (order.invoiceId && order.invoiceId !== invoiceId) {
    throw new OrderUndoRefusal(`${orderId} is invoiced as ${order.invoiceId} now, not ${invoiceId}: it has changed since.`);
  }
  const staged = await stageInvoiceRemoval(db, invoiceId, deps, { editing: true });
  const status = revertedStatus(order.status);
  const inv = staged.invoice;
  await commit(db, staged, orderId, {
    status,
    invoiceId: deps.deleteField(),
    // The next finalize re-links the same Shopify order instead of making a second one.
    ...(inv?.shopifyOrderId && { shopifyOrderId: inv.shopifyOrderId }),
    ...(inv?.shopifyOrderNumber && { shopifyOrderNumber: inv.shopifyOrderNumber }),
  });
  if (inv) logInvoiceDeleted(fx, inv);
  log(fx, 'order.revert', `Reverted order ${orderId}`, `Cancelled invoice ${invoiceId}`, orderId);
  // The store refreshes the order's Shopify draft here; pushing to Shopify is off (store.ts PUSH_TO_SHOPIFY).
  return { orderId, invoiceId, status, removed: !!inv };
}

/**
 * Refund order: Refunded, its invoice deleted with its pieces back in stock. Not for an order already
 * cancelled or refunded (the page does not offer it there).
 */
export async function refundOrder(
  db: DbPort, input: { orderId: string }, deps: OrderUndoDeps, fx: OrderUndoEffects = {},
): Promise<{ orderId: string; invoiceId: string | null; restocked: string[] }> {
  const { orderId } = input;
  const order = await orderOnFile(db, orderId);
  if (order.status === 'Refunded') throw new OrderUndoRefusal(`${orderId} is already refunded.`);
  if (order.status === 'Cancelled') throw new OrderUndoRefusal(`${orderId} is cancelled: there is nothing to refund.`);
  const invoiceId = order.invoiceId || null;
  const staged = invoiceId ? await stageInvoiceRemoval(db, invoiceId, deps) : null;
  await commit(db, staged, orderId, {
    status: 'Refunded',
    invoiceId: deps.deleteField(),
    ...(order.shopifyOrderId && { shopifyOrderId: deps.deleteField(), shopifyOrderNumber: deps.deleteField() }),
  });
  if (staged?.invoice) logInvoiceDeleted(fx, staged.invoice);
  log(fx, 'order.refund', `Refunded order ${orderId}`, `Customer: ${order.customerName || 'Unknown'}`, orderId);

  // Shopify, once the books are right. The invoice's order is refunded (it is gone now, so its Shopify order is
  // named; a Shopify-made invoice is Shopify's own and is left alone), else the order's carried-forward one.
  const invShop = staged?.invoice?.shopifyOrderId;
  if (invoiceId) {
    if (!invoiceId.startsWith('SHOPIFY-')) {
      fx.shopify?.({ path: '/api/shopify/sync/invoice', body: { invoiceId, ...(invShop && { shopifyOrderId: String(invShop) }), action: 'refund' } });
    }
  } else if (order.shopifyOrderId) {
    fx.shopify?.({ path: '/api/shopify/sync/invoice', body: { shopifyOrderId: String(order.shopifyOrderId), action: 'refund' } });
  }
  if (order.shopifyDraftOrderId) {
    fx.shopify?.({ path: '/api/shopify/sync/order', body: { orderId, shopifyDraftOrderId: String(order.shopifyDraftOrderId), action: 'cancel' } });
  }
  return { orderId, invoiceId, restocked: staged?.restocked ?? [] };
}

/** The page's refusal for an invoiced order, before the code is asked for (store.ts deleteOrder). */
export const invoicedRefusal = (orderId: string, invoiceId: string) => `${orderId} has invoice ${invoiceId}. Delete or undo the invoice first.`;

/** Delete order: the order and its sample photos, in one commit; its Shopify draft dropped after. */
export async function deleteOrder(db: DbPort, input: { orderId: string }, fx: OrderUndoEffects = {}): Promise<{ orderId: string; photos: number }> {
  const { orderId } = input;
  const order = await orderOnFile(db, orderId);
  if (order.invoiceId) throw new OrderUndoRefusal(invoicedRefusal(orderId, order.invoiceId));
  const photos = await db.queryEquals(ORDER_PHOTOS, 'orderId', orderId).catch(() => null);
  const b = db.batch();
  photos?.forEach(p => b.delete(ORDER_PHOTOS, p.id));
  b.delete(ORDERS, orderId);
  await b.commit();
  log(fx, 'order.delete', `Deleted order: ${orderId}`, `Customer: ${order.customerName}`, orderId);
  // The order is gone by now: its draft is named, not looked up from it.
  if (order.shopifyDraftOrderId) {
    fx.shopify?.({ path: '/api/shopify/sync/order', body: { orderId, shopifyDraftOrderId: String(order.shopifyDraftOrderId), action: 'cancel' } });
  }
  return { orderId, photos: photos?.length ?? 0 };
}
