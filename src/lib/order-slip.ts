/**
 * The parts of a workshop order slip that both builders share.
 *
 * The slip is generated in two places — the order page and the orders list —
 * as near-identical copies. Everything they had in common was duplicated, so
 * a fix applied to one silently left the other behind: the customer name ran
 * through the figures beside it in both, and the plating line printed twice in
 * both, because each was two edits and only ever got one.
 *
 * The pieces that carry meaning live here instead. Layout that is genuinely
 * per-caller (the header, the footer, the QR codes) stays where it is.
 */

import type jsPDF from 'jspdf';
import type { Order } from '@/lib/store';
import { staticCategories } from '@/lib/store';
import { describeMetal, describeSettings } from '@/lib/materials';
import type { ItemBlock } from '@/lib/invoice-item-cell';
import { drawTotals, type TotalRow } from '@/lib/pdf-chrome';

const money = (n: number) => `PKR ${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

/**
 * One ItemBlock per line of the order, in the same shape the invoice uses.
 *
 * The finish is NOT appended here: describeSettings already ends with it.
 * Adding it again printed "Finish: 21K Gold Plating" twice on every plated
 * piece, which is what the slip actually shipped with.
 */
export function buildOrderItemBlocks(order: Order): ItemBlock[] {
  return order.items.map(item => {
    const categoryTitle =
      staticCategories.find(c => c.id === item.itemCategory)?.title || item.itemCategory || '';
    const metalName = describeMetal(item.metalType, item.karat);
    const metalPart = item.isManualPrice
      ? metalName
      : `${metalName}${item.estimatedWeightG ? ` · Est. ${item.estimatedWeightG}g` : ''}` +
        `${item.metalType !== 'silver' && item.wastagePercentage > 0 ? ` · Wastage ${item.wastagePercentage}%` : ''}`;

    // Darker than the spec line: settings and bench notes are what the
    // workshop actually works from.
    //
    // Deliberately NOT mergeInstructions(): that folds stoneDetails and
    // diamondDetails in with the bench notes, and describeSettings has already
    // printed both under their own labels — so the stones came out twice, once
    // as "Stones: …" and once bare underneath. Only what describeSettings does
    // not cover is added here.
    //
    // adminNote is internal and never goes on an estimate or invoice. This
    // slip is internal, which is the one place it should appear.
    const notes = [...describeSettings(item)];
    const bench = [item.adminNote, (item as { notes?: string }).notes]
      .map(v => (v || '').trim())
      .filter((v, i, a) => v && a.indexOf(v) === i);
    bench.forEach(v => v.split('\n').filter(Boolean).forEach(l => notes.push(l)));

    return {
      name: item.description || '—',
      spec: [
        categoryTitle,
        metalPart,
        item.size ? `Size ${item.size}` : '',
        item.referenceSku ? `Ref ${item.referenceSku}` : '',
      ].filter(Boolean).join('  ·  '),
      settings: notes,
      breakdown: [],
    };
  });
}

/**
 * The money, laid out the way the invoice lays it out: a right-aligned pair of
 * columns under the item table, subtotal down to what is still owed.
 *
 * It used to be three lines crammed into the header beside the customer
 * details — "Est:", "Advance Paid:", "- PKR 0" — which showed the advance
 * without ever showing what was left to pay, the one figure the slip is
 * carried around to answer.
 *
 * Returns the y after the last line drawn.
 */
export function drawOrderTotals(
  doc: jsPDF,
  order: Order,
  opts: { pageWidth: number; margin: number; startY: number },
): number {
  const { pageWidth, margin, startY } = opts;
  const cash = order.advancePayment || 0;
  const inKind = order.advanceInExchangeValue || 0;
  const discount = order.discountAmount || 0;
  const what = order.advanceInExchangeDescription?.trim();

  const rows: TotalRow[] = [{ label: 'Subtotal', value: money(order.subtotal || 0) }];
  if (discount > 0) rows.push({ label: 'Discount', value: `- ${money(discount)}`, tone: 'ink' });

  const after: TotalRow[] = [];
  if (cash > 0) after.push({ label: 'Advance paid', value: `- ${money(cash)}` });
  if (inKind > 0) after.push({ label: what ? `Advance in exchange (${what})` : 'Advance in exchange', value: `- ${money(inKind)}` });

  return drawTotals(doc, {
    pageWidth, margin, startY,
    rows,
    total: { label: 'Estimated Total', value: money(order.grandTotal || 0) },
    after,
    // Always shown, even at zero: "what is still owed" is the question the
    // slip exists to answer, and a blank is not an answer.
    closing: { label: 'Balance Due', value: money(Math.max(0, (order.grandTotal || 0) - cash - inKind)) },
  });
}
