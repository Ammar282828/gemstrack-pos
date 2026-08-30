/** DbPort over the client SDK, for owners working in the browser. */

import {
  doc, collection, getDoc, getDocs, query, where, addDoc, updateDoc,
  runTransaction, writeBatch,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { DbPort, TxCtx, BatchCtx } from '@/lib/db-port';

// Both SDKs type set/update more narrowly than Record<string, unknown>.
// The cast is contained to these two adapters; the port stays honest.
const wr = (d: Record<string, unknown>) => d as never;

const ref = (c: string, id: string) => doc(db, c, id);

export const clientPort: DbPort = {
  async runTransaction(fn) {
    return runTransaction(db, async t => {
      const tx: TxCtx = {
        async get(c, id) {
          const s = await t.get(ref(c, id));
          return s.exists() ? ({ ...s.data(), id: s.id } as never) : null;
        },
        set: (c, id, data, merge) => { t.set(ref(c, id), wr(data), { merge: merge ?? false }); },
        update: (c, id, data) => { t.update(ref(c, id), wr(data)); },
        delete: (c, id) => { t.delete(ref(c, id)); },
      };
      return fn(tx);
    });
  },
  async queryEquals(c, field, value) {
    const snap = await getDocs(query(collection(db, c), where(field, '==', value)));
    return snap.docs.map(d => ({ ...d.data(), id: d.id })) as never;
  },
  async get(c, id) {
    const s = await getDoc(ref(c, id));
    return s.exists() ? ({ ...s.data(), id: s.id } as never) : null;
  },
  async add(c, data) { return (await addDoc(collection(db, c), wr(data))).id; },
  async update(c, id, data) { await updateDoc(ref(c, id), wr(data)); },
  batch(): BatchCtx {
    const b = writeBatch(db);
    return {
      set: (c, id, data, merge) => { b.set(ref(c, id), wr(data), { merge: merge ?? false }); },
      update: (c, id, data) => { b.update(ref(c, id), wr(data)); },
      delete: (c, id) => { b.delete(ref(c, id)); },
      commit: async () => { await b.commit(); },
    };
  },
  newId: (c) => doc(collection(db, c)).id,
};
