/**
 * Settings → Recently removed (src/app/settings/recently-removed/page.tsx; store.ts restoreCustomer,
 * restoreKarigar, purgeRemoved): the one copy of putting a removed customer or karigar back, and of
 * emptying the list, for the iPhone app (/api/app/write) and for the store when it takes them up.
 *
 * Removing someone only hides them (`deletedAt`); their ledger, orders and invoices stay where they are,
 * still pointing at the same id, so putting one back restores a whole account. Emptying is the one thing
 * in the ERP that destroys a record: it asks for the delete code (the caller checks it), and only a record
 * that is removed now is ever deleted, whatever ids are sent, so a live customer cannot go this way.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';

const CUSTOMERS = 'customers';
const KARIGARS = 'karigars';
/** Well under Firestore's 500 writes to a batch. */
const CHUNK = 450;

const log = (fx: SideEffects, a: string, t: string, d: string, id?: string) =>
  void Promise.resolve(fx.log?.(a, t, d, id)).catch(() => undefined);

type Person = { name?: string; deletedAt?: unknown };
type Found = { collection: string; id: string; name: string; kind: 'customer' | 'karigar' };

/** The ids that are on file and removed now, in the order sent, each once. */
async function removedOnFile(db: DbPort, customerIds: string[], karigarIds: string[]): Promise<Found[]> {
  const asked: { collection: string; id: string; kind: 'customer' | 'karigar' }[] = [
    ...[...new Set(customerIds)].map(id => ({ collection: CUSTOMERS, id, kind: 'customer' as const })),
    ...[...new Set(karigarIds)].map(id => ({ collection: KARIGARS, id, kind: 'karigar' as const })),
  ];
  const docs = await Promise.all(asked.map(a => db.get<Person>(a.collection, a.id)));
  return asked.flatMap((a, i) => {
    const d = docs[i];
    return d && d.deletedAt ? [{ ...a, name: d.name || a.id }] : [];
  });
}

async function commitChunked(db: DbPort, items: Found[], write: (b: ReturnType<DbPort['batch']>, f: Found) => void) {
  for (let i = 0; i < items.length; i += CHUNK) {
    const b = db.batch();
    items.slice(i, i + CHUNK).forEach(f => write(b, f));
    await b.commit();
  }
}

/**
 * Put removed customers and karigars back. `deleteField` is the SDK's own field-removal value
 * (the store writes `deletedAt: deleteField()`), passed in so this stays free of either SDK.
 */
export async function restoreRemoved(
  db: DbPort, input: { customerIds: string[]; karigarIds: string[] }, deps: { deleteField: () => unknown }, fx: SideEffects = {},
): Promise<{ customers: string[]; karigars: string[] }> {
  const found = await removedOnFile(db, input.customerIds, input.karigarIds);
  await commitChunked(db, found, (b, f) => b.update(f.collection, f.id, { deletedAt: deps.deleteField() }));
  for (const f of found) {
    if (f.kind === 'customer') log(fx, 'customer.update', `Restored customer: ${f.name}`, `ID: ${f.id}`, f.id);
    else log(fx, 'karigar.update', `Restored karigar: ${f.name}`, `ID: ${f.id}`, f.id);
  }
  return {
    customers: found.filter(f => f.kind === 'customer').map(f => f.id),
    karigars: found.filter(f => f.kind === 'karigar').map(f => f.id),
  };
}

/** Empty Recently removed for good: the removed customers and karigars named, deleted. */
export async function purgeRemoved(
  db: DbPort, input: { customerIds: string[]; karigarIds: string[] }, fx: SideEffects = {},
): Promise<{ customers: number; karigars: number }> {
  const found = await removedOnFile(db, input.customerIds, input.karigarIds);
  await commitChunked(db, found, (b, f) => b.delete(f.collection, f.id));
  const customers = found.filter(f => f.kind === 'customer').length;
  const karigars = found.length - customers;
  if (customers || karigars) {
    log(fx, 'customer.delete', `Permanently deleted ${customers} customer(s) and ${karigars} karigar(s)`, 'Emptied Recently removed', 'recently-removed');
  }
  return { customers, karigars };
}
