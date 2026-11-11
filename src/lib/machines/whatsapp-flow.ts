/**
 * A Shopify web order's WhatsApp conversation (lib/shopify-whatsapp-server.ts): `shopify_whatsapp/<Shopify order id>.state`,
 * copied onto the ERP order/invoice as `whatsappOrder.state` (the chip). Declared 2026-11-11.
 *
 * `failed` is recoverable by the customer: a send that timed out may still have been delivered, so a reply ("1" / "2" to a
 * cash-on-delivery order, a picture to a bank transfer) on a failed flow moves it on as if it had been waiting. Only the
 * reply-driven moves recover it; a transfer marked paid in Shopify does not. `no-whatsapp` (the number is not on WhatsApp)
 * stays final: nobody can reply there.
 */
import { defineMachine } from './machine';

export const FLOW_STATES = ['awaiting-confirmation', 'confirmed', 'declined', 'awaiting-payment', 'slip-received', 'paid', 'sent', 'failed', 'no-whatsapp'] as const;
export type FlowStateName = typeof FLOW_STATES[number];
export interface FlowCtx { kind: 'cod' | 'bank' | 'paid' }

const cod = (c: FlowCtx) => (c.kind === 'cod' ? null : 'Only a cash-on-delivery order is confirmed or declined.');
const bank = (c: FlowCtx) => (c.kind === 'bank' ? null : 'Only a bank-transfer order has a payment screenshot.');
const FIRST: FlowStateName[] = ['awaiting-confirmation', 'awaiting-payment', 'sent'];

export const WHATSAPP_FLOW = defineMachine<FlowStateName, FlowCtx>({
  name: 'Order WhatsApp',
  field: 'shopify_whatsapp/<order id>.state',
  states: FLOW_STATES,
  labels: {
    'awaiting-confirmation': 'Awaiting confirmation', confirmed: 'Confirmed on WhatsApp', declined: 'Cancel requested',
    'awaiting-payment': 'Awaiting transfer', 'slip-received': 'Screenshot sent', paid: 'Paid · thanked on WhatsApp',
    sent: 'Thanked on WhatsApp', failed: 'WhatsApp did not send', 'no-whatsapp': 'No WhatsApp',
  },
  tones: {
    'awaiting-confirmation': 'working', confirmed: 'settled', declined: 'late', 'awaiting-payment': 'working', 'slip-received': 'owed',
    paid: 'settled', sent: 'quiet', failed: 'late', 'no-whatsapp': 'late',
  },
  final: ['confirmed', 'declined', 'paid', 'sent', 'no-whatsapp'],
  moves: [
    { from: ['awaiting-confirmation', 'failed'], to: 'confirmed', event: 'confirm', guard: cod, guardNote: 'cash on delivery', note: 'the customer answered 1 / Confirm; from Failed too (the message may have arrived)' },
    { from: ['awaiting-confirmation', 'failed'], to: 'declined', event: 'decline', guard: cod, guardNote: 'cash on delivery', note: 'the customer answered 2 / Cancel: the shop is asked to cancel it; the order itself is not cancelled' },
    { from: ['awaiting-payment', 'failed'], to: 'slip-received', event: 'slip', guard: bank, guardNote: 'bank transfer', note: 'a picture or PDF; from Failed too' },
    { from: ['awaiting-payment', 'slip-received'], to: 'paid', event: 'paid', note: 'Shopify says the transfer is paid' },
    { from: FIRST, to: 'failed', event: 'fail', note: 'the send threw; the shop is told. Not once the customer has answered' },
    { from: FIRST, to: 'no-whatsapp', event: 'noWhatsapp', note: 'the number is not on WhatsApp; the shop is told' },
  ],
});
