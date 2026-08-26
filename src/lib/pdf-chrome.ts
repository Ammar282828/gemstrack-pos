/**
 * The furniture every generated document shares: the header, the rules, the
 * section labels, the table styling and the footer.
 *
 * These were copied into four builders — the invoice, the public invoice, the
 * cart estimate and the workshop slip — which is why they had drifted into
 * four slightly different documents from the same shop, and why the last
 * column-width bug had to be fixed in four places.
 *
 * On the look: the wordmark is a wide-letterspaced serif in a single deep
 * maroon, #380000. The documents around it were doing none of that — flat grey
 * header fills, a 14pt bold ESTIMATE shouting beside the logo, and every cell
 * boxed in on four sides. So the type here echoes the mark instead of
 * competing with it (small, letterspaced, uppercase), the maroon is the only
 * colour, and the tables are ruled horizontally rather than caged.
 */

import type { jsPDF } from 'jspdf';
import { STORE_CONFIG } from '@/lib/store-config';

type RGB = readonly [number, number, number];

/** Body copy. Never pure black — it hardens the page against the maroon. */
export const INK: RGB = [28, 26, 26];
/** The wordmark colour. The only colour in the document. */
export const BRAND: RGB = [56, 0, 0];
/** Specs, captions, the footer. */
export const MUTED: RGB = [130, 124, 124];
/** Hairlines, warmed very slightly toward the brand so they do not read blue. */
export const RULE: RGB = [216, 208, 208];
/** The one filled area, behind the figure that matters. */
export const BAND: RGB = [247, 243, 243];

const setInk = (doc: jsPDF, c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
const setDraw = (doc: jsPDF, c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);

/** Right-aligned at `x`, shortened with an ellipsis if it will not fit. */
function fitTextRight(doc: jsPDF, text: string, x: number, y: number, maxWidth: number): void {
  let t = text;
  if (doc.getTextWidth(t) > maxWidth) {
    while (t.length > 1 && doc.getTextWidth(`${t}…`) > maxWidth) t = t.slice(0, -1);
    t = `${t.trimEnd()}…`;
  }
  doc.text(t, x, y, { align: 'right' });
}

/**
 * A small letterspaced uppercase label — the document's one typographic idea,
 * borrowed from the wordmark. Char spacing is global state in jsPDF, so it is
 * always put back.
 */
export function label(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  opts: { size?: number; spacing?: number; colour?: RGB; align?: 'left' | 'right' } = {},
): void {
  const { size = 6, spacing = 1.1, colour = MUTED, align = 'left' } = opts;
  const upper = text.toUpperCase();
  doc.setFont('helvetica', 'bold').setFontSize(size);
  setInk(doc, colour);

  // getTextWidth ignores char spacing — measured, it returns the same number
  // with spacing set and unset — so jsPDF aligns from the unspaced width and
  // the text overhangs its anchor by the spacing it then adds. Right-aligning
  // the header title that way ran it off the edge of the page. The PDF Tc
  // operator applies after every glyph, so the overhang is spacing × length.
  const overhang = spacing * upper.length;
  const anchor = align === 'right' ? x - overhang : x;

  doc.setCharSpace(spacing);
  doc.text(upper, anchor, y, { align });
  doc.setCharSpace(0);
  setInk(doc, INK);
}

/** A hairline. `weight` 'hair' for row rules, 'rule' for section divisions. */
export function hairline(
  doc: jsPDF,
  x1: number,
  y: number,
  x2: number,
  weight: 'hair' | 'rule' | 'brand' = 'hair',
): void {
  setDraw(doc, weight === 'brand' ? BRAND : RULE);
  doc.setLineWidth(weight === 'hair' ? 0.1 : weight === 'rule' ? 0.2 : 0.4);
  doc.line(x1, y, x2, y);
  doc.setLineWidth(0.2);
}

export interface HeaderOpts {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  /** ESTIMATE, INVOICE, WORKSHOP ORDER SLIP. */
  title: string;
  logoDataUrl: string | null;
  logoFormat: string;
  logoAspect: number;
  pageNum: number;
}

/** Wordmark left, document title right, one brand rule under both. */
export function drawDocHeader(doc: jsPDF, o: HeaderOpts): number {
  const { pageWidth, pageHeight, margin, title, logoDataUrl, logoFormat, logoAspect, pageNum } = o;

  if (logoDataUrl) {
    try {
      const h = 8;
      doc.addImage(logoDataUrl, logoFormat, margin, 9, h * logoAspect, h, undefined, 'FAST');
    } catch { /* a missing logo must not stop the document */ }
  }

  // Small and letterspaced rather than 14pt bold: beside a wordmark this size,
  // the old title read as a second, louder logo.
  label(doc, title, pageWidth - margin, 15, { size: 8, spacing: 1.6, colour: BRAND, align: 'right' });
  hairline(doc, margin, 22, pageWidth - margin, 'brand');

  if (pageNum > 1) {
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    setInk(doc, MUTED);
    doc.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 5, { align: 'right' });
    setInk(doc, INK);
  }
  return 22;
}

/**
 * autoTable styling, shared so the four documents cannot drift again.
 *
 * `plain` and hairlines drawn per row rather than `grid`: a caged table on a
 * small page reads as a spreadsheet, and the piece is the thing being sold.
 * `margin` is passed explicitly because autoTable otherwise defaults to its
 * own ~14.11mm, which silently invalidates any column arithmetic the caller
 * has done — that is what put the specification line under the Qty figure.
 */
export function tableStyles(margin: number) {
  return {
    theme: 'plain' as const,
    margin: { left: margin, right: margin },
    headStyles: {
      fillColor: false as unknown as undefined,
      textColor: BRAND as unknown as number[],
      fontStyle: 'bold' as const,
      fontSize: 6.5,
      cellPadding: { top: 1.6, bottom: 2.2, left: 2, right: 2 },
    },
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 2.4, bottom: 2.4, left: 2, right: 2 },
      valign: 'top' as const,
      textColor: INK as unknown as number[],
    },
  };
}

/**
 * Row rules. Call from didDrawCell on the LAST column only, so one line is
 * drawn per row rather than one per cell.
 */
export function drawRowRule(
  doc: jsPDF,
  data: { section: string; column: { index: number }; cell: { y: number; height: number } },
  lastColumnIndex: number,
  bounds: { margin: number; pageWidth: number },
): void {
  if (data.column.index !== lastColumnIndex) return;
  const y = data.cell.y + data.cell.height;
  hairline(doc, bounds.margin, y, bounds.pageWidth - bounds.margin, data.section === 'head' ? 'rule' : 'hair');
}

/**
 * autoTable does not apply columnStyles.halign to head cells — measured, every
 * one comes back 'left' — so the column headings sat left of the figures they
 * label. Call this first from didParseCell.
 */
export function alignHeadCell(
  data: { section: string; column: { index: number }; cell: { styles: { halign?: string } } },
  // Indexed loosely: callers pass their real columnStyles, where most entries
  // carry only a width.
  columnStyles: Record<number, { halign?: string; cellWidth?: number | string }>,
): void {
  if (data.section !== 'head') return;
  const a = columnStyles[data.column.index]?.halign;
  if (a) data.cell.styles.halign = a;
}

/**
 * The tinted band behind the closing figure, sized to actually contain it.
 *
 * It was drawn a fixed 16mm left of the label's right-hand anchor, but the
 * label is right-aligned, so it extends leftwards by however wide it happens to
 * be — "Balance Due" at 10pt is wider than 16mm and hung outside the tint.
 * Measured at the size it will be drawn in, since getTextWidth reads the
 * current font.
 */
export function bandFor(
  doc: jsPDF,
  text: string,
  labelX: number,
  totalsX: number,
  size: number,
): { x: number; w: number } {
  doc.setFont('helvetica', 'bold').setFontSize(size);
  const pad = 3.5;
  const x = labelX - doc.getTextWidth(text) - pad;
  return { x, w: totalsX - x + pad / 2 };
}

export interface TotalRow {
  label: string;
  value: string;
  /** 'ink' for the amounts that change the total, 'muted' for the rest. */
  tone?: 'ink' | 'muted';
}

export interface TotalsOpts {
  pageWidth: number;
  margin: number;
  startY: number;
  /** Runs above the rule: subtotal, discount, adjustments, exchange. */
  rows: TotalRow[];
  /** The bold line under the rule. */
  total: TotalRow;
  /** What has been paid, between the total and the closing figure. */
  after?: TotalRow[];
  /** The banded figure the reader is looking for. Omitted when nothing is due. */
  closing?: TotalRow;
}

/**
 * The totals column, shared by the three invoice builders and the workshop
 * slip so they cannot drift into four different-looking documents again.
 *
 * Returns the y after the last line.
 */
export function drawTotals(doc: jsPDF, o: TotalsOpts): number {
  const { pageWidth, margin, startY, rows, total, after = [], closing } = o;
  const totalsX = pageWidth - margin;
  const labelX = totalsX - 44;
  const labelW = Math.max(0, labelX - margin);
  let y = startY;

  const line = (r: TotalRow, bold: boolean, size: number, colour: RGB) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);
    setInk(doc, colour);
    // Truncated rather than allowed to run: an exchange description is
    // free text and grows leftwards out of the column.
    if (r.label) fitTextRight(doc, r.label, labelX, y, labelW);
    if (r.value) doc.text(r.value, totalsX, y, { align: 'right' });
    setInk(doc, INK);
  };

  rows.forEach(r => { line(r, false, 8, r.tone === 'ink' ? INK : MUTED); y += 5; });

  hairline(doc, labelX - 16, y, totalsX, 'rule');
  y += 6;
  line(total, true, 9, INK);
  y += 5.5;

  after.forEach(r => { line(r, false, 8, r.tone === 'ink' ? INK : MUTED); y += 5; });

  if (closing) {
    y += 1;
    const band = bandFor(doc, closing.label, labelX, totalsX, 10);
    doc.setFillColor(BAND[0], BAND[1], BAND[2]);
    doc.rect(band.x, y, band.w, 9, 'F');
    y += 6;
    line(closing, true, 10, BRAND);
    y += 4;
  }

  doc.setFont('helvetica', 'normal').setFontSize(9);
  return y;
}

export interface FooterOpts {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  /** Canvas elements rendered elsewhere on the page; absent in tests. */
  whatsappQr?: HTMLCanvasElement | null;
  instagramQr?: HTMLCanvasElement | null;
}

/** Contacts and bank on the left, the two codes on the right. */
export function drawDocFooter(doc: jsPDF, o: FooterOpts): void {
  const { pageWidth, pageHeight, margin, whatsappQr, instagramQr } = o;
  const contacts = [
    [STORE_CONFIG.contact1Name, STORE_CONFIG.contact1Number],
    [STORE_CONFIG.contact2Name, STORE_CONFIG.contact2Number],
    [STORE_CONFIG.contact3Name, STORE_CONFIG.contact3Number],
    [STORE_CONFIG.contact4Name, STORE_CONFIG.contact4Number],
  ].filter(([n, v]) => n && v);

  const qrSize = 15;
  const qrGap = 3;
  const qrBlock = qrSize * 2 + qrGap;
  const qrX = pageWidth - margin - qrBlock;
  const textW = pageWidth - margin * 2 - qrBlock - 6;

  const top = pageHeight - 34;
  hairline(doc, margin, top, pageWidth - margin, 'rule');

  label(doc, 'Orders & enquiries', margin, top + 4.5, { size: 5.5, spacing: 0.9 });
  doc.setFont('helvetica', 'normal').setFontSize(7);
  setInk(doc, INK);
  contacts.forEach(([n, v], i) =>
    doc.text(`${n}  ${v}`, margin, top + 9 + i * 3.6, { maxWidth: textW }),
  );

  const afterContacts = top + 9 + contacts.length * 3.6;
  label(doc, 'Bank', margin, afterContacts + 2.5, { size: 5.5, spacing: 0.9 });
  doc.setFont('helvetica', 'normal').setFontSize(6.5);
  setInk(doc, MUTED);
  doc.text(STORE_CONFIG.bankLine, margin, afterContacts + 6.5, { maxWidth: textW });
  if (STORE_CONFIG.iban) doc.text(STORE_CONFIG.iban, margin, afterContacts + 10, { maxWidth: textW });
  setInk(doc, INK);

  const code = (canvas: HTMLCanvasElement | null | undefined, x: number, caption: string) => {
    if (!canvas) return;
    try {
      doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, top + 4, qrSize, qrSize);
      // Centred by hand for the same reason: half the overhang, on the left.
      doc.setFont('helvetica', 'bold').setFontSize(4.8);
      const w = doc.getTextWidth(caption.toUpperCase()) + 0.6 * caption.length;
      label(doc, caption, x + qrSize / 2 - w / 2, top + qrSize + 7, { size: 4.8, spacing: 0.6 });
    } catch { /* a missing code must not stop the document */ }
  };
  code(whatsappQr, qrX, 'WhatsApp');
  code(instagramQr, qrX + qrSize + qrGap, 'Instagram');
}
