/**
 * The words the Contact control's WhatsApp and Message open with (owner, 2026-11-14: "have pre-created messages … if an
 * order is done and I press the message on WhatsApp … a pre-typed message that whatever your name is, your order is ready
 * at Taheri, please collect it, or something professional"). One message per moment of an order, invoice or repair, in the
 * voice of the repair desk's "Tell them" (Assalam o Alaikum, the record's number, the balance when there is one). It is only
 * a starting point: WhatsApp and Messages open with it typed, to be changed or sent. Nothing is sent by itself.
 *
 * The same words in the apps: iPhone/iPad/Mac `App/UI/CustomerMessages.swift`, Android `ui/CustomerMessages.kt`.
 */
import { STORE_CONFIG } from '@/lib/store-config';
import { pkr } from '@/lib/money-round';
import { formatDate } from '@/lib/safe-date';
import { isWalkInName } from '@/lib/walk-in';
import type { OrderStage } from '@/lib/order-stage';

const shop = () => STORE_CONFIG.name;

/** "Assalam o Alaikum Sana," — the name only for a named customer, never "Walk-in Customer". */
function greet(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  const real = !!n && !isWalkInName(n);
  return `Assalam o Alaikum${real ? ` ${n}` : ''},`;
}

/** Whole rupees owed, 0 when nothing (under a rupee is settled). */
const owes = (n: number | null | undefined) => (Number(n) >= 1 ? Math.round(Number(n)) : 0);

/**
 * An order's message for where it stands. `balance`: what is still to pay on it (on its invoice once invoiced).
 * `promised`: the date promised to the customer ("yyyy-MM-dd"), if any. Cancelled or refunded: no message.
 */
export function orderMessage(o: { id: string; customerName?: string | null; promisedDate?: string | null }, stage: OrderStage, balance: number): string {
  const hi = greet(o.customerName);
  const due = owes(balance);
  switch (stage) {
    case 'ready':
      return `${hi} your order ${o.id} is ready at ${shop()}. Please collect it at your convenience.${due ? ` The balance is ${pkr(due)}.` : ''} Thank you.`;
    case 'new':
    case 'karigar': {
      const by = o.promisedDate ? formatDate(o.promisedDate, 'EEEE d MMMM', '') : '';
      return `${hi} thank you for your order with ${shop()}. Your order ${o.id} is being made${by ? ` and is expected to be ready by ${by}` : ''}. We will let you know as soon as it is ready.`;
    }
    case 'transfer':
      return `${hi} thank you for your order ${o.id} with ${shop()}. We will confirm it as soon as your transfer reaches us.`;
    case 'payment':
      return `${hi} a gentle reminder from ${shop()}: ${pkr(due)} is still to be paid on your order ${o.id}. Thank you.`;
    case 'done':
      return `${hi} thank you for choosing ${shop()}. We hope you enjoy your jewellery, and look forward to seeing you again.`;
    default:
      return '';
  }
}

/** An invoice's message: a gentle reminder while money is owed, thanks once it is paid. */
export function invoiceMessage(i: { id: string; customerName?: string | null; balanceDue?: number | null }): string {
  const hi = greet(i.customerName);
  const due = owes(i.balanceDue);
  return due
    ? `${hi} a gentle reminder from ${shop()}: ${pkr(due)} is still to be paid on your invoice ${i.id}. Thank you.`
    : `${hi} thank you for choosing ${shop()}. We hope you enjoy your jewellery, and look forward to seeing you again.`;
}

/** A repair ticket's message: received while in the shop, the desk's "ready for collection" once ready. */
export function repairMessage(r: { id: string; customerName?: string | null; status?: string; pieces?: { item: string }[] }, balance: number): string {
  const hi = greet(r.customerName);
  const pieces = r.pieces ?? [];
  const what = pieces.length === 1 ? `your ${pieces[0].item.toLowerCase()}` : pieces.length ? `your ${pieces.length} pieces` : 'your pieces';
  const due = owes(balance);
  if (r.status === 'ready') {
    return `${hi} ${what} ${pieces.length === 1 ? 'is' : 'are'} ready for collection at ${shop()} (repair ${r.id}).${due ? ` Balance: ${pkr(due)}.` : ''} Please bring your receipt.`;
  }
  if (r.status === 'cancelled') return '';
  if (r.status === 'collected') return `${hi} thank you for choosing ${shop()}. We hope you are happy with the work.`;
  return `${hi} we have received ${what} for repair at ${shop()} (repair ${r.id}). We will let you know as soon as ${pieces.length === 1 ? 'it is' : 'they are'} ready.`;
}
