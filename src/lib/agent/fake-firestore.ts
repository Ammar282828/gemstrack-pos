/**
 * Tests only: an in-memory stand-in for the Admin SDK's Firestore, enough of it for the AI keys, the post
 * queue and the activity log (docs, collections, where/orderBy/limit, transactions, batches, getAll, dotted
 * update paths, FieldValue.increment as `{ __inc }`). Mock '@/lib/firebase-admin' with `{ adminDb: fake.db }`.
 */

type Doc = Record<string, unknown>;

const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));

function applyPatch(cur: Doc, patch: Doc): Doc {
  const out = clone(cur);
  for (const [k, v] of Object.entries(patch)) {
    const path = k.split('.');
    let at: Doc = out;
    for (const p of path.slice(0, -1)) at = (at[p] ??= {}) as Doc;
    const last = path[path.length - 1];
    const inc = v && typeof v === 'object' && '__inc' in (v as Doc) ? Number((v as Doc).__inc) : null;
    at[last] = inc !== null ? (Number(at[last]) || 0) + inc : clone(v);
  }
  return out;
}

export function fakeFirestore() {
  const data: Record<string, Record<string, Doc>> = {};
  let n = 0;
  const col = (c: string) => (data[c] ??= {});

  const snap = (c: string, id: string) => {
    const d = col(c)[id];
    return { id, exists: !!d, data: () => clone(d), get: (f: string) => (d ? (d as Doc)[f] : undefined), ref: docRef(c, id) };
  };

  function docRef(c: string, id?: string) {
    const key = id ?? `auto${String(++n).padStart(12, '0')}`;
    return {
      id: key, _c: c,
      get: async () => snap(c, key),
      set: async (d: Doc, o?: { merge?: boolean }) => { col(c)[key] = o?.merge ? applyPatch(col(c)[key] ?? {}, d) : clone(d); },
      update: async (d: Doc) => { if (!col(c)[key]) throw new Error(`NOT_FOUND ${c}/${key}`); col(c)[key] = applyPatch(col(c)[key], d); },
      delete: async () => { delete col(c)[key]; },
      // Firestore's create: refused (ALREADY_EXISTS, code 6) when the document is there.
      create: async (d: Doc) => { if (col(c)[key]) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }); col(c)[key] = clone(d); },
    };
  }
  type Ref = ReturnType<typeof docRef>;

  function query(c: string, filters: [string, string, unknown][] = [], order?: [string, 'asc' | 'desc'], max?: number) {
    const run = () => {
      let docs = Object.keys(col(c)).map(id => snap(c, id)).filter(s => filters.every(([f, op, v]) => {
        const x = (col(c)[s.id] as Doc)[f] as never;
        return op === '==' ? x === v : op === '<' ? x < (v as never) : op === '<=' ? x <= (v as never) : op === '>=' ? x >= (v as never) : op === '>' ? x > (v as never) : false;
      }));
      if (order) docs = docs.sort((a, b) => String((col(c)[a.id] as Doc)[order[0]] ?? '').localeCompare(String((col(c)[b.id] as Doc)[order[0]] ?? '')) * (order[1] === 'desc' ? -1 : 1));
      if (max !== undefined) docs = docs.slice(0, max);
      return { docs, size: docs.length, empty: !docs.length };
    };
    return {
      where: (f: string, op: string, v: unknown) => query(c, [...filters, [f, op, v]], order, max),
      orderBy: (f: string, dir: 'asc' | 'desc' = 'asc') => query(c, filters, [f, dir], max),
      limit: (m: number) => query(c, filters, order, m),
      select: () => query(c, filters, order, max),
      get: async () => run(),
    };
  }

  const db = {
    collection: (c: string) => ({
      doc: (id?: string) => docRef(c, id),
      add: async (d: Doc) => { const r = docRef(c); col(c)[r.id] = clone(d); return r; },
      ...query(c),
    }),
    doc: (path: string) => { const [c, id] = path.split('/'); return docRef(c, id); },
    getAll: async (...refs: Ref[]) => refs.map(r => snap(r._c, r.id)),
    batch: () => {
      const ops: (() => void)[] = [];
      return {
        set: (r: Ref, d: Doc, o?: { merge?: boolean }) => { ops.push(() => { col(r._c)[r.id] = o?.merge ? applyPatch(col(r._c)[r.id] ?? {}, d) : clone(d); }); },
        update: (r: Ref, d: Doc) => { ops.push(() => { col(r._c)[r.id] = applyPatch(col(r._c)[r.id] ?? {}, d); }); },
        delete: (r: Ref) => { ops.push(() => { delete col(r._c)[r.id]; }); },
        commit: async () => { ops.forEach(o => o()); },
      };
    },
    runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const ops: (() => void)[] = [];
      const tx = {
        get: async (r: Ref) => snap(r._c, r.id),
        set: (r: Ref, d: Doc, o?: { merge?: boolean }) => { ops.push(() => { col(r._c)[r.id] = o?.merge ? applyPatch(col(r._c)[r.id] ?? {}, d) : clone(d); }); },
        update: (r: Ref, d: Doc) => { ops.push(() => { col(r._c)[r.id] = applyPatch(col(r._c)[r.id] ?? {}, d); }); },
        delete: (r: Ref) => { ops.push(() => { delete col(r._c)[r.id]; }); },
        create: (r: Ref, d: Doc) => { if (col(r._c)[r.id]) throw Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }); ops.push(() => { col(r._c)[r.id] = clone(d); }); },
      };
      const out = await fn(tx);
      ops.forEach(o => o());
      return out;
    },
  };

  return { db, data, col, reset: () => { for (const k of Object.keys(data)) delete data[k]; n = 0; } };
}
