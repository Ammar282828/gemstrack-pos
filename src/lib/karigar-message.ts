/**
 * The words that go to a karigar about an order, sent after the pieces' photos: the order's number, then for each
 * piece its name, description, size, stones / stone weight / finish and the instructions — nothing else (owner,
 * 2026-11-03: "make the message very simple, only send the relevant details"). Never a price, a rate, the metal's
 * wastage or the customer. Staff's copy of the order has already lost the owner's internal note (lib/staff-view.ts).
 */

import type { Order } from '@/lib/store';
import { describeMetal, describeSettings } from '@/lib/materials';
import { categorySingular, staticCategories } from '@/lib/categories';

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

/**
 * The text of one piece (index into order.items): only what the karigar works from (owner, 2026-11-03: "make the
 * message very simple … the name, the description, the karigar instructions, if there's a stone weight or anything,
 * send that, and also the size"). Never the wastage, a price, a rate or the customer.
 */
export function pieceText(order: Order, index: number): string {
  const item = order.items[index];
  if (!item) return '';
  const category = categorySingular(item.itemCategory) || staticCategories.find(c => c.id === item.itemCategory)?.title || '';
  const description = (item.description || '').trim();
  const name = category || description || 'Piece';
  const lines = [`*${name}*`];
  if (description && description.toLowerCase() !== name.toLowerCase()) lines.push(description);
  // The metal and its karat, and the weight to make it to (owner, 2026-11-03: "send metal weight just not wastage,
  // send karat also"). Never the wastage.
  const metal = describeMetal(item.metalType, item.karat);
  if (metal) lines.push(`Metal: ${metal}`);
  const weight = Number(item.estimatedWeightG) || 0;
  if (weight > 0) lines.push(`Weight: ${weight % 1 === 0 ? weight : weight.toFixed(2)}g`);
  if (item.size?.trim()) lines.push(`Size: ${item.size.trim()}`);
  // Stones, diamonds, stone weight and the finish, each on its own line (lib/materials.ts).
  for (const l of describeSettings(item)) lines.push(l);
  // The karigar's instructions: the piece's bench notes (the slip prints the same ones).
  const notes = [item.adminNote, (item as { notes?: string }).notes]
    .map(v => (v || '').trim())
    .filter((v, i, a) => v && a.indexOf(v) === i);
  if (notes.length) lines.push(`Instructions: ${notes.join('\n')}`);
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
  // Simple: the order's number, then the pieces (the photos went before it in the chat).
  const head = [`Order ${order.id}`];
  const many = indexes.length > 1;
  const pieces = indexes.map((i, n) => {
    const text = pieceText(order, i);
    return many ? `${n + 1}. ${text}` : text;
  }).filter(Boolean);

  return [head.join('\n'), ...pieces].join('\n\n');
}

/** A caption for a piece's first photo: short, the piece's own details (WhatsApp caps captions at 1024). */
export function buildPhotoCaption(order: Order, index: number, orderNote?: string): string {
  return [orderNote ? `${orderNote}` : '', pieceText(order, index)].filter(Boolean).join('\n').slice(0, 1000);
}

/** The caption cap WhatsApp allows is 1024; the words stay under 1000. */
export const KARIGAR_CAPTION_MAX = 1000;
/** A text message (a piece with no photo) may run longer. */
export const KARIGAR_TEXT_MAX = 4000;

/**
 * What will be sent for each piece, as the phones show it for editing: the caption of its first photo
 * ("Order <id>" + its lines), which is also the text sent when the piece has no photo.
 */
export function pieceMessages(order: Order, indexes?: number[] | null): KarigarPiece[] {
  const chosen = chooseKarigarPieces(order, indexes);
  const many = order.items.length > 1;
  return chosen.map(index => {
    const item = order.items[index];
    const category = categorySingular(item.itemCategory) || staticCategories.find(c => c.id === item.itemCategory)?.title || '';
    const name = category || (item.description || '').trim() || 'Piece';
    return {
      index,
      title: many ? `Piece ${index + 1} of ${order.items.length}: ${name}` : name,
      text: buildPhotoCaption(order, index, `Order ${order.id}`),
    };
  });
}

/**
 * The owner's edited words from a request body: { "<pieceIndex>": "words" }. Strings only, trimmed; undefined when
 * none were sent; null when the shape is wrong (the route answers 400).
 */
export function parseTextOverrides(raw: unknown): Map<number, string> | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = new Map<number, string>();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{1,4}$/.test(k) || typeof v !== 'string') return null;
    out.set(Number(k), v.trim());
  }
  return out;
}

/** +92 3•• •••• 123 — enough for the owner to recognise the number, not to read it. */
export function maskPhone(digits: string): string {
  const d = digits.replace(/\D/g, '');
  return d.length <= 4 ? d : `+${d.slice(0, 2)}${'•'.repeat(Math.max(0, d.length - 5))}${d.slice(-3)}`;
}
