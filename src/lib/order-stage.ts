/**
 * Where an order stands, from its pieces — one rule for every path that changes them.
 *
 * The audit of 2026-10-04 (both houses' activity log, 60 days) found each custom order saved
 * about 4.4 times after it was made, most of them status changes typed by hand: "In Progress"
 * when the karigars had the pieces, "Completed" when they were back. The pieces already say
 * both. Before, only the per-piece karigar picker moved an order on (Pending → In Progress), and
 * ticking every piece finished never moved it at all; an order made with its karigars set, or
 * changed in the edit form, stayed Pending until someone changed it.
 *
 * Forward only, and only from Pending or In Progress: an order that is Completed, Cancelled or
 * Refunded, or already invoiced, is never moved by its pieces. (Unticking a piece of a finished
 * order is its own action — `statusAfterUntick`.)
 *
 * And the stage the Orders hub sorts by, with the one thing to do next.
 */

type Piece = { karigarId?: string | null; isCompleted?: boolean };
type Stageable = { status: string; items?: readonly Piece[] | null; invoiceId?: string | null; website?: { paymentStatus?: string } | null };

/** A confirmed online order whose bank transfer is not in yet (lib/website/online.ts): nothing is made before it is. */
export const awaitingTransfer = (o: Pick<Stageable, 'website'>) =>
  o.website?.paymentStatus === 'awaiting_transfer' || o.website?.paymentStatus === 'slip_sent';

/**
 * An order not yet invoiced that the books count as a sale on the day it was taken (its subtotal):
 * the dashboard, Analytics and the monthly PDF all read this one rule. A counter order is a sale
 * once taken — the customer stood there and agreed. An online order is not, until its transfer is
 * in: confirmed and unpaid it is an offer the customer may let lapse, and counting it put a
 * stranger's two-million-rupee basket into "Taken today" before a rupee had moved (2026-10-04).
 */
export const bookedAsSale = (o: { createdAt?: string; status?: string; invoiceId?: string | null; website?: { paymentStatus?: string } | null } | null | undefined): boolean =>
  !!o?.createdAt && o.status !== 'Cancelled' && o.status !== 'Refunded' && !o.invoiceId && !awaitingTransfer(o);

const hasKarigar = (p: Piece) => !!p.karigarId && p.karigarId !== 'none';

/** The status an order's pieces move it to, or null to leave it as it is. */
export function statusFromPieces(status: string, items: readonly Piece[] | null | undefined, invoiced = false): 'In Progress' | 'Completed' | null {
  const list = Array.isArray(items) ? items : [];
  if (invoiced || !list.length) return null;
  if (status !== 'Pending' && status !== 'In Progress') return null;
  if (list.every(p => p.isCompleted)) return 'Completed';
  if (status === 'Pending' && list.every(hasKarigar)) return 'In Progress';
  return null;
}

/** A piece of a finished (not yet invoiced) order was unticked: it is back with the karigars. */
export function statusAfterUntick(status: string, invoiced = false): 'In Progress' | null {
  return status === 'Completed' && !invoiced ? 'In Progress' : null;
}

/**
 * The hub's stages, in the order they are worked:
 *   transfer an online order, confirmed, its bank transfer not recorded yet — check the bank
 *   ready    finished, not invoiced — hand it over: Finalize & invoice
 *   karigar  In Progress — with the karigars
 *   new      Pending — not started: give the pieces to karigars
 *   payment  invoiced, money still owed on the invoice
 *   done     invoiced and paid
 *   closed   Cancelled or Refunded
 */
export type OrderStage = 'transfer' | 'ready' | 'karigar' | 'new' | 'payment' | 'done' | 'closed';
export const STAGE_ORDER: OrderStage[] = ['transfer', 'ready', 'karigar', 'new', 'payment', 'done', 'closed'];

export const STAGES: Record<OrderStage, { title: string; hint: string }> = {
  transfer: { title: 'Awaiting transfer', hint: 'online, confirmed — check the bank' },
  ready: { title: 'Ready to hand over', hint: 'finished — invoice it' },
  karigar: { title: 'With karigars', hint: 'being made' },
  new: { title: 'Not started', hint: 'give the pieces out' },
  payment: { title: 'Awaiting payment', hint: 'invoiced — taken on the invoice' },
  done: { title: 'Done', hint: 'invoiced and paid' },
  closed: { title: 'Cancelled or refunded', hint: '' },
};

/** `owedOnInvoice`: what the order's invoice still has owing (0 when paid or not invoiced). */
export function stageOf(order: Stageable, owedOnInvoice = 0): OrderStage {
  if (order.status === 'Cancelled' || order.status === 'Refunded') return 'closed';
  if (!order.invoiceId && awaitingTransfer(order)) return 'transfer';
  if (order.invoiceId) return owedOnInvoice > 0.5 ? 'payment' : 'done';
  if (order.status === 'Completed') return 'ready';
  if (order.status === 'In Progress') return 'karigar';
  return 'new';
}

/** The pieces still without a karigar, and still being made. */
export function pieceCounts(items: readonly Piece[] | null | undefined) {
  const list = Array.isArray(items) ? items : [];
  return { total: list.length, unassigned: list.filter(p => !hasKarigar(p)).length, done: list.filter(p => p.isCompleted).length };
}
