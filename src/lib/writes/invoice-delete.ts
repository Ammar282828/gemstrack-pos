/**
 * Deleting an invoice: the invoice page's Delete, and its Refund → Full refund, which is the same store call
 * (store.ts `deleteInvoice(id, false)`). A mistake, a sale entered twice, a sale handed back whole.
 *
 * The one copy for the invoice page: the browser's store and the iPhone app's write route (/api/app/write
 * `deleteInvoice`) both drive it. The delete code is the caller's to ask, before (decision "Delete code": the
 * store's requireDeleteCode, the route's passDeleteCode), in the store's words, `deleteInvoiceWhat`.
 *
 * What goes with it, read first and written in one commit (the store makes it a read, then a batch):
 * - its pieces back in stock, each as the line described it, a custom price kept so a piece handed back is
 *   not re-priced (lib/invoice-actions.ts `piecesBackInStock` says which: never a piece made for an order,
 *   which was never stock, nor one another invoice also sold, which stays sold to that one);
 * - every ledger row linked to it (what was owed, any credit);
 * - the order it came from loses its link to it, so the order's advance counts again, unless the order has
 *   another invoice (a sale entered twice), which it is then linked to. Only a link to THIS invoice is
 *   touched; an order that is gone is left gone; one that could not be read is cleared, as the store does.
 * Then the activity log, and Shopify's copy of the sale cancelled when it has one.
 *
 * The order page's Undo invoice and Refund order take an invoice off the books with the same staging
 * (`stageInvoiceRemoval`), folded into their own change to the order in the same commit (lib/writes/order-undo.ts).
 */

import type { BatchCtx, DbPort, SideEffects } from '@/lib/db-port';
import { invoiceLines, piecesBackInStock } from '@/lib/invoice-actions';
import { cleanObject } from './create-invoice';

const INVOICES = 'invoices';
const HISAAB = 'hisaab';
const ORDERS = 'orders';
const PRODUCTS = 'products';
const SOLD = 'sold_products';

/** The store's words for it, as its delete-code dialog says them and the ERP's log of tries records them. */
export const deleteInvoiceWhat = (invoiceId: string) => `Delete invoice ${invoiceId}`;

/** The fields of a sold piece that go back to stock (store.ts deleteInvoice). */
export type SoldLine = {
  sku?: string; name?: string; categoryId?: string; metalType?: string; karat?: string;
  metalWeightG?: number; stoneWeightG?: number; wastagePercentage?: number; makingCharges?: number;
  diamondChargesIfAny?: number; stoneChargesIfAny?: number; miscChargesIfAny?: number;
  stoneDetails?: string; diamondDetails?: string; isCustomPrice?: boolean; unitPrice?: number;
};

export type InvoiceDoc = {
  id: string;
  items?: SoldLine[] | Record<string, SoldLine>;
  customerName?: string;
  sourceOrderId?: string;
  shopifyOrderId?: string | number;
  shopifyOrderNumber?: string | number;
};

export interface InvoiceDeleteDeps {
  /** The SDK's own field-removal value (`deleteField()` / `FieldValue.delete()`). */
  deleteField: () => unknown;
  /** Every invoice with its pieces (the browser's loaded ones; the server reads them): a piece one of them also sold stays sold. */
  invoices: () => Promise<{ id: string; items?: unknown }[]> | { id: string; items?: unknown }[];
}

/** Shopify told, once the books are written: fire-and-forget, never failing the delete (store.ts postShopify). */
export type InvoiceDeleteShopifyCall = { path: '/api/shopify/sync/invoice'; body: { invoiceId: string; shopifyOrderId: string; action: 'cancel' } };

export interface InvoiceDeleteEffects extends SideEffects {
  shopify?: (call: InvoiceDeleteShopifyCall) => void;
}

export interface DeletedInvoice {
  /** False when there was no such invoice: nothing was written, as the store only warns. */
  deleted: boolean;
  invoiceId: string;
  customerName?: string;
  /** The stock numbers put back in stock. */
  restocked: string[];
  /** How many ledger rows went with it. */
  ledgerRows: number;
  /** Its order, and the invoice that order is linked to now (null: none), when that link changed. */
  order?: { id: string; invoiceId: string | null };
}

/** A piece back in stock as it was sold, its custom price kept. */
export function restockedProduct(item: SoldLine): Record<string, unknown> {
  return cleanObject({
    sku: item.sku, name: item.name, categoryId: item.categoryId,
    metalType: item.metalType, karat: item.karat, metalWeightG: item.metalWeightG,
    hasStones: (item.stoneChargesIfAny ?? 0) > 0,
    stoneWeightG: item.stoneWeightG, wastagePercentage: item.wastagePercentage,
    makingCharges: item.makingCharges, hasDiamonds: (item.diamondChargesIfAny ?? 0) > 0,
    diamondCharges: item.diamondChargesIfAny, stoneCharges: item.stoneChargesIfAny,
    miscCharges: item.miscChargesIfAny, stoneDetails: item.stoneDetails, diamondDetails: item.diamondDetails,
    ...(item.isCustomPrice && { isCustomPrice: true, customPrice: item.unitPrice }),
  });
}

/** An order that could not be read (the store's getDoc(...).catch(() => null)), apart from one not on file. */
const UNREAD = 'unread' as const;

/** Everything an invoice's removal reads, and the writes it will make, for the caller's one commit. */
export interface StagedInvoiceRemoval {
  /** Null when there was no such invoice: nothing is to be written, as the store only warns. */
  invoice: InvoiceDoc | null;
  /** The stock numbers going back in stock. */
  restocked: string[];
  ledgerRows: number;
  /** The order's link, moved to its other invoice or cleared, for the caller to write or fold into its own change. */
  order: { id: string; invoiceId: string | null; patch: Record<string, unknown> } | null;
  /** Every other write: the pieces back in stock, the ledger rows, the invoice itself. */
  write: (b: BatchCtx) => void;
}

/**
 * The reads, and the writes staged. `editing` is the undo back to the order (the store's isEditing): its pieces
 * stay sold, being the order's, and no other invoice is looked for, the order being opened again.
 */
export async function stageInvoiceRemoval(
  db: DbPort, invoiceId: string, deps: InvoiceDeleteDeps, opts: { editing?: boolean } = {},
): Promise<StagedInvoiceRemoval> {
  const editing = opts.editing === true;
  const invoice = await db.get<InvoiceDoc>(INVOICES, invoiceId);
  if (!invoice) return { invoice: null, restocked: [], ledgerRows: 0, order: null, write: () => undefined };

  const orderId = invoice.sourceOrderId;
  // The other invoices are read only when a piece could go back.
  const restockable = !editing && invoiceLines(invoice.items).some(l => typeof l.sku === 'string' && l.sku && !l.sku.startsWith('ORD-'));
  const [rows, orderDoc, siblings, all] = await Promise.all([
    db.queryEquals(HISAAB, 'linkedInvoiceId', invoiceId),
    orderId ? db.get<{ invoiceId?: string }>(ORDERS, orderId).catch((): typeof UNREAD => UNREAD) : Promise.resolve(null),
    orderId && !editing ? db.queryEquals(INVOICES, 'sourceOrderId', orderId).catch(() => null) : Promise.resolve(null),
    restockable ? Promise.resolve(deps.invoices()) : Promise.resolve([]),
  ]);
  const back = editing ? [] : piecesBackInStock({ id: invoiceId, items: invoice.items }, all as { id: string; items?: SoldLine[] }[]);

  let order: StagedInvoiceRemoval['order'] = null;
  if (orderId && orderDoc !== null) {
    const other = siblings?.find(d => d.id !== invoiceId)?.id;
    const linked = typeof orderDoc === 'string' ? invoiceId : orderDoc.invoiceId;
    if (!linked || linked === invoiceId) order = { id: orderId, invoiceId: other ?? null, patch: { invoiceId: other ?? deps.deleteField() } };
  }

  return {
    invoice,
    restocked: back.map(l => l.sku!),
    ledgerRows: rows.length,
    order,
    write: (b) => {
      for (const l of back) {
        b.set(PRODUCTS, l.sku!, restockedProduct(l));
        b.delete(SOLD, l.sku!);
      }
      for (const r of rows) b.delete(HISAAB, r.id);
      b.delete(INVOICES, invoiceId);
    },
  };
}

/** The activity log's line for an invoice taken off the books (store.ts deleteInvoice). */
export function logInvoiceDeleted(fx: SideEffects, invoice: Pick<InvoiceDoc, 'id' | 'customerName'>) {
  void Promise.resolve(fx.log?.('invoice.delete', `Deleted invoice ${invoice.id}`, `Customer: ${invoice.customerName}`, invoice.id))
    .catch(() => undefined);
}

export async function deleteInvoice(
  db: DbPort,
  input: { invoiceId: string; syncShopify?: boolean },
  deps: InvoiceDeleteDeps,
  fx: InvoiceDeleteEffects = {},
): Promise<DeletedInvoice> {
  const { invoiceId, syncShopify = true } = input;
  const staged = await stageInvoiceRemoval(db, invoiceId, deps);
  const invoice = staged.invoice;
  if (!invoice) return { deleted: false, invoiceId, restocked: [], ledgerRows: 0 };

  const b = db.batch();
  staged.write(b);
  if (staged.order) b.set(ORDERS, staged.order.id, staged.order.patch, true);
  await b.commit();

  logInvoiceDeleted(fx, invoice);
  // A Shopify order's own invoice is Shopify's record, not a copy of one. The invoice is gone by now, so its
  // Shopify order is named rather than looked up from it.
  if (syncShopify && invoice.shopifyOrderId && !invoiceId.startsWith('SHOPIFY-')) {
    fx.shopify?.({ path: '/api/shopify/sync/invoice', body: { invoiceId, shopifyOrderId: String(invoice.shopifyOrderId), action: 'cancel' } });
  }

  return {
    deleted: true,
    invoiceId,
    customerName: invoice.customerName,
    restocked: staged.restocked,
    ledgerRows: staged.ledgerRows,
    ...(staged.order && { order: { id: staged.order.id, invoiceId: staged.order.invoiceId } }),
  };
}
