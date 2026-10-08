/**
 * An order's status, set by hand or by its pieces: the one rule for what is written.
 *
 * Three ways in, one rule. The browser (owners) writes the patch straight from the order it already
 * holds, with no read first; the shop floor (/api/staff/write) and the iPhone app (/api/app/write)
 * read the order inside a transaction and write the same patch. The patch is worked out here, so
 * no path can finish an order and leave its pieces unticked, or tick a last piece without
 * finishing it.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { statusAfterUntick, statusFromPieces } from '@/lib/order-stage';

const ORDERS = 'orders';

export const ORDER_STATUSES = ['Pending', 'In Progress', 'Completed', 'Cancelled', 'Refunded'] as const;
export type SettableStatus = (typeof ORDER_STATUSES)[number];

type Piece = { isCompleted?: boolean; description?: string; karigarId?: string | null };
type OrderLike<P extends Piece = Piece> = { status: string; items?: readonly P[] | null; invoiceId?: string | null };

/**
 * What setting a status writes. Completing an order completes every piece in it: nobody ticks the
 * boxes one by one, and leaving them unticked makes finished work linger as pending on the
 * Workshop board forever. `ticked` is how many pieces that finished.
 */
export function orderStatusPatch<P extends Piece>(order: OrderLike<P>, status: SettableStatus): { patch: Record<string, unknown>; ticked: number } {
  const items = Array.isArray(order.items) ? order.items : [];
  const ticked = status === 'Completed' ? items.filter(i => !i.isCompleted).length : 0;
  const patch: Record<string, unknown> = { status };
  if (ticked) patch.items = items.map(i => ({ ...i, isCompleted: true }));
  return { patch, ticked };
}

/**
 * What ticking (or unticking) one piece writes: the last piece finished finishes the order; a piece
 * unticked on a finished one sends it back.
 */
export function pieceDonePatch<P extends Piece>(order: OrderLike<P>, index: number, done: boolean): { patch: Record<string, unknown>; nextStatus: 'In Progress' | 'Completed' | null; items: P[] } {
  const items = (Array.isArray(order.items) ? order.items : []).map((item, i) => (i === index ? { ...item, isCompleted: done } : item));
  const invoiced = !!order.invoiceId;
  const nextStatus = done ? statusFromPieces(order.status, items, invoiced) : statusAfterUntick(order.status, invoiced);
  return { patch: { items, ...(nextStatus && { status: nextStatus }) }, nextStatus, items };
}

/** The statuses whose change raises the WhatsApp alert (Settings decides whether it is sent). */
export const alertsOnStatus = (s: string) => s === 'Completed' || s === 'Cancelled' || s === 'Refunded';

export async function setOrderStatus(db: DbPort, input: { orderId: string; status: SettableStatus }, fx: SideEffects = {}) {
  const { orderId, status } = input;
  const { ticked } = await db.runTransaction(async tx => {
    const order = await tx.get<OrderLike>(ORDERS, orderId);
    if (!order) throw new Error('No such order');
    const out = orderStatusPatch(order, status);
    tx.set(ORDERS, orderId, out.patch, true);
    return out;
  });
  void Promise.resolve(fx.log?.('order.update', `Order ${orderId} status changed`, `New status: ${status}`, orderId)).catch(() => undefined);
  if (ticked) void Promise.resolve(fx.log?.('order.update', `All items marked complete on ${orderId}`, `${ticked} item(s) auto-completed`, orderId)).catch(() => undefined);
  if (alertsOnStatus(status)) fx.notify?.(orderId);
  return { orderId, status, ticked };
}

export async function setOrderPieceDone(db: DbPort, input: { orderId: string; index: number; done: boolean }, fx: SideEffects = {}) {
  const { orderId, index, done } = input;
  const { nextStatus, description } = await db.runTransaction(async tx => {
    const order = await tx.get<OrderLike>(ORDERS, orderId);
    if (!order) throw new Error('No such order');
    const items = Array.isArray(order.items) ? order.items : [];
    if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('That piece is not on this order any more.');
    const out = pieceDonePatch(order, index, done);
    tx.set(ORDERS, orderId, out.patch, true);
    return { nextStatus: out.nextStatus, description: String(items[index]?.description || `Item ${index + 1}`) };
  });
  if (nextStatus) {
    void Promise.resolve(fx.log?.('order.update', `${orderId} → ${nextStatus}`, nextStatus === 'Completed' ? 'Every piece is finished' : `${description} is not finished`, orderId)).catch(() => undefined);
    if (nextStatus === 'Completed') fx.notify?.(orderId);
  }
  return { orderId, index, done, status: nextStatus };
}

/**
 * A piece given to a karigar, or taken off one ("none" or nothing clears it). A Pending order whose
 * every piece now has a karigar has been handed out, so it moves itself to In Progress; nothing
 * else moves (store.ts _statusAfterAssign, the rule of lib/order-stage.ts).
 */
export function pieceKarigarPatch<P extends Piece>(order: OrderLike<P>, index: number, karigarId: string | null | undefined): { patch: Record<string, unknown>; nextStatus: 'In Progress' | 'Completed' | null; items: P[] } {
  const clearing = !karigarId || karigarId === 'none';
  const items = (Array.isArray(order.items) ? order.items : []).map((item, i) => {
    if (i !== index) return item;
    const next = { ...item };
    if (clearing) delete next.karigarId; else next.karigarId = karigarId;
    return next;
  });
  // Only the assignment's own step: a karigar given never finishes an order by itself.
  const nextStatus = (order.status === 'Pending' && statusFromPieces(order.status, items.map((i) => ({ ...i, isCompleted: false })), !!order.invoiceId)) || null;
  return { patch: { items, ...(nextStatus && { status: nextStatus }) }, nextStatus, items };
}

/** When a piece physically went to the karigar (ISO), or not yet (null). */
export function pieceGivenPatch<P extends Piece & { givenAt?: string }>(order: OrderLike<P>, index: number, givenAt: string | null | undefined): { patch: Record<string, unknown> } {
  const items = (Array.isArray(order.items) ? order.items : []).map((item, i) => {
    if (i !== index) return item;
    const next = { ...item };
    if (givenAt) next.givenAt = givenAt; else delete next.givenAt;
    return next;
  });
  return { patch: { items } };
}

export async function setOrderPieceKarigar(db: DbPort, input: { orderId: string; index: number; karigarId: string | null; karigarName?: string }, fx: SideEffects = {}) {
  const { orderId, index, karigarId } = input;
  const out = await db.runTransaction(async (tx) => {
    const order = await tx.get<OrderLike>(ORDERS, orderId);
    if (!order) throw new Error('No such order');
    const items = Array.isArray(order.items) ? order.items : [];
    if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('That piece is not on this order any more.');
    const p = pieceKarigarPatch(order, index, karigarId);
    tx.set(ORDERS, orderId, p.patch, true);
    return { nextStatus: p.nextStatus, description: String(items[index]?.description || `Item ${index + 1}`) };
  });
  const name = !karigarId || karigarId === 'none' ? 'Unassigned' : (input.karigarName || karigarId);
  void Promise.resolve(fx.log?.('order.update', `Karigar assigned on ${orderId}`, `${out.description} → ${name}`, orderId)).catch(() => undefined);
  if (out.nextStatus) void Promise.resolve(fx.log?.('order.update', `${orderId} → ${out.nextStatus}`, 'Every piece now has a karigar', orderId)).catch(() => undefined);
  return { orderId, index, status: out.nextStatus };
}

export async function setOrderPieceGiven(db: DbPort, input: { orderId: string; index: number; givenAt: string | null }) {
  const { orderId, index, givenAt } = input;
  await db.runTransaction(async (tx) => {
    const order = await tx.get<OrderLike<Piece & { givenAt?: string }>>(ORDERS, orderId);
    if (!order) throw new Error('No such order');
    const items = Array.isArray(order.items) ? order.items : [];
    if (!Number.isInteger(index) || index < 0 || index >= items.length) throw new Error('That piece is not on this order any more.');
    tx.set(ORDERS, orderId, pieceGivenPatch(order, index, givenAt).patch, true);
  });
  return { orderId, index, givenAt };
}
