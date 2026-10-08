/**
 * Things given out of the shop (a sample to a karigar, a piece to a customer to try) and their
 * return: the one copy, for the browser (store.ts) and the iPhone app (/api/app/write).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { GivenItem } from '@/lib/store';
import { cleanObject } from './create-invoice';

const GIVEN = 'given_items';

const log = (fx: SideEffects, a: string, t: string, d: string, id: string) =>
  void Promise.resolve(fx.log?.(a, t, d, id)).catch(() => undefined);

export async function addGivenItem(db: DbPort, data: Omit<GivenItem, 'id'>, fx: SideEffects = {}): Promise<GivenItem> {
  // An unlinked recipient arrives as recipientId: undefined, which Firestore refuses.
  const id = await db.add(GIVEN, cleanObject(data) as unknown as Record<string, unknown>);
  log(fx, 'given.create', `Given item: ${data.description}`, `To: ${data.recipientName}`, id);
  return { id, ...data };
}

export async function markGivenItemReturned(db: DbPort, id: string, returnedDate: string, item?: Pick<GivenItem, 'description' | 'recipientName'> | null, fx: SideEffects = {}): Promise<void> {
  const b = db.batch();
  b.set(GIVEN, id, { status: 'returned', returnedDate }, true);
  await b.commit();
  log(fx, 'given.returned', `Item returned: ${item?.description || id}`, `From: ${item?.recipientName || ''}`, id);
}
