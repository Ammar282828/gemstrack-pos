/**
 * Taking a piece off an order, and deleting one of its advances (the order page's two trash buttons): the one
 * copy, run by the browser's store (owners, the client SDK) and by the iPhone app (/api/app/write, the Admin SDK).
 *
 * Both are for an order still being made: once invoiced, its pieces are the invoice's and its advances the
 * invoice's payments, and cash counts them there. The caller asks for the delete code first (decision "Delete
 * code"); each says what the person saw, so a piece or an advance that moved since is refused, never the
 * wrong one taken.
 *
 * The balance is worked out as recording an advance works it out: the pieces less the discount, what was
 * paid and what was taken in exchange. Removing a piece used to set it to the pieces alone, which forgot the
 * advance.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { Order, OrderItem } from '@/lib/store';
import { withoutOrderAdvance } from '@/lib/order-payment';
import { orderExchangeFields, orderExchanges } from '@/lib/exchange';

const ORDERS = 'orders';

/** A refusal in the page's words: said to the person, not a crash. */
export class OrderPieceRefusal extends Error {}

export const CHANGED_PIECES = 'The pieces on this order changed. Open it again and try once more.';
export const CHANGED_ADVANCES = 'The advances on this order changed. Open it again and try once more.';

type OrderDoc = Partial<Order>;

/** subtotal − discount − advances − exchange: the order's stored balance (order-advance.ts). */
export function orderBalance(o: { subtotal?: number; discountAmount?: number; advancePayment?: number; advanceInExchangeValue?: number }): number {
  return (Number(o.subtotal) || 0) - (Number(o.discountAmount) || 0) - (Number(o.advancePayment) || 0) - (Number(o.advanceInExchangeValue) || 0);
}

/** The store's own words for the delete code's log. */
export const removePieceWhat = (orderId: string, index: number) => `Remove item ${index + 1} from ${orderId}`;
export const deleteAdvanceWhat = (orderId: string, amount: number) => `Delete the advance of PKR ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} on ${orderId}`;

/**
 * The order without piece `index`: its pieces, the new subtotal and balance, and the summary the lists show.
 * A refusal when the order is invoiced, the piece is not the one shown, or it is the last one (delete the
 * order instead).
 */
export function orderWithoutPiece(order: OrderDoc, index: number, shownDescription?: string) {
  const items = (order.items || []) as OrderItem[];
  if (order.invoiceId) throw new OrderPieceRefusal(`${order.id ?? 'This order'} is invoiced as ${order.invoiceId}: its pieces are the invoice's now.`);
  const piece = items[index];
  if (!Number.isInteger(index) || index < 0 || !piece) throw new OrderPieceRefusal(CHANGED_PIECES);
  if (shownDescription !== undefined && (piece.description || '') !== shownDescription) throw new OrderPieceRefusal(CHANGED_PIECES);
  if (items.length <= 1) throw new OrderPieceRefusal('Cannot remove the last item from an order. Delete the order instead.');

  const left = items.filter((_, i) => i !== index);
  const subtotal = left.reduce((sum, item) => sum + (Number(item.totalEstimate) || Number(item.manualPrice) || 0), 0);
  const summary = left.length === 1
    ? (left[0].description || 'Custom order')
    : left.map(i => i.description).filter(Boolean).join(', ') || 'Custom order';
  const grandTotal = orderBalance({ ...order, subtotal });
  return { items: left, subtotal, grandTotal, summary, removed: piece };
}

export async function removeOrderPiece(
  db: DbPort,
  input: { orderId: string; index: number; description?: string },
  fx: SideEffects = {},
) {
  const { orderId, index } = input;
  const out = await db.runTransaction(async tx => {
    const order = await tx.get<OrderDoc>(ORDERS, orderId);
    if (!order) throw new OrderPieceRefusal('Order not found');
    const cut = orderWithoutPiece({ ...order, id: orderId }, index, input.description);
    tx.update(ORDERS, orderId, { items: cut.items, subtotal: cut.subtotal, grandTotal: cut.grandTotal, summary: cut.summary });
    return cut;
  });
  void Promise.resolve(fx.log?.('order.update', `Removed item from order: ${orderId}`, `Item: ${out.removed.description}`, orderId))
    .catch(() => undefined);
  return { items: out.items, subtotal: out.subtotal, grandTotal: out.grandTotal, summary: out.summary };
}

/**
 * One advance line taken off (withoutOrderAdvance, as `orderAdvancePayments` lists them). `amount` is the line
 * the person saw; a list that moved since is refused. `deleteField` is the SDK's field removal, for the method
 * of the advance taken with the order.
 */
export async function deleteOrderAdvance(
  db: DbPort,
  input: { orderId: string; lineIndex: number; amount: number },
  deps: { deleteField: () => unknown },
  fx: SideEffects = {},
) {
  const { orderId, lineIndex, amount } = input;
  const out = await db.runTransaction(async tx => {
    const o = await tx.get<OrderDoc>(ORDERS, orderId);
    if (!o) throw new OrderPieceRefusal('Order not found!');
    // Once invoiced, the advances are the invoice's payments, and cash counts them there.
    if (o.invoiceId) throw new OrderPieceRefusal(`${orderId} is invoiced: delete the payment on ${o.invoiceId} instead.`);
    const order = { ...o, id: orderId, createdAt: String(o.createdAt || '') } as Order;
    const cut = withoutOrderAdvance(order, lineIndex);
    if (!cut || Math.abs(cut.removed.amount - amount) >= 1) throw new OrderPieceRefusal(CHANGED_ADVANCES);
    // The gold that came with this advance goes with it: its tagged exchange rows, then the totals kept from them.
    // Rows without the tag (the order's own, older advances') are left as they are.
    const rows = orderExchanges(o, true);
    const kept = rows.filter((r) => !(r.advanceId && cut.dropAdvanceIds.includes(r.advanceId)));
    const exchangeFields = kept.length !== rows.length ? orderExchangeFields(kept) : undefined;
    const grandTotal = orderBalance({ ...o, advancePayment: cut.advancePayment, ...(exchangeFields && { advanceInExchangeValue: exchangeFields.advanceInExchangeValue }) });
    tx.update(ORDERS, orderId, {
      advancePayment: cut.advancePayment, advances: cut.advances, grandTotal, ...exchangeFields,
      ...(cut.dropMethod ? { advanceMethod: deps.deleteField() } : {}),
    });
    const next = { ...order, advancePayment: cut.advancePayment, advances: cut.advances, grandTotal, ...exchangeFields } as Order;
    if (cut.dropMethod) delete next.advanceMethod;
    return { order: next, removed: cut.removed };
  });
  void Promise.resolve(fx.log?.('order.update', `Advance deleted from Order ${orderId}`,
    `Amount: ${out.removed.amount.toLocaleString()}${out.removed.exchanges?.length ? ` + gold ${out.removed.exchanges.reduce((n, e) => n + (Number(e.value) || 0), 0).toLocaleString()}` : ''} of ${String(out.removed.date).slice(0, 10)} | Advance now ${out.order.advancePayment.toLocaleString()}, balance ${out.order.grandTotal.toLocaleString()}`,
    orderId)).catch(() => undefined);
  return out.order;
}
