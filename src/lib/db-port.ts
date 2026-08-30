/**
 * The small slice of Firestore the money logic actually uses.
 *
 * Written so a transaction can be expressed once and run by either SDK: the
 * client's, in the browser, for owners; the Admin SDK, on the server, for shop
 * floor staff who have no database access of their own.
 *
 * The alternative was mirroring each operation server-side, which means two
 * copies of the till. Everything that went wrong in this codebase recently came
 * from that shape — four copies of the PDF chrome, two order-slip builders, a
 * payment-status function pasted into two pages that disagreed with itself, an
 * advance subtracted twice because one of the copies was not updated. Being
 * wrong in two places is bad enough in a document; in the takings it is money.
 *
 * Deliberately minimal. This is not a Firestore abstraction and should not grow
 * into one: it covers what the extracted operations need and nothing else, so
 * both adapters stay small enough to read in one sitting.
 */

export interface TxCtx {
  /** Null when the document does not exist. */
  get<T = Record<string, unknown>>(collection: string, id: string): Promise<(T & { id: string }) | null>;
  set(collection: string, id: string, data: Record<string, unknown>, merge?: boolean): void;
  update(collection: string, id: string, data: Record<string, unknown>): void;
  delete(collection: string, id: string): void;
}

export interface BatchCtx {
  set(collection: string, id: string, data: Record<string, unknown>, merge?: boolean): void;
  update(collection: string, id: string, data: Record<string, unknown>): void;
  delete(collection: string, id: string): void;
  commit(): Promise<void>;
}

export interface DbPort {
  /**
   * Firestore forbids reads after writes inside a transaction, on both SDKs,
   * so every extracted operation reads first. That constraint is the reason
   * they are shaped the way they are.
   */
  runTransaction<T>(fn: (tx: TxCtx) => Promise<T>): Promise<T>;

  /** Single-field equality only — enough to avoid needing composite indexes. */
  queryEquals<T = Record<string, unknown>>(
    collection: string, field: string, value: unknown,
  ): Promise<(T & { id: string })[]>;

  get<T = Record<string, unknown>>(collection: string, id: string): Promise<(T & { id: string }) | null>;
  add(collection: string, data: Record<string, unknown>): Promise<string>;
  update(collection: string, id: string, data: Record<string, unknown>): Promise<void>;
  batch(): BatchCtx;
  /** A fresh document id without writing anything. */
  newId(collection: string): string;
}

/**
 * Things the operations need that are not database writes: the activity log,
 * Shopify mirroring, WhatsApp. Passed in rather than imported so the server
 * path can supply its own, or none.
 */
export interface SideEffects {
  log?: (action: string, title: string, detail: string, relatedId?: string) => void | Promise<void>;
  syncInvoiceShopify?: (invoiceId: string, mode: 'upsert' | 'cancel') => void;
  notify?: (message: string) => void;
}
