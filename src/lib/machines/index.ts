/**
 * Every declared state machine (lib/machines/machine.ts). The order of MACHINES is the order of docs/state-machines.md.
 *
 * Order    orders/<id>.status             by hand, by its pieces, finalize/undo/refund, the website and Shopify
 * Repair   repairs/<id>.status            In the shop → Ready → Collected, or Cancelled
 * Link     payment_links/<token>.status   a Safepay link: open → paid / expired (a late payment still counts)
 * Online   online_orders/<id>.state       a website order waiting for a person to confirm it
 * Booking  orders/<id>.tcsBooking         a TCS parcel booked from the ERP, cancelled
 */
import { defineMachine } from './machine';
import { owesMoney } from '@/lib/money';

// ── Order ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const ORDER_STATES = ['Pending', 'In Progress', 'Completed', 'Cancelled', 'Refunded'] as const;
export type OrderState = typeof ORDER_STATES[number];
export interface OrderCtx { invoiced: boolean }
const notInvoiced = (c: OrderCtx) => (c.invoiced ? 'This order has its invoice: undo the invoice first (or refund it).' : null);
const OPEN: OrderState[] = ['Pending', 'In Progress', 'Completed'];

export const ORDER = defineMachine<OrderState, OrderCtx>({
  name: 'Order',
  field: 'orders/<id>.status',
  states: ORDER_STATES,
  labels: { Pending: 'Pending', 'In Progress': 'In Progress', Completed: 'Completed', Cancelled: 'Cancelled', Refunded: 'Refunded' },
  tones: { Pending: 'owed', 'In Progress': 'working', Completed: 'settled', Cancelled: 'quiet', Refunded: 'quiet' },
  final: ['Refunded'],
  moves: [
    { from: ['Pending', 'In Progress', 'Completed', 'Cancelled'], to: 'Pending', event: 'set', guard: notInvoiced, guardNote: 'not invoiced', note: 'reopen or send back' },
    { from: ['Pending', 'Completed', 'Cancelled'], to: 'In Progress', event: 'set', guard: notInvoiced, guardNote: 'not invoiced' },
    { from: ['Pending', 'In Progress', 'Cancelled'], to: 'Completed', event: 'set', guard: notInvoiced, guardNote: 'not invoiced', note: 'ticks every piece' },
    { from: OPEN, to: 'Cancelled', event: 'set', guard: notInvoiced, guardNote: 'not invoiced' },
    { from: ['Pending'], to: 'In Progress', event: 'pieces', note: 'every piece has a karigar' },
    { from: ['Pending', 'In Progress'], to: 'Completed', event: 'pieces', guard: notInvoiced, guardNote: 'not invoiced', note: 'the last piece ticked' },
    { from: ['Completed'], to: 'In Progress', event: 'pieces', guard: notInvoiced, guardNote: 'not invoiced', note: 'a piece unticked' },
    { from: ['Pending', 'In Progress', 'Completed'], to: 'Completed', event: 'finalize', note: 'Finalize & invoice' },
    { from: ['Completed'], to: 'Pending', event: 'undoInvoice', note: 'the invoice deleted; back to its status before (or Pending)' },
    { from: ['Completed'], to: 'In Progress', event: 'undoInvoice' },
    { from: OPEN, to: 'Refunded', event: 'refund', note: 'Refund: stock back, money out; the only way to Refunded' },
    { from: ['Pending', 'In Progress'], to: 'Completed', event: 'delivered', note: 'the website or Shopify says the parcel arrived' },
    { from: ['Pending', 'In Progress', 'Completed'], to: 'Completed', event: 'shipped', note: 'Shopify shipped it' },
    { from: ['Pending', 'In Progress'], to: 'Cancelled', event: 'lapse', note: 'a website order whose transfer never came' },
    { from: OPEN, to: 'Cancelled', event: 'shopifyCancel', guard: notInvoiced, guardNote: 'not invoiced', note: 'cancelled or returned on Shopify with nothing paid' },
  ],
});

// ── Repair ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export const REPAIR_STATES = ['received', 'ready', 'collected', 'cancelled'] as const;
export type RepairState = typeof REPAIR_STATES[number];
export interface RepairCtx { balance: number }

export const REPAIR = defineMachine<RepairState, RepairCtx>({
  name: 'Repair',
  field: 'repairs/<id>.status',
  states: REPAIR_STATES,
  labels: { received: 'In the shop', ready: 'Ready', collected: 'Collected', cancelled: 'Cancelled' },
  tones: { received: 'working', ready: 'owed', collected: 'settled', cancelled: 'quiet' },
  final: [],
  moves: [
    { from: ['ready', 'cancelled', 'collected'], to: 'received', event: 'set', note: 'back in the shop (undo)' },
    { from: ['received', 'collected'], to: 'ready', event: 'set' },
    {
      from: ['received', 'ready'], to: 'collected', event: 'set',
      guard: c => (owesMoney(c.balance) ? `PKR ${Math.round(c.balance).toLocaleString('en-PK')} is still owed: take it first.` : null),
      guardNote: 'nothing owed (under 1 rupee is settled)',
    },
    { from: ['received', 'ready'], to: 'cancelled', event: 'set' },
  ],
});

// ── Payment link ────────────────────────────────────────────────────────────────────────────────────────────────────

export const LINK_STATES = ['open', 'paid', 'expired', 'attention'] as const;
export type LinkState = typeof LINK_STATES[number];

export const LINK = defineMachine<LinkState, Record<string, never>>({
  name: 'Payment link',
  field: 'payment_links/<token>.status',
  states: LINK_STATES,
  labels: { open: 'Waiting for payment', paid: 'Paid', expired: 'Expired', attention: 'Paid, needs you' },
  tones: { open: 'owed', paid: 'settled', expired: 'quiet', attention: 'late' },
  final: ['paid'],
  moves: [
    { from: ['open', 'expired', 'attention'], to: 'paid', event: 'paid', note: 'Safepay says paid: recorded once, by Card' },
    { from: ['open'], to: 'expired', event: 'expire', note: '30 days unpaid; still checked for a late payment' },
    { from: ['open', 'expired'], to: 'attention', event: 'unapplied', note: 'paid, but its order or invoice is closed: the owner decides' },
  ],
});

// ── Website online order ────────────────────────────────────────────────────────────────────────────────────────────

export const ONLINE_STATES = ['pending', 'confirming', 'confirmed', 'declined'] as const;
export type OnlineState = typeof ONLINE_STATES[number];

export const ONLINE = defineMachine<OnlineState, Record<string, never>>({
  name: 'Website order',
  field: 'online_orders/<id>.state',
  states: ONLINE_STATES,
  labels: { pending: 'Waiting for the shop', confirming: 'Being confirmed', confirmed: 'Confirmed', declined: 'Declined' },
  tones: { pending: 'owed', confirming: 'working', confirmed: 'settled', declined: 'quiet' },
  final: ['confirmed', 'declined'],
  moves: [
    { from: ['pending'], to: 'confirming', event: 'claim', note: 'a person pressed Confirm (held 2 minutes)' },
    { from: ['confirming'], to: 'confirming', event: 'claim', note: 'a claim older than 2 minutes is taken over' },
    { from: ['confirming'], to: 'confirmed', event: 'confirm', note: 'the ERP order is made' },
    { from: ['confirming'], to: 'pending', event: 'release', note: 'making the order failed' },
    { from: ['pending'], to: 'declined', event: 'decline' },
  ],
});

// ── TCS booking ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const BOOKING_STATES = ['none', 'pending', 'booked', 'cancelled'] as const;
export type BookingState = typeof BOOKING_STATES[number];
export interface BookingCtx { orderOpen: boolean; parcelMoving: boolean }

export const BOOKING = defineMachine<BookingState, BookingCtx>({
  name: 'TCS booking',
  field: 'orders/<id>.tcsBooking',
  states: BOOKING_STATES,
  labels: { none: 'Not booked', pending: 'Booking…', booked: 'Booked', cancelled: 'Booking cancelled' },
  tones: { none: 'quiet', pending: 'working', booked: 'settled', cancelled: 'quiet' },
  final: [],
  moves: [
    { from: ['none', 'cancelled'], to: 'pending', event: 'book', guard: c => (c.orderOpen ? null : 'This order is cancelled or refunded: reopen it before booking a parcel.'), guardNote: 'order not Cancelled or Refunded', note: 'held 90 seconds against a second booking' },
    { from: ['pending'], to: 'booked', event: 'booked', note: 'TCS gave the consignment number' },
    { from: ['pending'], to: 'none', event: 'failed' },
    { from: ['booked'], to: 'cancelled', event: 'cancel', guard: c => (c.parcelMoving ? 'TCS already has the parcel moving: it cannot be cancelled from here.' : null), guardNote: 'the parcel has not left' },
  ],
});

/** The order of the docs and the export. */
export const MACHINES = [ORDER, REPAIR, LINK, ONLINE, BOOKING] as const;

/** Where a booking stands, from the order's fields. */
export function bookingStateOf(o: { tcsBooking?: { cancelledAt?: string | null; cn?: string | null } | null; tcsPending?: unknown }): BookingState {
  const b = o.tcsBooking;
  if (b?.cancelledAt) return 'cancelled';
  if (b?.cn) return 'booked';
  return 'none';
}
