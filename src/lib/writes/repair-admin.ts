/**
 * Editing and deleting a repair ticket (src/app/repairs/page.tsx: the form's Save on a ticket, and Delete;
 * store.ts updateRepair, deleteRepair): the one copy, for the iPhone app (/api/app/write) and for the store
 * when it takes them up. Taking a ticket in, moving it on and taking money stay in ./repairs.ts.
 *
 * An edit changes what the form shows (the customer, the pieces, ready-by, the karigar, taken by and the
 * shop's note) and nothing else: the money taken, the status and its stamps, the number and when it came in
 * are the ticket's history. A field the form left empty is removed, as the store's merge with deleteField
 * does, where a plain merge would quietly keep the old karigar or ready-by date.
 *
 * Deleting takes the money taken on the ticket out of Extra Revenue with it, in one commit (decision
 * "Repairs"): each row a payment wrote (its revenueId) and any other row that names the ticket (repairId),
 * so no row is left that Extra revenue refuses to delete ("Change this on the repair") for a ticket that is
 * gone. The caller checks the delete code first (lib/delete-code-gate.ts).
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Repair, RepairPiece } from '@/lib/store';
import { repairSummary } from '@/lib/repairs';

const REPAIRS = 'repairs';
const REVENUE = 'additional_revenue';

const log = (fx: SideEffects, a: string, t: string, d: string, id: string) =>
  void Promise.resolve(fx.log?.(a, t, d, id)).catch(() => undefined);

/** What the form edits on a ticket. Undefined is "left empty": the field is removed. */
export interface RepairEdit {
  /** '' is a walk-in: the screens say the word, nothing writes it. */
  customerName: string;
  customerId?: string;
  customerContact?: string;
  /** At least one, cleaned as the form keeps them (`repairPiecesFrom`). */
  pieces: RepairPiece[];
  /** yyyy-MM-dd. */
  promisedDate?: string;
  karigarId?: string;
  karigarName?: string;
  takenBy?: string;
  internalNote?: string;
}

/** The fields an edit writes, every one of them each time, as the form sends them. */
export const REPAIR_EDIT_FIELDS = [
  'customerName', 'customerId', 'customerContact', 'pieces', 'promisedDate',
  'karigarId', 'karigarName', 'takenBy', 'internalNote',
] as const satisfies readonly (keyof RepairEdit)[];

/**
 * The form's pieces as it saves them: the words trimmed, a weight or price only when it is more than 0,
 * a line with neither piece nor work dropped, and a line with only the work called "Piece".
 */
export function repairPiecesFrom(pieces: { item?: string; work?: string; weightG?: number; price?: number }[]): RepairPiece[] {
  return pieces
    .map((p) => ({
      item: (p.item || '').trim(), work: (p.work || '').trim(),
      ...(p.weightG && p.weightG > 0 ? { weightG: p.weightG } : {}),
      ...(p.price && p.price > 0 ? { price: p.price } : {}),
    }))
    .filter((p) => p.item || p.work)
    .map((p) => ({ ...p, item: p.item || 'Piece' }));
}

/**
 * Save the form over a ticket. `deleteField` is the SDK's own field-removal value (the store writes
 * `deleteField()`), passed in so this stays free of either SDK. Answers with the ticket as it now is.
 */
export async function updateRepair(
  db: DbPort, id: string, edit: RepairEdit, deps: { deleteField: () => unknown }, fx: SideEffects = {},
): Promise<Repair> {
  if (!edit.pieces.length) throw new Error('A repair needs at least one piece.');
  const saved = await db.runTransaction(async (tx) => {
    const repair = await tx.get<Repair>(REPAIRS, id);
    if (!repair) throw new Error('No such repair.');
    const patch: Record<string, unknown> = {};
    const after: Record<string, unknown> = { ...repair };
    for (const key of REPAIR_EDIT_FIELDS) {
      const v = edit[key];
      if (v === undefined) {
        patch[key] = deps.deleteField();
        delete after[key];
      } else {
        patch[key] = v;
        after[key] = v;
      }
    }
    tx.set(REPAIRS, id, patch, true);
    return after as unknown as Repair;
  });
  log(fx, 'repair.update', `Repair ${id} updated`, repairSummary({ pieces: edit.pieces }), id);
  return saved;
}

/** Delete a ticket, and the money taken on it out of Extra Revenue, in one commit. */
export async function deleteRepair(db: DbPort, id: string, fx: SideEffects = {}): Promise<{ repairId: string; revenueIds: string[] }> {
  const repair = await db.get<Repair>(REPAIRS, id);
  if (!repair) throw new Error('No such repair.');
  const payments = Array.isArray(repair.payments) ? repair.payments : [];
  const naming = await db.queryEquals(REVENUE, 'repairId', id);
  const revenueIds = [...new Set([
    ...payments.map((p) => (typeof p?.revenueId === 'string' ? p.revenueId : '')).filter(Boolean),
    ...naming.map((r) => r.id),
  ])];
  const b = db.batch();
  for (const r of revenueIds) b.delete(REVENUE, r);
  b.delete(REPAIRS, id);
  await b.commit();
  log(fx, 'repair.delete', `Repair ${id} deleted`, `${repairSummary(repair)} — ${repair.customerName || 'walk-in'}`, id);
  return { repairId: id, revenueIds };
}
