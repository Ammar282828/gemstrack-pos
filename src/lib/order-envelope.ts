/**
 * The envelope's sheet: the order in full, for the small paper envelope the piece travels in (the owner, 2026-11-28: "we
 * write the full details on a small paper envelope … so we can then just fold it and staple it onto the envelope"; "the
 * paper envelope is h4.5xw3.5 inches"; "All the important details, the advance amounts, the remaining payments, the
 * estimates, the advance, the rates, the sizes, the items, the if there's any special instructions. I want all of it on
 * there").
 *
 * A page added after whichever order slip the house prints (lib/order-slip-pdf.ts; STORE_ORDER_ENVELOPE, on for Taheri):
 * an A5 sheet whose words sit in a box the envelope's size — 3.5 × 4.5 in, 88.9 × 114.3 mm — in its top-left corner, with
 * dashed cut lines on the box's two inner edges, so two straight cuts make the envelope's face. Large type that steps down
 * for a long order; past the smallest it says to staple the whole page.
 */

import type jsPDF from 'jspdf';
import type { Order } from '@/lib/store';
import { buildOrderItemBlocks } from '@/lib/order-slip';
import { orderFullTotal } from '@/lib/order-payment';
import { cardRates } from '@/lib/order-card-slip';

const pkr = (n: number) => `PKR ${Math.round(n || 0).toLocaleString('en-PK')}`;

export interface EnvelopeText {
  head: string;
  dates: string;
  money: string[];
  pieces: { title: string; lines: string[] }[];
  notes: string;
}

/** What the envelope says, in order: who and which order, when, the money, every piece in full, the instructions. */
export function envelopeLines(order: Order, day: (iso: string) => string): EnvelopeText {
  const blocks = buildOrderItemBlocks(order);
  const o = order as Order & { customerContact?: string; notes?: string; advances?: { amount?: number; date?: string; method?: string }[] };
  const advanceCash = o.advancePayment || 0, advanceGold = o.advanceInExchangeValue || 0;
  const advances = (o.advances ?? []).filter(a => (a.amount || 0) > 0);
  const money = [
    `Estimate ${pkr(orderFullTotal(order))}`,
    advances.length > 1
      ? `Advances ${advances.map(a => `${pkr(a.amount || 0)}${a.date ? ` (${day(a.date)}${a.method ? `, ${a.method}` : ''})` : ''}`).join(' + ')}`
      : advanceCash > 0 ? `Advance ${pkr(advanceCash)}${advances[0]?.method ? ` (${advances[0].method})` : ''}` : 'No advance',
    advanceGold > 0 ? `Taken in exchange ${pkr(advanceGold)}` : '',
    `Balance ${pkr(o.grandTotal)}`,
    cardRates(order) ? `Rate ${cardRates(order)}` : '',
  ].filter(Boolean);
  return {
    head: [order.id, order.customerName || 'Walk-in', o.customerContact].filter(Boolean).join('  ·  '),
    dates: [`Taken ${day(order.createdAt)}`, order.promisedDate ? `Ready by ${day(order.promisedDate)}` : '', order.takenBy ? `by ${order.takenBy}` : ''].filter(Boolean).join('  ·  '),
    money,
    pieces: order.items.map((it, i) => {
      const b = blocks[i];
      const est = (it as { totalEstimate?: number }).totalEstimate;
      const lines = [b?.spec, ...(b?.settings ?? []), est ? `Est. ${pkr(est)}` : '', it.sampleGiven ? 'Sample given' : '']
        .filter((l): l is string => !!l && !!l.trim());
      return { title: `${i + 1}. ${b?.name ?? (it.description || 'Piece')}`, lines };
    }),
    notes: String(o.notes ?? '').trim(),
  };
}

/** The sheet, added to the slip's document as its last page, or on the first page of a document of its own (`own`). */
export function drawEnvelopeSheet(doc: jsPDF, order: Order, day: (iso: string) => string, own = false): void {
  if (!own) doc.addPage('a5', 'portrait');
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  // The envelope: 3.5 in wide, 4.5 in tall, from the sheet's top-left corner.
  const BW = 88.9, BH = 114.3, left = 6, right = BW - 5;
  const e = envelopeLines(order, day);

  // Lay it out at a size and say how far down it reaches; the largest size that fits the envelope wins.
  const layout = (size: number, draw: boolean): number => {
    let y = 9;
    const text = (t: string, x: number, o: { bold?: boolean; grey?: boolean; at?: number } = {}) => {
      const at = o.at ?? size;
      doc.setFont('helvetica', o.bold ? 'bold' : 'normal').setFontSize(at).setTextColor(o.grey ? 90 : 20);
      const lines = doc.splitTextToSize(t, right - x) as string[];
      if (draw) doc.text(lines, x, y);
      y += lines.length * at * 0.42;
    };
    const rule = () => { if (draw) doc.setDrawColor(200).setLineWidth(0.15).line(left, y - size * 0.25, right, y - size * 0.25); y += size * 0.12; };
    text(e.head, left, { bold: true, at: size + 1 });
    text(e.dates, left, { grey: true });
    y += size * 0.15; rule();
    for (const m of e.money) text(m, left, { bold: m.startsWith('Balance') });
    y += size * 0.15; rule();
    for (const p of e.pieces) {
      text(p.title, left, { bold: true });
      for (const l of p.lines) text(l, left + 3);
      y += size * 0.12;
    }
    if (e.notes) { rule(); text(`Instructions: ${e.notes}`, left, { bold: true }); }
    return y;
  };
  let size = 10;
  while (size > 6 && layout(size, false) > BH - 5) size -= 0.5;
  const reach = layout(size, true);
  doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(150);
  if (reach <= BH - 3) {
    // The cuts: down the box's right edge and along its foot.
    doc.setDrawColor(150).setLineWidth(0.2).setLineDashPattern([1.5, 1.5], 0);
    doc.line(BW, 0, BW, BH + 4).line(0, BH, BW + 4, BH).setLineDashPattern([], 0);
    doc.text('cut', BW + 1.5, BH / 2, { angle: 90 });
    doc.text('cut', BW / 2, BH + 3.5, { align: 'center' });
  } else {
    doc.text(`${order.id} · too long for the envelope: staple the whole page`, W / 2, H - 6, { align: 'center' });
  }
}
