/**
 * Drawing text into a space that has a known width.
 *
 * jsPDF's `doc.text()` will happily draw past the edge of the page, past a
 * table cell, and straight through whatever else is on that line — there is no
 * clipping. Every place a PDF prints something a person typed (a customer
 * name, an address, an exchange description) is therefore a place the layout
 * can be broken by a long enough value, and nothing about the code says so.
 *
 * These two helpers make the available width explicit at the call site.
 *
 * A note on measurement: `getTextWidth` and `splitTextToSize` both measure in
 * whatever font and size the document is set to AT CALL TIME, not the one in
 * effect when the text is finally drawn. Set the font first, then measure. A
 * name measured in regular and drawn in bold overflows by roughly 5%, which is
 * exactly enough to look like a rendering fault rather than a long name.
 */

import type { jsPDF } from 'jspdf';

/** Millimetres of clear air to leave between a left label and a right column. */
export const GUTTER = 4;

/**
 * Draw one line, shortened with an ellipsis if it will not fit in `maxWidth`.
 * Returns what was actually drawn, which is useful in tests.
 *
 * Use where the slot is a single line and truncating is honest — a name in a
 * header row beside a right-aligned figure. Where the value must be readable
 * in full, use `wrapText` and give it the vertical space instead.
 */
export function fitText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  options?: { align?: 'left' | 'center' | 'right' },
): string {
  const full = String(text ?? '');
  if (maxWidth <= 0) return '';
  if (doc.getTextWidth(full) <= maxWidth) {
    doc.text(full, x, y, options);
    return full;
  }

  // Binary search the longest prefix that fits with the ellipsis attached.
  const ell = '…';
  const ellW = doc.getTextWidth(ell);
  let lo = 0;
  let hi = full.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(full.slice(0, mid)) + ellW <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  // Do not leave a dangling space before the ellipsis.
  const out = full.slice(0, lo).trimEnd() + ell;
  doc.text(out, x, y, options);
  return out;
}

/**
 * Draw text wrapped to `maxWidth`, and return the y coordinate after the last
 * line so the caller can carry on beneath it.
 *
 * `maxLines` caps the height; the final line is ellipsised if there is more.
 */
export function wrapText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = Infinity,
): number {
  const full = String(text ?? '');
  if (!full || maxWidth <= 0) return y;

  const lines: string[] = doc.splitTextToSize(full, maxWidth);
  const shown = lines.slice(0, maxLines);
  let cursor = y;

  shown.forEach((line, i) => {
    const isLastShown = i === shown.length - 1;
    if (isLastShown && lines.length > shown.length) {
      fitText(doc, line, x, cursor, maxWidth);
    } else {
      doc.text(line, x, cursor);
    }
    cursor += lineHeight;
  });

  return cursor;
}

/**
 * The width a left-hand label may use before it would reach a right-aligned
 * column. `rightEdge` is where the right column ends (usually
 * `pageWidth - margin`); `rightWidth` is the widest string in it.
 */
export function widthBeforeColumn(x: number, rightEdge: number, rightWidth: number): number {
  return Math.max(0, rightEdge - rightWidth - GUTTER - x);
}
