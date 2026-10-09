/**
 * Removing a customer, and merging a duplicate into the customer who stays (store.ts `deleteCustomer`,
 * `mergeCustomers`; the Customers page's Remove and "Merge duplicates"): the one copy, for the iPhone app
 * (/api/app/write, ops-customers.ts) on the Admin SDK. The caller has already checked the delete code.
 *
 * - Removing hides a customer (`deletedAt`); their invoices, orders and hisaab stay where they are, still
 *   pointing at their id, and Settings > Recently removed puts them back.
 * - Merging moves everything of the duplicate to the customer kept: its invoices, orders and repair tickets
 *   get the kept customer's id and name, its hisaab rows (the customer's own) the kept id and name, its
 *   given items the kept id and name; then the duplicate's record is deleted for good. Until 2026-10-09 the
 *   store left repairs behind (a ticket kept the deleted id and fell off the kept customer's page) and lost
 *   whatever only the duplicate knew: now the kept record takes each detail it has no value for (a phone,
 *   an address, a ring size), and the duplicate's other number goes in the spare slot (`altPhone`) when
 *   that is free. Nothing the kept record already says is overwritten.
 *   The duplicate's record goes last, so a merge that stops half way can be run again: what is left is
 *   still found under the duplicate's id.
 *
 * The store's mergeCustomers runs this on the browser's port, so the page and the phone merge alike.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';

const CUSTOMERS = 'customers';
const INVOICES = 'invoices';
const ORDERS = 'orders';
const HISAAB = 'hisaab';
const GIVEN_ITEMS = 'given_items';
const REPAIRS = 'repairs';
/** Well under Firestore's 500 writes to a batch (the store uses 490). */
const CHUNK = 450;

const log = (fx: SideEffects, a: string, t: string, d: string, id: string) =>
  void Promise.resolve(fx.log?.(a, t, d, id)).catch(() => undefined);

/** A request the ERP refuses in words (not a crash): the caller answers it with a 409. */
export class CustomerRefusal extends Error {}

type Person = { name?: string; deletedAt?: unknown; [field: string]: unknown };

/** What a merge moves, by kind: the numbers the phone confirms before it asks for the code. */
export type MergeCounts = { invoices: number; orders: number; hisaab: number; given: number; repairs: number };

export type MergePlan = {
  keep: { id: string; name: string };
  duplicate: { id: string; name: string };
  invoices: string[];
  orders: string[];
  hisaab: string[];
  given: string[];
  repairs: string[];
  /** What the kept record takes from the duplicate: only details it has no value for. */
  fill: Record<string, unknown>;
};

const nameOf = (c: Person, id: string) => c.name || id;

/** A live customer on file (not removed), as the store's `customers` list holds them. */
async function liveCustomer(db: DbPort, id: string): Promise<(Person & { id: string }) | null> {
  const c = await db.get<Person>(CUSTOMERS, id);
  return c && !c.deletedAt ? c : null;
}

/** Fields that belong to the record itself, never carried from one customer to another. */
const OWN_FIELDS = new Set(['id', 'name', 'deletedAt', 'createdAt', 'updatedAt', 'shopifyCustomerId']);
const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && !v.trim());
/** A number as its last ten digits, so +92 300…, 0300… and 300… are one phone. */
const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '').slice(-10) : '');

/**
 * What the kept customer learns from the duplicate: each detail the kept record leaves blank, and the
 * duplicate's number in the spare slot when the two numbers differ and the slot is free.
 */
export function mergeFill(keep: Person, duplicate: Person): Record<string, unknown> {
  const fill: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(duplicate)) {
    if (OWN_FIELDS.has(k) || blank(v) || !blank(keep[k])) continue;
    fill[k] = v;
  }
  const kept = digits(keep.phone);
  const other = digits(duplicate.phone);
  if (kept && other && kept !== other && blank(keep.altPhone)) fill.altPhone = duplicate.phone;
  // The spare slot never repeats the main number.
  if (fill.altPhone !== undefined && digits(fill.altPhone) === digits(keep.phone ?? fill.phone)) delete fill.altPhone;
  return fill;
}

/** Hide a customer: `deletedAt` set to now, their history left exactly where it is. */
export async function removeCustomer(
  db: DbPort, id: string, fx: SideEffects = {}, opts: { now?: Date } = {},
): Promise<{ id: string; name: string; deletedAt: string }> {
  const c = await db.get<Person>(CUSTOMERS, id);
  if (!c) throw new CustomerRefusal('No such customer.');
  const name = nameOf(c, id);
  if (c.deletedAt) throw new CustomerRefusal(`${name} has already been removed.`);
  const deletedAt = (opts.now ?? new Date()).toISOString();
  await db.update(CUSTOMERS, id, { deletedAt });
  log(fx, 'customer.delete', `Removed customer: ${name}`, `ID: ${id}`, id);
  return { id, name, deletedAt };
}

/** Everything a merge would move, found and not touched: the two customers and the ids of what follows the duplicate. */
export async function planCustomerMerge(db: DbPort, keepId: string, deleteId: string): Promise<MergePlan> {
  if (keepId === deleteId) throw new CustomerRefusal('Choose two different customers.');
  const [keep, duplicate] = await Promise.all([liveCustomer(db, keepId), liveCustomer(db, deleteId)]);
  // The store's own words.
  if (!keep || !duplicate) throw new CustomerRefusal('One or both customers not found');
  const [invoices, orders, hisaab, given, repairs] = await Promise.all([
    db.queryEquals(INVOICES, 'customerId', deleteId),
    db.queryEquals(ORDERS, 'customerId', deleteId),
    db.queryEquals<{ entityType?: string }>(HISAAB, 'entityId', deleteId),
    db.queryEquals(GIVEN_ITEMS, 'recipientId', deleteId),
    db.queryEquals(REPAIRS, 'customerId', deleteId),
  ]);
  return {
    keep: { id: keepId, name: nameOf(keep, keepId) },
    duplicate: { id: deleteId, name: nameOf(duplicate, deleteId) },
    invoices: invoices.map((d) => d.id),
    orders: orders.map((d) => d.id),
    // A karigar could never share a customer's id, but the store asks for the customer's own rows only.
    hisaab: hisaab.filter((d) => d.entityType === 'customer').map((d) => d.id),
    given: given.map((d) => d.id),
    repairs: repairs.map((d) => d.id),
    fill: mergeFill(keep, duplicate),
  };
}

export const mergeCounts = (p: MergePlan): MergeCounts =>
  ({ invoices: p.invoices.length, orders: p.orders.length, hisaab: p.hisaab.length, given: p.given.length, repairs: p.repairs.length });

/** Merge `deleteId` into `keepId` and delete the duplicate. Returns what was moved. */
export async function mergeCustomers(
  db: DbPort, keepId: string, deleteId: string, fx: SideEffects = {},
): Promise<MergeCounts & { updatedDocs: number; keptId: string; deletedId: string; filled: string[] }> {
  const plan = await planCustomerMerge(db, keepId, deleteId);
  const { name } = plan.keep;

  const writes: ((b: ReturnType<DbPort['batch']>) => void)[] = [];
  for (const id of plan.invoices) writes.push((b) => b.update(INVOICES, id, { customerId: keepId, customerName: name }));
  for (const id of plan.orders) writes.push((b) => b.update(ORDERS, id, { customerId: keepId, customerName: name }));
  for (const id of plan.hisaab) writes.push((b) => b.update(HISAAB, id, { entityId: keepId, entityName: name }));
  for (const id of plan.given) writes.push((b) => b.update(GIVEN_ITEMS, id, { recipientId: keepId, recipientName: name }));
  for (const id of plan.repairs) writes.push((b) => b.update(REPAIRS, id, { customerId: keepId, customerName: name }));
  const updatedDocs = writes.length;
  if (Object.keys(plan.fill).length) writes.push((b) => b.update(CUSTOMERS, keepId, plan.fill));
  // The duplicate's record last.
  writes.push((b) => b.delete(CUSTOMERS, deleteId));

  for (let i = 0; i < writes.length; i += CHUNK) {
    const b = db.batch();
    writes.slice(i, i + CHUNK).forEach((w) => w(b));
    await b.commit();
  }

  log(fx, 'customer.delete', `Merged customer "${plan.duplicate.name}" into "${name}"`,
    `Deleted ID: ${deleteId}, Kept ID: ${keepId}, Updated ${updatedDocs} records`, keepId);
  return { ...mergeCounts(plan), updatedDocs, keptId: keepId, deletedId: deleteId, filled: Object.keys(plan.fill) };
}
