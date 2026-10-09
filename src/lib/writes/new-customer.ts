/**
 * A new customer as the store makes one (store.ts `addCustomer`): an id of `cust-` and the time, the name
 * (or "Unnamed Customer"), the number in E.164 (+92 by default) and an empty email and address, and nothing
 * else. The one copy of that shape for the imports the iPhone app runs on the server (ops-settings2.ts);
 * the store's `addCustomer` and /api/app/write's `addCustomer` write the same document and can call this.
 *
 * Surprising, and kept: what the import pages hand the store besides (the contact's spare number, its TJ/HOM/TC
 * tags, a country) is dropped by `addCustomer` today, so it is dropped here too. Keeping it is one change, here
 * and in the store together.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Customer } from '@/lib/store';
import { normalizePhoneNumber } from '@/lib/utils';

export type NewCustomerInput = { name?: string; phone?: string | null; email?: string; address?: string };

export function newCustomerDoc(input: NewCustomerInput, id: string): Customer {
  return {
    id,
    name: input.name || 'Unnamed Customer',
    phone: normalizePhoneNumber(input.phone ?? undefined) || '',
    email: input.email || '',
    address: input.address || '',
  };
}

/**
 * Ids for customers made in one go: `cust-<ms>` as the store's, one millisecond apart so none share a time,
 * and never one already on file (`taken`).
 */
export function customerIdMaker(taken: Iterable<string>, now: () => number = Date.now): () => string {
  const used = new Set(taken);
  let last = 0;
  return () => {
    let t = Math.max(now(), last + 1);
    while (used.has(`cust-${t}`)) t++;
    last = t;
    const id = `cust-${t}`;
    used.add(id);
    return id;
  };
}

/** The customer written under `id`, and logged as the store logs one. */
export async function addCustomerDoc(db: DbPort, input: NewCustomerInput, id: string, fx: SideEffects = {}): Promise<Customer> {
  const customer = newCustomerDoc(input, id);
  const b = db.batch();
  b.set('customers', id, customer as unknown as Record<string, unknown>);
  await b.commit();
  void Promise.resolve(fx.log?.('customer.create', `Created customer: ${customer.name}`, `ID: ${id}`, id)).catch(() => undefined);
  return customer;
}
