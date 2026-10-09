/**
 * What a move on an online order will send, and to whom, before anyone makes it.
 *
 * The iPhone app asks before every move that messages the customer or books money, and says the
 * WhatsApp word for word (the web's dialogs say it in a line). So the words come from here, built with
 * the very message functions the moves send (notify.ts), and the checks are the moves' own
 * (online.ts confirm/decline, fulfilment.ts transfer received/lapse): what is shown is what goes, and a
 * move the server would refuse is refused before the confirmation opens.
 *
 * Pure: the routes (app/api/website/online/[id]/preview, app/api/website/orders/[id]/preview) read the
 * documents and the server's settings and pass them in.
 */

import { customerConfirmedMessage, customerDeclinedMessage, customerExpiredMessage, customerPaidMessage, type OrderSummaryForMessage } from './notify';
import { statusUrl } from './checkout';
import { customerTotal, FulfilmentError } from './fulfilment';
import type { OnlineOrder, WebsiteBankDetails, WebsiteOrderMeta } from './types';

export type OnlineMove = 'confirm' | 'decline' | 'transfer_received' | 'lapse';

/** What Transfer received books (fulfilment.ts markTransferReceived). */
export interface TransferBooking {
  /** The pieces' balance, as one dated Bank Transfer advance; 0 when advances already cover them. */
  advance: number;
  /** The delivery charge, as extra revenue; 0 when delivery was free. */
  deliveryRevenue: number;
  /** What the customer pays in all: the pieces and the delivery. */
  total: number;
}

export interface MovePreview {
  move: OnlineMove;
  /** The customer's reference: the ONL- number (an older order's own ORD- number). */
  ref: string;
  /** The name the message greets. */
  name: string;
  /** The number the WhatsApp goes to, as the order carries it; '' when it has none. */
  to: string;
  /** The message, word for word. */
  text: string;
  /** False when nothing will go: this server's WhatsApp is off (WEBSITE_NOTIFY=off) or there is no number. */
  sends: boolean;
  /** Confirm: when the price hold would end, were it confirmed now. */
  holdUntil?: string;
  /** Transfer received: what is booked. */
  booking?: TransferBooking;
}

type Env = Record<string, string | undefined>;

/** The site's address for the customer's links (online.ts `origin`). */
export const websiteOrigin = (env: Env = process.env) => (env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');

/** notify.ts trySend sends nothing with WEBSITE_NOTIFY=off, or without a number. */
const willSend = (to: string, env: Env) => env.WEBSITE_NOTIFY !== 'off' && !!to.trim();

// ─── Before it is an order: confirm, decline ────────────────────────────────

export type OnlineForPreview = Pick<OnlineOrder, 'id' | 'state' | 'token' | 'customer' | 'delivery' | 'lines' | 'subtotal' | 'deliveryCharge' | 'grandTotal'>;

/** The summary the online order's messages are built from (online.ts `summaryOf`). */
export function onlineSummary(o: OnlineForPreview, origin: string, holdUntil?: string): OrderSummaryForMessage {
  return {
    id: o.id, customerName: o.customer.name, customerPhone: o.customer.phone, city: o.delivery.city,
    lines: o.lines.map(l => ({ description: l.description, price: l.price })),
    subtotal: o.subtotal, deliveryCharge: o.deliveryCharge, grandTotal: o.grandTotal,
    statusUrl: statusUrl(origin, o.id, o.token), ...(holdUntil ? { holdUntil } : {}),
  };
}

export function confirmPreview(
  o: OnlineForPreview,
  opts: { bank: WebsiteBankDetails; origin: string; holdHours: number; now?: Date; env?: Env },
): MovePreview {
  if (o.state === 'confirmed') throw new FulfilmentError('It is confirmed already.', 409);
  if (o.state === 'declined') throw new FulfilmentError('This order was declined.', 409);
  // The hold starts when it is confirmed (online.ts): a preview read a minute before says a minute early.
  const holdUntil = new Date((opts.now ?? new Date()).getTime() + opts.holdHours * 3_600_000).toISOString();
  const to = o.customer.phone || '';
  return {
    move: 'confirm', ref: o.id, name: o.customer.name, to,
    text: customerConfirmedMessage(onlineSummary(o, opts.origin, holdUntil), opts.bank),
    sends: willSend(to, opts.env ?? process.env),
    holdUntil,
  };
}

/** The reason as declining keeps it (online.ts declineOnlineOrder). */
export const declineReason = (reason: unknown) => String(reason ?? '').trim().slice(0, 300);

export function declinePreview(o: OnlineForPreview, reason: unknown, opts: { origin: string; env?: Env }): MovePreview {
  if (o.state === 'confirmed' || o.state === 'confirming') throw new FulfilmentError('It is confirmed already: cancel the order itself instead.', 409);
  if (o.state === 'declined') throw new FulfilmentError('It is declined already.', 409);
  const why = declineReason(reason);
  if (why.length < 3) throw new FulfilmentError('Say why, in a few words: the customer is sent it.', 400);
  const to = o.customer.phone || '';
  return {
    move: 'decline', ref: o.id, name: o.customer.name, to,
    text: customerDeclinedMessage(o.id, o.customer.name, why, statusUrl(opts.origin, o.id, o.token)),
    sends: willSend(to, opts.env ?? process.env),
  };
}

// ─── A confirmed order: transfer received, let it lapse ─────────────────────

export interface OrderForPreview {
  id: string;
  status?: string;
  customerName?: string;
  customerContact?: string;
  subtotal?: number;
  discountAmount?: number;
  advancePayment?: number;
  advanceInExchangeValue?: number;
  invoiceId?: string;
  website?: Pick<WebsiteOrderMeta, 'paymentStatus' | 'deliveryCharge' | 'onlineId'> & { total?: number };
}

const refOf = (o: OrderForPreview) => o.website?.onlineId || o.id;

/** The same sums markTransferReceived books: what the pieces still owe, and the delivery. */
export function transferBooking(o: OrderForPreview): TransferBooking {
  const advanced = Number(o.advancePayment) || 0;
  const advance = Math.max(0, (Number(o.subtotal) || 0) - (Number(o.discountAmount) || 0) - advanced - (Number(o.advanceInExchangeValue) || 0));
  const delivery = Number(o.website?.deliveryCharge) || 0;
  // customerTotal reads only the subtotal and the website's total and delivery.
  return { advance, deliveryRevenue: delivery > 0 ? delivery : 0, total: customerTotal({ subtotal: o.subtotal, website: o.website as WebsiteOrderMeta | undefined }) };
}

export function transferPreview(o: OrderForPreview, env: Env = process.env): MovePreview {
  if (!o.website) throw new FulfilmentError('Not an online order', 409);
  if (o.website.paymentStatus === 'transfer_received') throw new FulfilmentError('The transfer is recorded already.', 409);
  if (o.status === 'Cancelled' || o.status === 'Refunded') throw new FulfilmentError('The order is closed. Reopen it before recording money on it.', 409);
  if (o.invoiceId) throw new FulfilmentError('The order is invoiced already: take the payment on its invoice.', 409);
  const name = o.customerName || 'there';
  const to = o.customerContact || '';
  return {
    move: 'transfer_received', ref: refOf(o), name, to,
    text: customerPaidMessage(refOf(o), name),
    sends: willSend(to, env),
    booking: transferBooking(o),
  };
}

export function lapsePreview(o: OrderForPreview, env: Env = process.env): MovePreview {
  if (!o.website) throw new FulfilmentError('Not an online order', 409);
  if (o.website.paymentStatus === 'expired') throw new FulfilmentError('It has lapsed already.', 409);
  if (o.website.paymentStatus === 'transfer_received') throw new FulfilmentError('The transfer is recorded: this order is paid.', 409);
  if (o.status !== 'Pending' && o.status !== 'In Progress') throw new FulfilmentError(`The order is ${o.status}.`, 409);
  const name = o.customerName || 'there';
  const to = o.customerContact || '';
  return {
    move: 'lapse', ref: refOf(o), name, to,
    text: customerExpiredMessage(refOf(o), name),
    sends: willSend(to, env),
  };
}
