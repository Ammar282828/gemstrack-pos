"use client";

/**
 * The repair receipt: the customer's proof that their pieces are with us.
 *
 * One line per piece — what it is, what is being done, what it weighed when it
 * came in, what it costs — then the total, what has been paid and what is due.
 * Same letterhead as the invoice. Printed when the pieces come in and, if
 * wanted, again when they go back (it then shows what was paid). A line to sign
 * at both ends, because for gold "it came back lighter" is the one argument a
 * repair counter has, and the weights are on this paper.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { STORE_LOGO_ASPECT } from '@/lib/store-config';
import { type Repair, repairBalance, repairTotal } from '@/lib/store';
import { openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { loadPdfLogo } from '@/lib/pdf-logo';
import { drawDocHeader, drawDocFooter, drawTotals, drawRowRule, alignHeadCell, tableStyles, hairline, label, FOOTER_HEIGHT, type TotalRow } from '@/lib/pdf-chrome';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: { finalY?: number };
  }
}

const COLUMNS = {
  0: { cellWidth: 7, halign: 'center' },
  1: { cellWidth: 'auto' },
  2: { cellWidth: 20, halign: 'right' },
  3: { cellWidth: 24, halign: 'right' },
} as const;

const pkr = (n: number) => `PKR ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const day = (iso?: string) => {
  if (!iso) return '';
  try { return format(parseISO(iso), 'd MMM yyyy'); } catch { return iso; }
};

export async function buildRepairPdf(r: Repair): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const logo = await loadPdfLogo();
  const drawHeader = (pageNum: number) => drawDocHeader(doc, {
    pageWidth, pageHeight, margin, title: 'Repair receipt',
    logoDataUrl: logo?.dataUrl ?? null, logoFormat: logo?.format ?? 'PNG', logoAspect: STORE_LOGO_ASPECT, pageNum,
  });
  drawHeader(1);

  let y = 28;
  label(doc, 'Received from', margin, y);
  label(doc, 'Repair', pageWidth / 2, y);
  y += 5;
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0);
  const who = [r.customerName || 'Walk-in customer', r.customerContact ? `Phone: ${r.customerContact}` : ''].filter(Boolean);
  doc.text(who.join('\n'), margin, y, { lineHeightFactor: 1.4 });
  const when = [
    `Repair #: ${r.id}`,
    `Received: ${day(r.receivedAt)}`,
    r.promisedDate ? `Ready by: ${day(r.promisedDate)}` : '',
    r.status === 'collected' && r.collectedAt ? `Collected: ${day(r.collectedAt)}` : '',
  ].filter(Boolean);
  doc.text(when.join('\n'), pageWidth / 2, y, { lineHeightFactor: 1.4 });
  y += Math.max(who.length, when.length) * 4 + 4;

  const pieces = (r.pieces || []).filter((p) => p.item || p.work);
  doc.autoTable({
    ...tableStyles(margin),
    head: [['#', 'Piece and work', 'Weight', 'Price']],
    body: pieces.map((p, i) => [
      i + 1,
      p.work ? `${p.item}\n${p.work}` : p.item,
      p.weightG ? `${p.weightG.toFixed(3)} g` : '—',
      p.price ? pkr(p.price) : '—',
    ]),
    startY: y,
    columnStyles: COLUMNS,
    didParseCell: (data: any) => {
      alignHeadCell(data, COLUMNS);
      // The piece in ink, the work under it in grey.
      if (data.section === 'body' && data.column.index === 1) data.cell.styles.fontSize = 8.5;
    },
    didDrawCell: (data: any) => drawRowRule(doc, data, 3, { margin, pageWidth }),
    didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
      if (data.pageNumber > 1) { doc.setPage(data.pageNumber); data.settings.startY = 28; }
      drawHeader(data.pageNumber);
    },
  });
  y = (doc.lastAutoTable.finalY || y) + 8;

  const total = repairTotal(r);
  const payments: TotalRow[] = (r.payments || []).map((p) => ({
    label: `${p.note || 'Paid'} · ${day(p.date)}${p.method ? ` · ${p.method}` : ''}`,
    value: `- ${pkr(p.amount)}`,
  }));
  if (total > 0 || payments.length) {
    y = drawTotals(doc, {
      pageWidth, pageHeight, margin, startY: y, onNewPage: drawHeader,
      rows: [],
      total: { label: pieces.length > 1 ? `Total · ${pieces.length} pieces` : 'Total', value: pkr(total) },
      after: payments,
      closing: r.status === 'cancelled' ? undefined : { label: 'Balance due', value: pkr(repairBalance(r)) },
    });
  }

  // Signatures, just above the footer — on a new page if the list ran long.
  let signY = pageHeight - FOOTER_HEIGHT - 16;
  if (y + 10 > signY) { doc.addPage(); drawHeader(doc.getNumberOfPages()); signY = pageHeight - FOOTER_HEIGHT - 16; }
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(110);
  doc.text(r.status === 'cancelled' ? 'This repair was cancelled.' : 'Please bring this receipt when you collect your pieces.', margin, signY - 4);
  hairline(doc, margin, signY + 8, margin + 50, 'rule');
  hairline(doc, pageWidth - margin - 50, signY + 8, pageWidth - margin, 'rule');
  label(doc, 'For the shop', margin, signY + 12, { size: 5.5 });
  label(doc, r.status === 'collected' ? 'Collected by' : 'Customer', pageWidth - margin - 50, signY + 12, { size: 5.5 });

  drawDocFooter(doc, {
    pageWidth, pageHeight, margin,
    linksQr: document.getElementById('links-qr-code') as HTMLCanvasElement | null,
    whatsappQr: document.getElementById('wa-qr-code') as HTMLCanvasElement | null,
    instagramQr: document.getElementById('insta-qr-code') as HTMLCanvasElement | null,
  });
  return doc;
}

export async function saveRepairPdf(r: Repair): Promise<void> {
  if (typeof window === 'undefined') return;
  const iOSWin = openPDFWindowForIOS();
  try {
    await savePDF(await buildRepairPdf(r), `Repair-${r.id}.pdf`, iOSWin);
  } catch (e) {
    iOSWin?.close();
    throw e;
  }
}
