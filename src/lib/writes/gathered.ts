/**
 * Hundreds of the shared writes in one request (an import), sent as a few batches instead of hundreds of
 * round trips, so the request ends well inside the server's minute.
 *
 * Each shared write (people.ts `addKarigar`, `updateCustomer`, new-customer.ts …) runs on `port` exactly as it
 * runs anywhere: what it would commit is kept instead, as one unit, and `commit()` sends the units in batches
 * of up to 400 writes (Firestore takes 500). Reads go to the database itself. A write's activity log line is
 * held with its unit and written only once that unit has landed, so the log never names a change that failed.
 * A transaction or a direct write cannot be held, and says so rather than going round the batch.
 */

import type { BatchCtx, DbPort, SideEffects } from '@/lib/db-port';

type Log = NonNullable<SideEffects['log']>;
type Unit = { ops: ((b: BatchCtx) => void)[]; logs: Parameters<Log>[] };

export interface Gathered {
  port: DbPort;
  /** Hand this to the shared writes: their log lines wait for their change. */
  fx: SideEffects;
  /** Sends everything held, in order. `landed` counts the shared writes whose change is in the books. */
  commit(): Promise<{ landed: number }>;
}

const CHUNK = 400;

export function gather(db: DbPort, log?: Log, chunk = CHUNK): Gathered {
  const units: Unit[] = [];
  let last: Unit | null = null;
  const refuse = (what: string) => () => { throw new Error(`${what} cannot be gathered into a batch.`); };

  const port: DbPort = {
    runTransaction: refuse('A transaction') as DbPort['runTransaction'],
    queryEquals: (c, f, v) => db.queryEquals(c, f, v),
    get: (c, id) => db.get(c, id),
    add: refuse('A direct add') as DbPort['add'],
    update: refuse('A direct update') as DbPort['update'],
    newId: (c) => db.newId(c),
    timestamp: (d) => db.timestamp(d),
    serverTime: () => db.serverTime(),
    batch(): BatchCtx {
      const unit: Unit = { ops: [], logs: [] };
      return {
        set: (c, id, d, merge) => { unit.ops.push((b) => b.set(c, id, d, merge)); },
        update: (c, id, d) => { unit.ops.push((b) => b.update(c, id, d)); },
        delete: (c, id) => { unit.ops.push((b) => b.delete(c, id)); },
        commit: async () => { units.push(unit); last = unit; },
      };
    },
  };

  // The shared writes log just after their commit: the line belongs to the unit just held.
  const fx: SideEffects = { log: (...a) => { last?.logs.push(a); } };

  return {
    port,
    fx,
    async commit() {
      let landed = 0;
      let i = 0;
      while (i < units.length) {
        const group: Unit[] = [];
        let ops = 0;
        // A unit is never split across batches; one bigger than a batch goes alone.
        while (i < units.length && (group.length === 0 || ops + units[i].ops.length <= chunk)) {
          ops += units[i].ops.length;
          group.push(units[i]);
          i++;
        }
        const b = db.batch();
        for (const u of group) for (const op of u.ops) op(b);
        await b.commit();
        landed += group.length;
        if (log) for (const u of group) for (const l of u.logs) await Promise.resolve(log(...l)).catch(() => undefined);
      }
      return { landed };
    },
  };
}
