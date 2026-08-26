/**
 * The item cell on a printed invoice.
 *
 * autoTable renders a cell as one run of text at one size, so the piece's
 * name, its specification and its cost breakdown all came out identical —
 * with the category shouting in caps above the name of the thing the customer
 * actually bought. Nothing told you where the description ended and the
 * arithmetic began.
 *
 * So this cell is drawn by hand: the name leads, the specification sits under
 * it in grey, what is set into the piece gets its own line, and the cost
 * breakdown is smaller and indented beneath a hairline. autoTable is told the
 * height in didParseCell so rows still size themselves correctly.
 */

import type jsPDF from 'jspdf';

export interface ItemBlock {
  /** What the customer bought. */
  name: string;
  /** Category · metal · weight · size · SKU. */
  spec: string;
  /** Diamonds, stones, finish — what is actually in the piece. */
  settings: string[];
  /** Metal / wastage / making / stones, already formatted. */
  breakdown: string[];
}

const PT_MM = 0.3528;
const line = (pt: number) => pt * PT_MM * 1.2;

const NAME_PT = 8.4;
const SPEC_PT = 6.8;
const SET_PT = 7;
const BRK_PT = 6.6;
/** Space above the breakdown rule. */
const RULE_GAP = 1.1;

type Wrapped = { name: string[]; spec: string[]; settings: string[]; breakdown: string[] };

function wrap(doc: jsPDF, b: ItemBlock, w: number): Wrapped {
  // The style has to match what will actually be drawn. Measuring the name in
  // the regular face while drawing it bold made it wrap too late, and a long
  // name ran out of the column and over the Qty figure beside it.
  const split = (t: string, pt: number, width: number, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont('helvetica', style);
    doc.setFontSize(pt);
    return doc.splitTextToSize(t, width) as string[];
  };
  return {
    name: split(b.name || '—', NAME_PT, w, 'bold'),
    spec: b.spec ? split(b.spec, SPEC_PT, w) : [],
    settings: b.settings.flatMap(s => split(s, SET_PT, w)),
    // Indented, so a narrower measure.
    breakdown: b.breakdown.flatMap(s => split(s, BRK_PT, w - 2)),
  };
}

/**
 * Height in mm, so autoTable can size the row before anything is drawn.
 *
 * `minCellHeight` includes padding — measured, not assumed: setting it to 10
 * with 2mm padding yields a 10mm cell, not 14 — so padding is added here.
 *
 * `cellWidth` must be the *content* width and must match what drawItemCell
 * uses. Reading data.cell.width inside didParseCell does not work: column
 * widths are not settled at parse time, so the height was computed against a
 * different measure than the drawing, and rows came out too tall or clipped
 * depending on which way the guess went.
 */
export function itemCellHeight(doc: jsPDF, b: ItemBlock, cellWidth: number, padding = 2): number {
  const w = wrap(doc, b, cellWidth - padding * 2);
  let h = w.name.length * line(NAME_PT)
        + w.spec.length * line(SPEC_PT)
        + w.settings.length * line(SET_PT);
  if (w.breakdown.length) h += RULE_GAP + w.breakdown.length * line(BRK_PT);
  return h + padding * 2;
}

export function drawItemCell(
  doc: jsPDF,
  b: ItemBlock,
  cell: { x: number; y: number; width?: number },
  cellWidth: number,
  padding = 2,
): void {
  // Draw to whichever is narrower: the width the caller measured with, or the
  // width the cell actually turned out to be. They are supposed to agree, and
  // when they did not — autoTable defaults to its own ~14.11mm page margin, so
  // a caller using 10 computed a column 8.2mm wider than it got — the spec line
  // ran out of the column and into the Qty figure beside it. Getting this wrong
  // in the safe direction only costs a slightly tall row; the other direction
  // is unreadable.
  const width = Math.min(cellWidth, cell.width ?? cellWidth) - padding * 2;
  const w = wrap(doc, b, width);
  const x = cell.x + padding;
  let y = cell.y + padding;

  doc.setFont('helvetica', 'bold').setFontSize(NAME_PT).setTextColor(20, 20, 20);
  for (const l of w.name) { y += line(NAME_PT); doc.text(l, x, y - line(NAME_PT) * 0.25); }

  doc.setFont('helvetica', 'normal').setFontSize(SPEC_PT).setTextColor(120, 120, 120);
  for (const l of w.spec) { y += line(SPEC_PT); doc.text(l, x, y - line(SPEC_PT) * 0.25); }

  // Darker than the spec line: this is the part a valuer reads.
  doc.setFontSize(SET_PT).setTextColor(55, 55, 55);
  for (const l of w.settings) { y += line(SET_PT); doc.text(l, x, y - line(SET_PT) * 0.25); }

  if (w.breakdown.length) {
    y += RULE_GAP;
    doc.setDrawColor(215, 215, 215).setLineWidth(0.1);
    doc.line(x, y - 0.6, x + Math.min(width, 46), y - 0.6);
    doc.setFontSize(BRK_PT).setTextColor(130, 130, 130);
    for (const l of w.breakdown) { y += line(BRK_PT); doc.text(l, x + 2, y - line(BRK_PT) * 0.25); }
  }

  // autoTable keeps drawing after this hook.
  doc.setTextColor(0, 0, 0).setFont('helvetica', 'normal');
}
