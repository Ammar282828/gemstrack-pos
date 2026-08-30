/** DbPort over the Admin SDK, for the server-side staff write path. */

import { adminDb } from '@/lib/firebase-admin';
import type { DbPort, TxCtx, BatchCtx } from '@/lib/db-port';

// Both SDKs type set/update more narrowly than Record<string, unknown>.
// The cast is contained to these two adapters; the port stays honest.
const wr = (d: Record<string, unknown>) => d as never;

const ref = (c: string, id: string) => adminDb.collection(c).doc(id);

export const adminPort: DbPort = {
  async runTransaction(fn) {
    return adminDb.runTransaction(async t => {
      const tx: TxCtx = {
        async get(c, id) {
          const s = await t.get(ref(c, id));
          return s.exists ? ({ ...s.data(), id: s.id } as never) : null;
        },
        set: (c, id, data, merge) => { t.set(ref(c, id), wr(data), { merge: merge ?? false }); },
        update: (c, id, data) => { t.update(ref(c, id), wr(data)); },
        delete: (c, id) => { t.delete(ref(c, id)); },
      };
      return fn(tx);
    });
  },
  async queryEquals(c, field, value) {
    const snap = await adminDb.collection(c).where(field, '==', value).get();
    return snap.docs.map(d => ({ ...d.data(), id: d.id })) as never;
  },
  async get(c, id) {
    const s = await ref(c, id).get();
    return s.exists ? ({ ...s.data(), id: s.id } as never) : null;
  },
  async add(c, data) { return (await adminDb.collection(c).add(wr(data))).id; },
  async update(c, id, data) { await ref(c, id).update(wr(data)); },
  batch(): BatchCtx {
    const b = adminDb.batch();
    return {
      set: (c, id, data, merge) => { b.set(ref(c, id), wr(data), { merge: merge ?? false }); },
      update: (c, id, data) => { b.update(ref(c, id), wr(data)); },
      delete: (c, id) => { b.delete(ref(c, id)); },
      commit: async () => { await b.commit(); },
    };
  },
  newId: (c) => adminDb.collection(c).doc().id,
};
