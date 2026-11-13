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
import { ORDER_PHOTOS, type ExtraPhoto, droppedPhotoIds, isInlinePhoto, photoHash, splitItemPhotos } from '@/lib/order-photos';
import { statusFromPieces } from '@/lib/order-stage';
import { rupees, rupeesIn } from '@/lib/money';

const ORDERS = 'orders';

type PhotoEdit = { sampleImageDataUri?: string; samplePhotoId?: string; samplePhotoHash?: string; extraPhotos?: ExtraPhoto[] };
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
  /** The advance on file when the form opened (the apps send it): an advance typed lower is then a correction, not a stale form. Never written. */
  advanceSeen?: number;
  [k: string]: unknown;
}

/** An edit the order's money cannot take as sent: said to the person (409), nothing written. */
export class OrderMoneyRefusal extends Error {}

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
 * - an advance typed LOWER than what is stored is a correction when the form says it opened on what is stored
 *   (`advanceSeen`, the apps since 2026-11-13: an advance typed wrong could not be put right, found by the owner):
 *   it lowers the advance taken with the order; the part listed as advances taken later is deleted on the order page
 *   (deleting an advance is its own operation), so cutting into it is refused, as is a form opened on another figure.
 *   Without `advanceSeen` (an older app) a lower advance is still taken for a stale form and ignored;
 * - one typed higher is more money taken, joined to the advances (orderEditPatch);
 * - the balance (grandTotal) is never taken from the form: it is recomputed from the stored advance and the
 *   subtotal, discount and exchange as they will stand after the edit, the formula "Record an advance" uses.
 */
export function reconcileOrderMoney(existing: OrderOnFile, edit: OrderEdit): OrderEdit {
  const out: OrderEdit = { ...edit };
  const seen = out.advanceSeen;
  delete out.advanceSeen;
  if (existing.invoiceId) {
    delete out.advancePayment;
    delete out.grandTotal;
    return out;
  }
  // Every form sends the pieces' sum as the subtotal; a delivery the order carries (a Shopify order's) is added back here,
  // so an edit never drops it from what the customer owes.
  const delivery = Math.max(0, rupees(existing.deliveryCharge as number | undefined));
  if ('subtotal' in out && delivery > 0 && !('deliveryCharge' in out)) out.subtotal = rupees(out.subtotal as number) + delivery;
  const stored = rupees(existing.advancePayment);
  if ('advancePayment' in out && rupees(out.advancePayment) < stored && typeof seen === 'number' && Number.isFinite(seen)) {
    const typed = rupees(out.advancePayment);
    if (rupees(seen) !== stored) {
      throw new OrderMoneyRefusal(`The advance on this order has changed since it was opened (it is now ${stored.toLocaleString('en-PK')}). Open it again and try once more.`);
    }
    // Advances recorded after the order was made are listed with their dates; what the list does not hold was taken
    // with the order (order-payment.ts orderAdvanceLines). Only that part is corrected here.
    const listed = rupees((existing.advances || []).reduce((n, a) => n + (Number(a?.amount) || 0), 0));
    const withOrder = Math.max(0, stored - listed);
    if (stored - typed > withOrder) {
      throw new OrderMoneyRefusal(`${listed.toLocaleString('en-PK')} of this advance was recorded later, as its own lines: delete the wrong one on the order page instead.`);
    }
  } else if ('advancePayment' in out && !(rupees(out.advancePayment) > stored)) delete out.advancePayment;
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
    const money = reconcileOrderMoney(existing, edit);
    const before = rupees(existing.advancePayment);
    const lowered = typeof money.advancePayment === 'number' && rupees(money.advancePayment) < before ? rupees(money.advancePayment) : null;
    let { patch, addedAdvance, movedTo } = orderEditPatch(existing, money, now, deps.clean);
    // A picture sent again unchanged (a copy of the order that holds it inline, an old app build) must
    // not become another document: an item whose stored document already holds these bytes, but was
    // filed before documents carried a hash, is recognised by reading that one document.
    // An edit that says nothing about `extraPhotos` (an older app, which does not know the field) keeps the
    // piece's other reference photos: only an explicit [] clears them. The piece is the stored one at the same
    // place with the same main photo or name.
    if (Array.isArray(patch.items)) {
      const was = Array.isArray(existing.items) ? (existing.items as PhotoEdit[] & { description?: string }[]) : [];
      patch = { ...patch, items: (patch.items as (PhotoEdit & { description?: string })[]).map((it, i) => {
        const old = was[i] as (PhotoEdit & { description?: string }) | undefined;
        if (!it || 'extraPhotos' in it || !old?.extraPhotos?.length) return it;
        const same = (it.samplePhotoId && it.samplePhotoId === old.samplePhotoId) || (!!it.description && it.description === old.description);
        return same ? { ...it, extraPhotos: old.extraPhotos } : it;
      }) };
    }
    if (Array.isArray(patch.items)) {
      const same = async (id: string | undefined, uri: string | undefined, hash: string | undefined) => {
        if (!id || hash || !isInlinePhoto(uri)) return undefined;
        const stored = await tx.get<{ dataUri?: string }>(ORDER_PHOTOS, id).catch(() => null);
        return stored?.dataUri === uri ? photoHash(uri) : undefined;
      };
      patch = { ...patch, items: await Promise.all((patch.items as PhotoEdit[]).map(async it => {
        if (!it) return it;
        const first = await same(it.samplePhotoId, it.sampleImageDataUri, it.samplePhotoHash);
        const extras = Array.isArray(it.extraPhotos)
          ? await Promise.all(it.extraPhotos.map(async ex => { const h = ex ? await same(ex.id, ex.dataUri, ex.hash) : undefined; return h ? { ...ex, hash: h } : ex; }))
          : it.extraPhotos;
        return { ...it, ...(first ? { samplePhotoHash: first } : {}), ...(extras ? { extraPhotos: extras } : {}) };
      })) };
    }
    const split = Array.isArray(patch.items) ? splitItemPhotos(patch.items as never[]) : null;
    const cleanData = deps.clean(split ? { ...patch, items: split.items } : patch);
    tx.set(ORDERS, orderId, cleanData as Record<string, unknown>, true);
    for (const ph of split?.photos ?? []) tx.set(ORDER_PHOTOS, ph.id, { dataUri: ph.dataUri, hash: ph.hash, orderId, createdAt: now });
    // The documents this edit let go of (a replaced or removed picture), in the same commit.
    if (split) for (const id of droppedPhotoIds(existing.items as never[], split.items as never[])) tx.delete(ORDER_PHOTOS, id);
    return { addedAdvance, movedTo, correctedFrom: lowered == null ? null : before, correctedTo: lowered, status: movedTo ?? (patch.status as string | undefined) ?? existing.status };
  });
  const { addedAdvance, movedTo, correctedFrom, correctedTo } = result;
  await fx.log?.('order.update', `Updated order: ${orderId}`, 'Details updated', orderId);
  if (correctedFrom != null && correctedTo != null) {
    await fx.log?.('order.update', `Advance corrected for Order ${orderId}`,
      `From ${correctedFrom.toLocaleString()} to ${correctedTo.toLocaleString()} | in the order form`, orderId);
  }
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
