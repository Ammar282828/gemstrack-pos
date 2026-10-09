/**
 * Saving an edited order: what the order form's "Save Changes" writes (store.ts updateOrder), for the
 * browser and the iPhone app alike (lib/db-port.ts for why one copy).
 *
 * The form sends the order as it now stands; three things follow from it here rather than in a form:
 * - the pieces move the order on (lib/order-stage.ts): every piece with a karigar → In Progress, every
 *   piece finished → Completed;
 * - more advance typed into the form is money taken today, so it joins the advances with today's date,
 *   as "Record an advance" does (left out, it was dated to the day the order was made: found 2026-10-04);
 * - a new sample photo becomes a document of its own (lib/order-photos.ts), in the same commit.
 *
 * Types are structural: the store imports this, and importing the store back would close the circle.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { ORDER_PHOTOS, splitItemPhotos } from '@/lib/order-photos';
import { statusFromPieces } from '@/lib/order-stage';

const ORDERS = 'orders';

type Advance = { amount: number; date: string; notes?: string; method?: string };

export interface OrderOnFile {
  status?: string;
  invoiceId?: string | null;
  advancePayment?: number;
  advances?: Advance[];
  [k: string]: unknown;
}

export interface OrderEdit {
  items?: { isCompleted?: boolean; karigarId?: string; [k: string]: unknown }[];
  status?: string;
  invoiceId?: string | null;
  advancePayment?: number;
  advanceMethod?: string | null;
  advances?: Advance[];
  [k: string]: unknown;
}

/**
 * The patch the edit writes: the form's fields, with the status the pieces now call for and an added
 * advance listed with today's date. `clean` strips undefined (Firestore refuses it) and keeps null,
 * which is how the form clears a field it used to have.
 */
export function orderEditPatch(existing: OrderOnFile | null | undefined, edit: OrderEdit, now: string, clean: <T extends object>(o: T) => T):
  { patch: OrderEdit; addedAdvance: Advance | null; movedTo: 'In Progress' | 'Completed' | null } {
  let patch: OrderEdit = { ...edit };
  const movedTo = existing && Array.isArray(edit.items)
    ? statusFromPieces(String(edit.status ?? existing.status ?? ''), edit.items as never, !!(edit.invoiceId ?? existing.invoiceId))
    : null;
  let addedAdvance: Advance | null = null;
  if (existing && typeof edit.advancePayment === 'number' && !('advances' in edit)) {
    const before = Number(existing.advancePayment) || 0;
    const after = Number(edit.advancePayment) || 0;
    const listed = (existing.advances || []).reduce((n, p) => n + (Number(p.amount) || 0), 0);
    if (after > before + 0.5 && listed <= before + 0.5) {
      addedAdvance = clean({
        amount: Math.round((after - before) * 100) / 100, date: now, notes: 'Added in the order form',
        // The form's "Paid by" names this money only when there was no advance before it.
        ...(before <= 0.5 && edit.advanceMethod ? { method: edit.advanceMethod } : {}),
      }) as Advance;
      patch = { ...patch, advances: [...(existing.advances || []), addedAdvance] };
    }
  }
  if (movedTo) patch = { ...patch, status: movedTo };
  return { patch, addedAdvance, movedTo };
}

export interface UpdatedOrder {
  id: string;
  status?: string;
  addedAdvance: Advance | null;
  movedTo: 'In Progress' | 'Completed' | null;
}

/** Reads the order, writes the edit and its photos in one commit, and logs what changed. */
export async function updateOrder(
  db: DbPort,
  input: { orderId: string; edit: OrderEdit; now?: string },
  deps: { clean: <T extends object>(o: T) => T },
  fx: SideEffects & { notifyStatus?: (id: string, status: string) => void } = {},
): Promise<UpdatedOrder> {
  const { orderId, edit } = input;
  const now = input.now || new Date().toISOString();
  const existing = await db.get<OrderOnFile>(ORDERS, orderId);
  if (!existing) throw new Error(`Order ${orderId} not found.`);
  const { patch, addedAdvance, movedTo } = orderEditPatch(existing, edit, now, deps.clean);
  const split = Array.isArray(patch.items) ? splitItemPhotos(patch.items as never[]) : null;
  const cleanData = deps.clean(split ? { ...patch, items: split.items } : patch);
  const batch = db.batch();
  batch.set(ORDERS, orderId, cleanData as Record<string, unknown>, true);
  for (const ph of split?.photos ?? []) batch.set(ORDER_PHOTOS, ph.id, { dataUri: ph.dataUri, orderId, createdAt: now });
  await batch.commit();
  await fx.log?.('order.update', `Updated order: ${orderId}`, 'Details updated', orderId);
  if (addedAdvance) {
    await fx.log?.('order.update', `Advance recorded for Order ${orderId}`,
      `Amount: ${addedAdvance.amount.toLocaleString()}${addedAdvance.method ? ` (${addedAdvance.method})` : ''} | in the order form`, orderId);
  }
  if (movedTo) {
    await fx.log?.('order.update', `${orderId} → ${movedTo}`, movedTo === 'Completed' ? 'Every piece is finished' : 'Every piece now has a karigar', orderId);
    if (movedTo === 'Completed') fx.notifyStatus?.(orderId, movedTo);
  }
  return { id: orderId, status: movedTo ?? (patch.status as string | undefined) ?? existing.status, addedAdvance, movedTo };
}
