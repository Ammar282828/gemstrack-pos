/**
 * What the customer sees of an invoice outside the ERP: the file's name, and the message that
 * goes with it on WhatsApp. Shared by the browser (download, print) and the server (the send).
 *
 * The owner, 2026-10-05: the customer is not given the invoice's number as its name — "say invoice
 * and then customer name" — and Send via WhatsApp sends the PDF itself, not a link to it. The
 * number stays printed inside, where the shop finds the sale by it when the customer comes back.
 */

import { isWalkInName } from '@/lib/walk-in';
import { balanceLine } from '@/lib/invoice-credit';

type Named = { customerName?: string | null; createdAt?: string | null };

/** Characters no phone or computer allows in a file's name, and runs of spaces. */
const clean = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "Invoice - Fatima Hussain"; a walk-in's (no name to give) carries its day instead. */
export function invoiceTitle(inv: Named): string {
  const name = clean(String(inv.customerName || '')).slice(0, 80);
  if (name && !isWalkInName(name)) return `Invoice - ${name}`;
  const day = inv.createdAt ? new Date(inv.createdAt) : null;
  return day && !isNaN(day.getTime())
    ? `Invoice - ${day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' })}`
    : 'Invoice';
}

export function invoiceFileName(inv: Named, opts: { perPiece?: boolean } = {}): string {
  return `${invoiceTitle(inv)}${opts.perPiece ? ' (per piece)' : ''}.pdf`;
}

const pkr = (n: unknown) => `PKR ${Math.round(Number(n) || 0).toLocaleString('en-PK')}`;

/** The words under the PDF on WhatsApp: who it is for and what is owed — no number, no link. */
export function invoiceWhatsAppCaption(
  inv: Named & { grandTotal?: number; amountPaid?: number; balanceDue?: number },
  shopName: string,
): string {
  const name = clean(String(inv.customerName || ''));
  const lines = [`Dear ${name && !isWalkInName(name) ? name : 'Customer'},`, '', `Your invoice from ${shopName} is attached.`, ''];
  lines.push(`*Total:* ${pkr(inv.grandTotal)}`);
  if ((inv.amountPaid || 0) > 0) {
    lines.push(`*Paid:* ${pkr(inv.amountPaid)}`);
    const b = balanceLine(inv.balanceDue);
    lines.push(b.state === 'credit' ? `*Credit to you:* ${pkr(b.amount)}` : `*Balance due:* ${pkr(inv.balanceDue)}`);
  }
  lines.push('', 'Thank you for your business.');
  return lines.join('\n');
}

// ── Orders ──────────────────────────────────────────────────────────────────
// The customer's copy of an order (lib/order-pdf.ts), named and captioned as the invoice is: by the
// customer, never the number (owner, 2026-11-02: "send the pdf (order or invoice) directly to the customer").

/** "Order - Fatima Hussain"; a walk-in's carries its day instead. */
export function orderTitle(order: Named): string {
  return invoiceTitle(order).replace(/^Invoice\b/, 'Order');
}

export function orderFileName(order: Named): string {
  return `${orderTitle(order)}.pdf`;
}

/**
 * The words under an order's PDF: whose it is, the agreed price, what has been paid and what is left,
 * and the day it was promised. `grandTotal` on an order is already the balance (lib/order-estimate.ts).
 */
export function orderWhatsAppCaption(
  order: Named & { subtotal?: number; discountAmount?: number; advancePayment?: number; advanceInExchangeValue?: number; grandTotal?: number; promisedDate?: string | null },
  shopName: string,
): string {
  const name = clean(String(order.customerName || ''));
  const agreed = Math.max(0, (Number(order.subtotal) || 0) - (Number(order.discountAmount) || 0));
  const paid = (Number(order.advancePayment) || 0) + (Number(order.advanceInExchangeValue) || 0);
  const lines = [`Dear ${name && !isWalkInName(name) ? name : 'Customer'},`, '', `Your order with ${shopName} is attached.`, ''];
  lines.push(`*Total:* ${pkr(agreed)}`);
  if (paid > 0) lines.push(`*Advance paid:* ${pkr(paid)}`);
  const balance = Number(order.grandTotal) || 0;
  lines.push(balance < 0 ? `*Credit to you:* ${pkr(-balance)}` : `*Balance due:* ${pkr(balance)}`);
  const due = promised(order.promisedDate);
  if (due) lines.push(`*Ready by:* ${due}`);
  lines.push('', 'Thank you for your order.');
  return lines.join('\n');
}

/** "12 Nov 2026" from the order's plain yyyy-MM-dd (or an ISO instant); '' when there is none. */
function promised(day: string | null | undefined): string {
  if (!day) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T12:00:00+05:00`) : new Date(day);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });
}
