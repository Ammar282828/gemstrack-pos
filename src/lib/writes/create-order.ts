/**
 * Creating a custom order.
 *
 * The one copy, driven by either SDK — see lib/db-port.ts for why.
 *
 * Types are structural rather than imported from the store: the store imports
 * this, and importing the store back would close the circle.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';

const ORDERS = 'orders';
const CUSTOMERS = 'customers';
const SETTINGS = 'app_settings';
const SETTINGS_DOC = 'global';

/** The rate card stored on the order, so it prices the same way for ever. */
const RATE_FIELDS = [
  'goldRatePerGram18k', 'goldRatePerGram21k', 'goldRatePerGram22k', 'goldRatePerGram24k',
  'palladiumRatePerGram', 'platinumRatePerGram', 'silverRatePerGram',
] as const;

export interface OrderInput {
  items: { description?: string }[];
  customerId?: string;
  customerName?: string;
  customerContact?: string;
  source?: string;
  subtotal?: number;
  grandTotal?: number;
  /**
   * The rates this order was priced at, when the counter set them itself.
   *
   * Optional: left out, the shop's current rates are stamped on instead. Supplied,
   * they win — the rate showing on screen while the piece was being quoted is the
   * rate the customer was told, and the settings may have moved since.
   */
  ratesApplied?: Partial<Record<typeof RATE_FIELDS[number], number>>;
  [k: string]: unknown;
}

export interface CreateOrderDeps {
  /**
   * How this driver makes a customer. Supplied rather than done here because
   * each side already has one, and two ways of creating a customer is exactly
   * the duplication this file exists to avoid.
   */
  createCustomer: (c: { name: string; phone?: string }) => Promise<{ id: string; name: string } | null>;
  /** E.164 normalisation, so a number saved here matches one saved anywhere else. */
  normalizePhone?: (v?: string) => string | undefined;
  /** Firestore rejects undefined; both drivers already have a stripper.
   *  Constrained to objects because that is what the store's cleanObject takes. */
  clean: <T extends object>(o: T) => T;
}

export interface CreatedOrder extends Record<string, unknown> {
  id: string;
  customerName?: string;
  grandTotal: number;
  items: { description?: string }[];
}

export async function createOrder(
  db: DbPort,
  input: OrderInput,
  deps: CreateOrderDeps,
  fx: SideEffects = {},
): Promise<CreatedOrder> {
  const { createCustomer, normalizePhone = v => v, clean } = deps;

  // Resolving the customer WRITES, so it has to finish before the transaction
  // opens — Firestore forbids a write inside one from depending on a read
  // taken outside it, and both SDKs abort the whole thing if you try.
  let customerId = input.customerId;
  let customerName = input.customerName;

  if (!customerId && input.customerName) {
    const made = await createCustomer({ name: input.customerName, phone: input.customerContact });
    if (made) { customerId = made.id; customerName = made.name; }
  } else if (customerId) {
    const existing = await db.get<{ name?: string }>(CUSTOMERS, customerId);
    if (existing?.name) customerName = existing.name;
  } else if (!customerName && input.customerContact) {
    customerName = `Customer - ${input.customerContact}`;
  }

  // A per-order source wins; otherwise inherit whatever brought the customer in.
  let source = input.source;
  if (!source && customerId) {
    const c = await db.get<{ source?: string }>(CUSTOMERS, customerId);
    if (c?.source) source = c.source;
  }

  const subtotal = Number(input.subtotal) || 0;
  const grandTotal = Number(input.grandTotal) || 0;
  const descriptions = input.items.map(i => i.description).filter(Boolean) as string[];
  const summary = (input.items.length === 1 ? descriptions[0] : descriptions.join(', ')) || 'Custom order';
  const createdAt = new Date().toISOString();

  const order = await db.runTransaction<CreatedOrder>(async tx => {
    const settings = await tx.get<Record<string, number>>(SETTINGS, SETTINGS_DOC);
    if (!settings) throw new Error('Global settings not found.');

    const nextNumber = (Number(settings.lastOrderNumber) || 0) + 1;
    const id = `ORD-${String(nextNumber).padStart(6, '0')}`;

    // The counter can drift — an import, a restore, a half-finished write —
    // and silently overwriting a real order is far worse than refusing.
    const clash = await tx.get(ORDERS, id);
    if (clash) throw new Error(`Order ID ${id} already exists. lastOrderNumber may be out of sync.`);

    /**
     * Stamp the rates onto the order, so it prices the same in June as it did in March.
     *
     * A rate sent with the order wins over the shop's current one. Without that, a rate
     * typed at the counter was accepted by the form and then silently replaced by
     * whatever Settings happened to hold at the instant of the write — the customer is
     * quoted one figure and the book records another, and nothing anywhere says so.
     * Each karat falls back on its own, so sending one does not blank the rest.
     */
    const supplied = input.ratesApplied ?? {};
    const ratesApplied: Record<string, number> = {};
    for (const f of RATE_FIELDS) {
      const given = Number(supplied[f]);
      ratesApplied[f] = Number.isFinite(given) && given > 0 ? given : settings[f];
    }

    const doc = {
      ...input,
      id,
      customerId,
      customerName,
      customerContact: input.customerContact ? normalizePhone(input.customerContact) : input.customerContact,
      source,
      subtotal,
      grandTotal,
      createdAt,
      status: 'Pending',
      summary,
      ratesApplied,
    } as CreatedOrder;

    // Firestore rejects undefined and aborts the transaction, which is how
    // walk-in orders with no customer used to fail to save without a word.
    tx.set(ORDERS, id, clean(doc) as Record<string, unknown>);
    tx.update(SETTINGS, SETTINGS_DOC, { lastOrderNumber: nextNumber });
    return doc;
  });

  await fx.log?.(
    'order.create',
    `Created order: ${order.id}`,
    `Customer: ${customerName || 'Walk-in'} | Total: ${grandTotal.toLocaleString()}`,
    order.id,
  );
  fx.notify?.(
    `*New Order* ${order.id}\n` +
    `Customer: ${customerName || 'Walk-in'}\n` +
    `Items: ${descriptions.join(', ') || 'Item'}\n` +
    `Total: PKR ${grandTotal.toLocaleString()}`,
  );

  return order;
}
