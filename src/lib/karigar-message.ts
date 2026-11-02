/**
 * The words that go to a karigar about an order: what the workshop slip says (lib/order-slip.ts), as a
 * WhatsApp message instead of a page. One builder, so the slip and the message agree.
 *
 * What a karigar must never see: any price (the estimate, the balance, the making, the rates) and the
 * customer beyond a first name. The slip prints the customer's whole name and the money; this does not.
 * The owner's internal note (`adminNote`) is on the slip, so it is here, as the slip has it; staff's copy
 * of the order has already lost it (lib/staff-view.ts).
 */

import type { Order } from '@/lib/store';
import { buildOrderItemBlocks } from '@/lib/order-slip';
import { format, parseISO } from 'date-fns';

export interface KarigarPiece {
  /** Index into order.items. */
  index: number;
  /** "Piece 2 of 3", or just the name when the order is one piece. */
  title: string;
  /** The same lines the slip prints for it: name, spec, settings and bench notes. */
  text: string;
}

/** "Ayesha Khan" → "Ayesha". A karigar needs a name to say who it is for, not who they are. */
export const firstName = (name?: string | null): string => (String(name || '').trim().split(/\s+/)[0] || '').slice(0, 30);

/** The text of one piece (index into order.items). */
export function pieceText(order: Order, index: number): string {
  const item = order.items[index];
  if (!item) return '';
  const b = buildOrderItemBlocks({ ...order, items: [item] } as Order)[0];
  const lines = [`*${b.name}*`];
  if (b.spec) lines.push(b.spec.split('  ·  ').join('\n'));
  // Money-free: wastage and weight are in grams in the spec; never a price.
  for (const s of b.settings) lines.push(s);
  return lines.join('\n');
}

/** The pieces a message can carry; the caller's own indexes, in order, those that exist. */
export function chooseKarigarPieces(order: Order, indexes?: number[] | null): number[] {
  const n = order.items.length;
  const wanted = indexes?.length ? indexes : order.items.map((_, i) => i);
  return [...new Set(wanted)].filter(i => Number.isInteger(i) && i >= 0 && i < n).sort((a, b) => a - b);
}

/**
 * The message for these pieces. `photoCount` is how many pictures went before it in the chat
 * (the note "Photos above" is only written when some did).
 */
export function buildKarigarMessage(
  order: Order,
  indexes: number[],
  opts: { karigarName?: string; shopName?: string; photoCount?: number } = {},
): string {
  const day = (iso: string) => { try { return format(parseISO(iso), 'd MMM yyyy'); } catch { return iso; } };
  const head: string[] = [];
  const greet = firstName(opts.karigarName);
  head.push(greet ? `Assalam o alaikum ${greet},` : 'Assalam o alaikum,');
  head.push(`New work${opts.shopName ? ` from ${opts.shopName}` : ''}: order ${order.id}`);
  const meta: string[] = [];
  const cust = firstName(order.customerName);
  if (cust) meta.push(`For: ${cust}`);
  if (order.promisedDate) meta.push(`Due: ${day(order.promisedDate)}`);
  if (meta.length) head.push(meta.join(' · '));

  const many = indexes.length > 1;
  const pieces = indexes.map((i, n) => {
    const text = pieceText(order, i);
    return many ? `${n + 1}. ${text}` : text;
  }).filter(Boolean);

  const out = [head.join('\n'), ...pieces];
  if (opts.photoCount) out.push(opts.photoCount === 1 ? 'Reference photo sent above.' : `${opts.photoCount} reference photos sent above.`);
  return out.join('\n\n');
}

/** A caption for a piece's first photo: short, the piece's own details (WhatsApp caps captions at 1024). */
export function buildPhotoCaption(order: Order, index: number, orderNote?: string): string {
  return [orderNote ? `${orderNote}` : '', pieceText(order, index)].filter(Boolean).join('\n').slice(0, 1000);
}

/** +92 3•• •••• 123 — enough for the owner to recognise the number, not to read it. */
export function maskPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return d.length <= 4 ? d : `+${d.slice(0, 2)}${'•'.repeat(Math.max(0, d.length - 5))}${d.slice(-3)}`;
}
