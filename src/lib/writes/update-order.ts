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
import { ORDER_PHOTOS, droppedPhotoIds, isInlinePhoto, photoHash, splitItemPhotos } from '@/lib/order-photos';
import { statusFromPieces } from '@/lib/order-stage';
import { rupees, rupeesIn } from '@/lib/money';

const ORDERS = 'orders';

type PhotoEdit = { sampleImageDataUri?: string; samplePhotoId?: string; samplePhotoHash?: string };
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
  // Whole rupees, whoever sends the edit (the form, the apps).
  let patch: OrderEdit = { ...edit, ...rupeesIn(edit, ['advancePayment', 'advanceInExchangeValue', 'subtotal', 'discountAmount', 'grandTotal']) };
  const movedTo = existing && Array.isArray(edit.items)
    ? statusFromPieces(String(edit.status ?? existing.status ?? ''), edit.items as never, !!(edit.invoiceId ?? existing.invoiceId))
    : null;
  let addedAdvance: Advance | null = null;
  if (existing && typeof edit.advancePayment === 'number' && !('advances' in edit)) {
    const before = rupees(existing.advancePayment);
    const after = rupees(edit.advancePayment);
    const listed = (existing.advances || []).reduce((n, p) => n + (Number(p.amount) || 0), 0);
    if (after > before + 0.5 && listed <= before + 0.5) {
      addedAdvance = clean({
        amount: after - before, date: now, notes: 'Added in the order form',
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

/**
 * What the form may say about the order's money, given the order as it stands NOW (not as the form opened it).
 * Another phone may have recorded an advance since; the form's copy of the totals is then stale, and writing
 * it back would undo that money while its entry stays in `advances`. So:
 * - an invoiced order's balance is the invoice's (followBalance): the form never sets it;
 * - an advance typed LOWER than what is stored is a stale form, not a refund (deleting an advance is its own
 *   operation): it is ignored; one typed higher is more money taken, joined to the advances (orderEditPatch);
 * - the balance (grandTotal) is never taken from the form: it is recomputed from the stored advance and the
 *   subtotal, discount and exchange as they will stand after the edit, the formula "Record an advance" uses.
 */
export function reconcileOrderMoney(existing: OrderOnFile, edit: OrderEdit): OrderEdit {
  const out: OrderEdit = { ...edit };
  if (existing.invoiceId) {
    delete out.advancePayment;
    delete out.grandTotal;
    return out;
  }
  const stored = rupees(existing.advancePayment);
  if ('advancePayment' in out && !(rupees(out.advancePayment) > stored)) delete out.advancePayment;
  const touchesMoney = ['advancePayment', 'subtotal', 'discountAmount', 'advanceInExchangeValue'].some((k) => k in edit);
  // The form always sends the parts; a bare total with none of them is an explicit figure and stays.
  if (touchesMoney) {
    const pick = (k: string) => rupees((k in out ? out[k] : existing[k]) as number | undefined);
    const advance = 'advancePayment' in out ? rupees(out.advancePayment) : stored;
    out.grandTotal = pick('subtotal') - pick('discountAmount') - advance - pick('advanceInExchangeValue');
  }
  return out;
}

/**
 * Reads the order, writes the edit and its photos in one commit, and logs what changed. The read is inside
 * the transaction: a payment another phone records meanwhile makes this try again on the new figures, and the
 * form's old totals are never put back (reconcileOrderMoney).
 */
export async function updateOrder(
  db: DbPort,
  input: { orderId: string; edit: OrderEdit; now?: string },
  deps: { clean: <T extends object>(o: T) => T },
  fx: SideEffects & { notifyStatus?: (id: string, status: string) => void } = {},
): Promise<UpdatedOrder> {
  const { orderId, edit } = input;
  const now = input.now || new Date().toISOString();
  const result = await db.runTransaction(async tx => {
    const existing = await tx.get<OrderOnFile>(ORDERS, orderId);
    if (!existing) throw new Error(`Order ${orderId} not found.`);
    let { patch, addedAdvance, movedTo } = orderEditPatch(existing, reconcileOrderMoney(existing, edit), now, deps.clean);
    // A picture sent again unchanged (a copy of the order that holds it inline, an old app build) must
    // not become another document: an item whose stored document already holds these bytes, but was
    // filed before documents carried a hash, is recognised by reading that one document.
    if (Array.isArray(patch.items)) {
      patch = { ...patch, items: await Promise.all((patch.items as PhotoEdit[]).map(async it => {
        if (!it || !isInlinePhoto(it.sampleImageDataUri) || !it.samplePhotoId || it.samplePhotoHash) return it;
        const stored = await tx.get<{ dataUri?: string }>(ORDER_PHOTOS, it.samplePhotoId).catch(() => null);
        return stored?.dataUri === it.sampleImageDataUri ? { ...it, samplePhotoHash: photoHash(it.sampleImageDataUri) } : it;
      })) };
    }
    const split = Array.isArray(patch.items) ? splitItemPhotos(patch.items as never[]) : null;
    const cleanData = deps.clean(split ? { ...patch, items: split.items } : patch);
    tx.set(ORDERS, orderId, cleanData as Record<string, unknown>, true);
    for (const ph of split?.photos ?? []) tx.set(ORDER_PHOTOS, ph.id, { dataUri: ph.dataUri, hash: ph.hash, orderId, createdAt: now });
    // The documents this edit let go of (a replaced or removed picture), in the same commit.
    if (split) for (const id of droppedPhotoIds(existing.items as never[], split.items as never[])) tx.delete(ORDER_PHOTOS, id);
    return { addedAdvance, movedTo, status: movedTo ?? (patch.status as string | undefined) ?? existing.status };
  });
  const { addedAdvance, movedTo } = result;
  await fx.log?.('order.update', `Updated order: ${orderId}`, 'Details updated', orderId);
  if (addedAdvance) {
    await fx.log?.('order.update', `Advance recorded for Order ${orderId}`,
      `Amount: ${addedAdvance.amount.toLocaleString()}${addedAdvance.method ? ` (${addedAdvance.method})` : ''} | in the order form`, orderId);
  }
  if (movedTo) {
    await fx.log?.('order.update', `${orderId} → ${movedTo}`, movedTo === 'Completed' ? 'Every piece is finished' : 'Every piece now has a karigar', orderId);
    if (movedTo === 'Completed') fx.notifyStatus?.(orderId, movedTo);
  }
  return { id: orderId, status: result.status, addedAdvance, movedTo };
}
