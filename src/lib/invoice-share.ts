/**
 * What the customer sees of an invoice outside the ERP: the file's name, and the message that
 * goes with it on WhatsApp. Shared by the browser (download, print) and the server (the send).
 *
 * The owner, 2026-10-05: the customer is not given the invoice's number as its name — "say invoice
 * and then customer name" — and Send via WhatsApp sends the PDF itself, not a link to it. The
 * number stays printed inside, where the shop finds the sale by it when the customer comes back.
 */

import { isWalkInName } from '@/lib/walk-in';

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
    lines.push(`*Balance due:* ${pkr(inv.balanceDue)}`);
  }
  lines.push('', 'Thank you for your business.');
  return lines.join('\n');
}
