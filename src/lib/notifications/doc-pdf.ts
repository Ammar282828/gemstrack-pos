/**
 * An AlertDoc (doc.ts) drawn as a PDF for a phone: what every WhatsApp alert and report to the
 * shop's own numbers now is.
 *
 * The page is phone-shaped, 100 × 178 mm (9:16), not A4. These are read in WhatsApp's viewer,
 * which fits the page's width to the screen: on A4 the type comes out a third of its size and
 * every report needs pinching; at 100 mm it reads at about a phone's own text size. The monthly
 * report stays A4 (it is printed and kept). The furniture is the invoices' (pdf-chrome.ts): the
 * wordmark, the maroon as the only colour, letterspaced labels, ruled tables.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { STORE_LOGO_ASPECT } from '@/lib/store-config';
import { POS_LABEL } from '@/lib/notify-label';
import { BAND, BRAND, hairline, INK, label, MUTED, tableStyles } from '@/lib/pdf-chrome';
import { plain, type ReportLogo } from '@/lib/reports/monthly-pdf';
import { stamp, type AlertDoc, type Figure, type Section, type Table, type Tone } from './doc';

export const PAGE_W = 100;
export const PAGE_H = 178;
const M = 7;
/** Where the header ends and a continued page's content starts. */
const TOP = 22;
/** Room kept for the footer line. */
const BOTTOM = 12;

type RGB = readonly [number, number, number];
const toneInk = (t: Tone | undefined): RGB => (t === 'flag' ? BRAND : t === 'muted' ? MUTED : INK);

export function renderAlertPdf(d: AlertDoc, logo: ReportLogo | null): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, PAGE_H] });
  const W = PAGE_W, H = PAGE_H, CW = W - 2 * M;
  const ink = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

  const header = () => {
    if (logo) {
      try {
        // No wider than 40 mm, so the title beside it always fits.
        const h = Math.min(6, 40 / STORE_LOGO_ASPECT);
        doc.addImage(logo.dataUrl, logo.format, M, 7 + (6 - h) / 2, h * STORE_LOGO_ASPECT, h, undefined, 'FAST');
      } catch { /* a missing logo must not stop the document */ }
    }
    label(doc, plain(d.title), W - M, 11.5, { size: 6.5, spacing: 0.9, colour: BRAND, align: 'right' });
    hairline(doc, M, 16, W - M, 'brand');
  };

  let y = 0;
  const room = (need: number) => {
    if (y + need > H - BOTTOM) { doc.addPage(); header(); y = TOP + 2; }
  };

  const figures = (list: Figure[]) => {
    const gap = 3;
    const perRow = list.length === 1 ? 1 : list.length === 3 ? 3 : 2;
    const w = (CW - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < list.length; i += perRow) {
      room(18);
      list.slice(i, i + perRow).forEach((f, j) => {
        const x = M + j * (w + gap);
        // The first figure on the one tinted band, as on the invoice and the monthly report.
        if (i === 0 && j === 0) { doc.setFillColor(BAND[0], BAND[1], BAND[2]); doc.rect(x - 1.5, y - 3.5, w + 1.5, 16.5, 'F'); }
        label(doc, plain(f.label), x, y, { size: 5.5, spacing: 0.7 });
        doc.setFont('helvetica', 'bold').setFontSize(perRow === 3 ? 10.5 : 12.5);
        ink(f.tone === 'flag' || (i === 0 && j === 0) ? BRAND : toneInk(f.tone));
        const value = doc.splitTextToSize(plain(f.value), w - 1) as string[];
        doc.text(value[0] ?? '', x, y + 6.5);
        if (f.note) {
          doc.setFont('helvetica', 'normal').setFontSize(6.3);
          ink(MUTED);
          doc.text((doc.splitTextToSize(plain(f.note), w - 1) as string[]).slice(0, 2), x, y + 10.5);
        }
      });
      y += f2Height(list.slice(i, i + perRow));
    }
  };
  const f2Height = (row: Figure[]) => (row.some(f => f.note && f.note.length > 26) ? 19 : 17);

  const pairs = (list: NonNullable<Section['pairs']>) => {
    for (const p of list) {
      doc.setFont('helvetica', p.strong ? 'bold' : 'normal').setFontSize(8.3);
      const lines = doc.splitTextToSize(plain(p.label), CW - 32) as string[];
      room(4.4 * lines.length + 1);
      ink(p.tone ? toneInk(p.tone) : p.strong ? INK : [70, 66, 66]);
      doc.text(lines, M, y);
      doc.text(plain(p.value), W - M, y, { align: 'right' });
      if (p.strong) hairline(doc, M, y - 3.6, W - M, 'hair');
      y += 4.6 * lines.length;
    }
  };

  const table = (t: Table) => {
    const n = t.columns.length;
    const columnStyles: Record<number, { cellWidth?: number | 'auto'; halign?: 'left' | 'right' }> = {};
    t.columns.forEach((c, i) => { columnStyles[i] = { cellWidth: c.width ?? 'auto', ...(c.align ? { halign: c.align } : {}) }; });
    // A row's detail is a row of its own under it, across every column, and the rule goes under the pair.
    type Meta = { tone?: Tone; detail: boolean; rule: boolean };
    const meta: Meta[] = [];
    const body: unknown[][] = [];
    t.rows.forEach((r, i) => {
      const detail = t.details?.[i];
      body.push(r.map(plain));
      meta.push({ tone: t.tones?.[i], detail: false, rule: !detail });
      if (detail) {
        body.push([{ content: plain(detail), colSpan: n }]);
        meta.push({ tone: t.tones?.[i], detail: true, rule: true });
      }
    });
    const base = tableStyles(M);
    doc.autoTable({
      ...base,
      margin: { left: M, right: M, top: TOP + 2, bottom: BOTTOM },
      startY: y,
      head: [t.columns.map(c => plain(c.label))],
      body,
      ...(t.foot ? { foot: [t.foot.map(plain)], showFoot: 'lastPage' } : {}),
      styles: { ...base.styles, fontSize: 7.6, cellPadding: { top: 1.7, bottom: 1.7, left: 1.2, right: 1.2 }, overflow: 'linebreak' },
      headStyles: { ...base.headStyles, fontSize: 6, cellPadding: { top: 1, bottom: 1.6, left: 1.2, right: 1.2 } },
      footStyles: { fontStyle: 'bold', textColor: INK as unknown as number[], fontSize: 7.6, cellPadding: { top: 2, bottom: 2, left: 1.2, right: 1.2 } },
      columnStyles,
      rowPageBreak: 'avoid',
      didParseCell: (data: any) => {
        const align = columnStyles[data.column.index]?.halign;
        if ((data.section === 'head' || data.section === 'foot') && align) data.cell.styles.halign = align;
        if (data.section !== 'body') return;
        const m = meta[data.row.index];
        if (!m) return;
        if (m.detail) {
          Object.assign(data.cell.styles, { fontSize: 6.5, textColor: MUTED as unknown as number[], halign: 'left', cellPadding: { top: 0, bottom: 1.8, left: 1.2, right: 1.2 } });
        } else {
          if (m.tone) data.cell.styles.textColor = toneInk(m.tone) as unknown as number[];
          if (m.tone === 'flag' && data.column.index === 0) data.cell.styles.fontStyle = 'bold';
          if (!m.rule) data.cell.styles.cellPadding = { top: 1.7, bottom: 0.6, left: 1.2, right: 1.2 };
        }
      },
      didDrawCell: (data: any) => {
        const m = data.section === 'body' ? meta[data.row.index] : null;
        const lastCell = data.column.index === n - 1 || (m?.detail ?? false);
        if (!lastCell) return;
        if (data.section === 'head' || (m && m.rule)) {
          hairline(doc, M, data.cell.y + data.cell.height, W - M, data.section === 'head' ? 'rule' : 'hair');
        }
      },
      didDrawPage: () => header(),
    });
    y = (doc.lastAutoTable.finalY || y) + 1;
  };

  const section = (s: Section) => {
    room(16);
    y += 5;
    label(doc, plain(s.title), M, y, { size: 6.5, spacing: 0.8, colour: BRAND });
    if (s.note) {
      doc.setFont('helvetica', 'normal').setFontSize(6.2);
      ink(MUTED);
      // A short note sits right of the title; a long one gets a line of its own under it.
      doc.setFont('helvetica', 'bold').setFontSize(6.5);
      const titleW = doc.getTextWidth(s.title.toUpperCase()) + 0.8 * s.title.length;
      doc.setFont('helvetica', 'normal').setFontSize(6.2);
      const noteW = doc.getTextWidth(plain(s.note));
      if (titleW + noteW + 4 < CW) doc.text(plain(s.note), W - M, y, { align: 'right' });
      else {
        const lines = doc.splitTextToSize(plain(s.note), CW) as string[];
        y += 3.4;
        doc.text(lines, M, y);
        y += 3 * (lines.length - 1);
      }
    }
    y += 3;
    const nothing = !s.figures?.length && !s.pairs?.length && !s.table?.rows.length && !s.text?.length;
    if (nothing) {
      doc.setFont('helvetica', 'normal').setFontSize(8);
      ink(MUTED);
      y += 3;
      doc.text(plain(s.empty ?? 'Nothing.'), M, y);
      y += 3;
      return;
    }
    if (s.figures?.length) { y += 3; figures(s.figures); }
    if (s.pairs?.length) { y += 3.2; pairs(s.pairs); }
    if (s.table?.rows.length) table(s.table);
    if (s.text?.length) {
      y += 3;
      doc.setFont('helvetica', 'normal').setFontSize(8.3);
      for (const para of s.text) {
        const lines = doc.splitTextToSize(plain(para), CW) as string[];
        for (const line of lines) { room(4.4); ink(INK); doc.text(line, M, y); y += 4.2; }
        y += 1.2;
      }
    }
  };

  // ── Page one: what it is, then its figures, then each section.
  header();
  y = 27;
  doc.setFont('helvetica', 'bold').setFontSize(15);
  ink(BRAND);
  const heading = doc.splitTextToSize(plain(d.heading), CW) as string[];
  doc.text(heading, M, y);
  y += 6 * heading.length - 0.5;
  if (d.subheading) {
    doc.setFont('helvetica', 'normal').setFontSize(8.3);
    ink(MUTED);
    const sub = doc.splitTextToSize(plain(d.subheading), CW) as string[];
    doc.text(sub, M, y);
    y += 3.8 * sub.length;
  }
  if (d.figures?.length) { y += 5; figures(d.figures); y -= 2; }
  for (const s of d.sections) section(s);
  if (d.footnote) {
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    const lines = doc.splitTextToSize(plain(d.footnote), CW) as string[];
    room(4 + 3 * lines.length);
    y += 4;
    ink(MUTED);
    doc.text(lines, M, y);
  }

  // ── Every page: whose, what, when, and where in it.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(5.8);
    ink(MUTED);
    doc.text(plain(`${POS_LABEL} · ${d.title} · made ${stamp(d.at)}`), M, H - 5.5, { maxWidth: CW - 14 });
    if (pages > 1) doc.text(`${p} / ${pages}`, W - M, H - 5.5, { align: 'right' });
  }
  return doc;
}
