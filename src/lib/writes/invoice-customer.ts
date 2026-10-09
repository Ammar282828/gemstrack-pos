/**
 * Who a saved sale was for, set on the invoice itself (decision "Name a sale", 2026-10-04): the invoice's
 * "Name them / Change" (components/invoice/set-customer-dialog.tsx). The one copy, for the browser's store
 * (`setInvoiceCustomer`, on the client SDK) and the iPhone app (/api/app/write, ops-invoices.ts, on the
 * Admin SDK).
 *
 * A quarter of invoices were re-saved after the sale, a quarter of those only to change who it was for: a
 * walk-in named once the bill was out (lib/walk-in.ts). A full edit re-priced every piece to change one name.
 * This changes the name, the customer and the ledger line it owes on, nothing else:
 * - a customer picked from the book is that customer, under the name on file; one no longer on file, or a
 *   name typed, is a new customer, made here (no `id` field, no log line of its own, as the store makes it);
 * - the invoice takes the customer, their name and, when one is given, the number;
 * - every hisaab row linked to the invoice moves to them, so what is still owed is on their hisaab now.
 * Nothing is re-priced. The lock is the caller's to check (the store, and the write route, refuse first).
 *
 * `cleanInvoiceCustomer` is the phone's door: the dialog's fields read from a body nobody has checked.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Invoice } from '@/lib/store';
import { isWalkInName } from '@/lib/walk-in';
import { normalizePhoneNumber } from '@/lib/utils';

const INVOICES = 'invoices';
const CUSTOMERS = 'customers';
const HISAAB = 'hisaab';

/** The dialog's `who`: a customer picked (their id), or a name typed, and the number if any. */
export interface InvoiceCustomerInput {
  customerId?: string;
  name: string;
  phone?: string;
}

export type CleanedWho = { ok: true; who: InvoiceCustomerInput } | { ok: false; error: string };

/** The store's refusal, word for word, so the phone and the browser say the same. */
export const NAME_NEEDED = 'Type the customer’s name, or pick them from the list.';

/** A person's name and a number are short: a paste gone wrong is refused, not stored. */
const MAX_NAME = 200;
const MAX_PHONE = 40;

/**
 * The dialog's fields, checked: a name (not the walk-in placeholder), the picked customer's id, and the
 * number, kept as the dialog's phone box keeps it (E.164, +92 by default). Anything else posted is dropped.
 */
export function cleanInvoiceCustomer(input: unknown): CleanedWho {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: NAME_NEEDED };
  const src = input as Record<string, unknown>;
  if (typeof src.name !== 'string') return { ok: false, error: NAME_NEEDED };
  const name = src.name.trim();
  if (!name || isWalkInName(name)) return { ok: false, error: NAME_NEEDED };
  if (name.length > MAX_NAME) return { ok: false, error: 'That name is too long.' };

  let customerId: string | undefined;
  if (src.customerId !== undefined && src.customerId !== null) {
    if (typeof src.customerId !== 'string') return { ok: false, error: 'The customer must be one from the book.' };
    const id = src.customerId.trim();
    if (id.length > 200 || id.includes('/')) return { ok: false, error: 'The customer must be one from the book.' };
    if (id) customerId = id;
  }

  let phone: string | undefined;
  if (src.phone !== undefined && src.phone !== null) {
    if (typeof src.phone !== 'string') return { ok: false, error: 'Phone number must be text.' };
    const p = src.phone.trim();
    if (p.length > MAX_PHONE) return { ok: false, error: 'That phone number is too long.' };
    if (p) phone = normalizePhoneNumber(p);
  }

  return { ok: true, who: { name, ...(customerId && { customerId }), ...(phone && { phone }) } };
}

type LinkedRow = { id: string };

/**
 * Set who the invoice was for. Returns the invoice as it now stands. Throws `NAME_NEEDED` for a blank or
 * walk-in name, and "Invoice <id> not found." for an invoice not on file (nothing is written either way).
 */
export async function setInvoiceCustomer(
  db: DbPort,
  invoiceId: string,
  who: InvoiceCustomerInput,
  fx: SideEffects = {},
  opts: { newCustomerId?: () => string } = {},
): Promise<Invoice> {
  const name = who.name.trim();
  if (!name || isWalkInName(name)) throw new Error(NAME_NEEDED);
  const phone = who.phone?.trim() || '';
  const newCustomerId = opts.newCustomerId ?? (() => `cust-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);

  // The ledger rows are found first, as the store has it: Firestore reads them outside the transaction.
  const linked = await db.queryEquals<LinkedRow>(HISAAB, 'linkedInvoiceId', invoiceId);

  const out = await db.runTransaction(async (tx) => {
    const inv = await tx.get<Omit<Invoice, 'id'>>(INVOICES, invoiceId);
    if (!inv) throw new Error(`Invoice ${invoiceId} not found.`);
    let customerId = who.customerId || undefined;
    let customerName = name;
    if (customerId) {
      const c = await tx.get<{ name?: string }>(CUSTOMERS, customerId);
      // Picked from the book: the name on file. Gone since: a new customer, as if typed.
      if (c) customerName = c.name || name; else customerId = undefined;
    }
    if (!customerId) {
      customerId = newCustomerId();
      tx.set(CUSTOMERS, customerId, { name, phone, address: '', email: '' });
    }
    const patch = { customerId, customerName, ...(phone ? { customerContact: phone } : {}) };
    tx.update(INVOICES, invoiceId, patch);
    for (const row of linked) tx.update(HISAAB, row.id, { entityId: customerId, entityName: customerName, entityType: 'customer' });
    return { before: inv.customerName || 'Walk-in', invoice: { ...inv, ...patch, id: invoiceId } as Invoice };
  });

  // The log is a record, not part of the change: it never holds the counter up.
  void Promise.resolve(fx.log?.('invoice.update', `Customer set on invoice ${invoiceId}`, `${out.before} → ${out.invoice.customerName}`, invoiceId))
    .catch(() => undefined);
  fx.syncInvoiceShopify?.(invoiceId, 'upsert');
  return out.invoice;
}
