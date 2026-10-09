/**
 * The workshop order slip as a PDF, from anywhere that has an order: the one builder.
 *
 * Lifted out of the invoices page so the orders list can print one per row without
 * opening the order first, and the order page's own copy folded into it (2026-10-09), so
 * the server draws the same slip too (lib/app-pdf.ts: the iPhone app's Print slip).
 *
 * drawOrderSlipPdf takes its pictures and its way of writing a day as inputs
 * (pdf-inputs.ts) and touches no page. generateOrderSlipPDF is the browser's: it pre-opens
 * the iOS window in the tap, reads the page's logo and its hidden <QRCode> canvases, draws
 * the slip and hands it to savePDF, which shares or downloads as the device allows. A page
 * that has not rendered the canvases gets a slip with no code rather than an error.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import type { Order, Settings } from '@/lib/store';
import { openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { fitText } from '@/lib/pdf-text';
import { drawDocHeader, tableStyles, drawRowRule, alignHeadCell } from '@/lib/pdf-chrome';
import { browserPdfImages, drawFooter, type PdfDates, type PdfImages } from '@/lib/pdf-inputs';
import { drawItemCell, itemCellHeight } from '@/lib/invoice-item-cell';
import { buildOrderItemBlocks, drawOrderTotals } from '@/lib/order-slip';
import { STORE_LOGO_ASPECT } from '@/lib/store-config';

/** Shared by the table and by alignHeadCell, which needs the same object. */
const SLIP_COLUMNS = { 0: { cellWidth: 7, halign: 'center' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 28, halign: 'right' } } as const;

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: { finalY?: number };
  }
}

export interface OrderSlipOptions {
  images: PdfImages;
  /** How days are written; the device's way when left out (the server passes Karachi's). */
  dates?: PdfDates;
}

/** "OrderSlip-ORD-000123.pdf", wherever it is saved from. */
export const orderSlipFileName = (order: Pick<Order, 'id'>) => `OrderSlip-${order.id}.pdf`;

/**
 * The slip, not yet saved, from what it is given. What it prints is the order it is handed:
 * staff are handed theirs without the bench's internal notes or the rates (lib/staff-view.ts),
 * as their browser holds it.
 */
export function drawOrderSlipPdf(order: Order, opts: OrderSlipOptions): jsPDF {
  const { images, dates } = opts;
  const day = dates?.medium ?? ((iso: string) => format(parseISO(iso), 'PP'));
  const pdfDoc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageHeight = pdfDoc.internal.pageSize.getHeight();
  const pageWidth = pdfDoc.internal.pageSize.getWidth();
  const margin = 10;

  const logoDataUrl: string | null = images.logo?.dataUrl ?? null;
  const logoFormat: string = images.logo?.format ?? 'PNG';

  const drawHeader = (pageNum: number) => drawDocHeader(pdfDoc, {
    pageWidth, pageHeight, margin, title: 'Workshop order slip',
    logoDataUrl, logoFormat, logoAspect: STORE_LOGO_ASPECT, pageNum,
  });
  drawHeader(1);

  let infoY = 28;
  pdfDoc.setFontSize(7).setTextColor(100).setFont('helvetica', 'bold');
  pdfDoc.text('ORDER DETAILS:', margin, infoY);
  pdfDoc.setLineWidth(0.2).line(margin, infoY + 1.5, pageWidth - margin, infoY + 1.5);
  infoY += 6;
  pdfDoc.setFont('helvetica', 'normal').setTextColor(0).setFontSize(8.5);
  // The money moved to a totals block under the table, the way the invoice
  // does it, so the whole width is the left column now. Still capped: jsPDF
  // will draw a long name straight off the page.
  const leftW = pageWidth - margin * 2;
  fitText(pdfDoc, `Order ID: ${order.id}`, margin, infoY, leftW);
  fitText(pdfDoc, `Date: ${day(order.createdAt)}`, margin, infoY + 5, leftW);
  fitText(pdfDoc, `Customer: ${order.customerName || 'Walk-in'}`, margin, infoY + 10, leftW);
  // What the customer was told, printed so the slip can be held to it.
  // The rule under this block follows whatever the last line turned out to
  // be. A silver order has no gold-rate line and most have no promised date
  // yet, and a fixed offset left a hand's width of blank above the table.
  let lastLine = infoY + 10;
  if (order.promisedDate) {
    lastLine += 5;
    fitText(pdfDoc, `Promised: ${day(order.promisedDate)}`, margin, lastLine, leftW);
  }

  // Staff's copy of an order has no rates (roles.ts), so a gold order's slip used to stop on
  // them; it prints without the line instead.
  const rates = (order.ratesApplied || {}) as Record<string, number>;
  const usedKarats = new Set(order.items.filter(i => i.metalType === 'gold').map(i => i.karat).filter(Boolean));
  const ratesApplied: string[] = [];
  // hideRates: the slip is priced at these rates and just does not say so.
  if (!order.hideRates) {
    if (usedKarats.has('24k') && rates.goldRatePerGram24k) ratesApplied.push(`24k: ${rates.goldRatePerGram24k.toLocaleString()}/g`);
    if (usedKarats.has('22k') && rates.goldRatePerGram22k) ratesApplied.push(`22k: ${rates.goldRatePerGram22k.toLocaleString()}/g`);
    if (usedKarats.has('21k') && rates.goldRatePerGram21k) ratesApplied.push(`21k: ${rates.goldRatePerGram21k.toLocaleString()}/g`);
    if (usedKarats.has('18k') && rates.goldRatePerGram18k) ratesApplied.push(`18k: ${rates.goldRatePerGram18k.toLocaleString()}/g`);
  }
  if (ratesApplied.length > 0) { pdfDoc.setFontSize(6.5).setTextColor(150); pdfDoc.text(`Gold Rates (PKR): ${ratesApplied.join(' | ')}`, margin, (lastLine += 5), { maxWidth: leftW }); }

  const infoBottom = lastLine + 5;
  pdfDoc.setLineWidth(0.3).line(margin, infoBottom, pageWidth - margin, infoBottom);

  // Items, drawn the way the invoice draws them: the piece leads, its specification sits
  // under it in grey, and what has to be set into it is darker because that is what the
  // karigar is actually reading.
  const itemBlocks = buildOrderItemBlocks(order);
  const tableRows: any[][] = order.items.map((item, i) => [i + 1, '', `PKR ${(item.totalEstimate || 0).toLocaleString()}`]);
  // Must match columnStyles below; see itemCellHeight on why this cannot be
  // read from the cell at parse time.
  const slipDescWidth = pageWidth - margin * 2 - 7 - 28;

  pdfDoc.autoTable({
    head: [['#', 'Piece & Instructions', 'Est. Price']],
    body: tableRows,
    startY: infoBottom + 7,
    ...tableStyles(margin),
    columnStyles: SLIP_COLUMNS,
    didParseCell: (data: any) => {
      alignHeadCell(data, SLIP_COLUMNS);
      if (data.section === 'body' && data.column.index === 1) {
        const block = itemBlocks[data.row.index];
        if (block) { data.cell.text = []; data.cell.styles.minCellHeight = itemCellHeight(pdfDoc, block, slipDescWidth); }
      }
    },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 1) {
        const block = itemBlocks[data.row.index];
        if (block) drawItemCell(pdfDoc, block, data.cell, slipDescWidth);
      }
      drawRowRule(pdfDoc, data, 2, { margin, pageWidth });
    },
    didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
      if (data.pageNumber > 1) { pdfDoc.setPage(data.pageNumber); data.settings.startY = 30; }
      drawHeader(data.pageNumber);
    },
  });

  // The money, laid out the way the invoice lays it out.
  drawOrderTotals(pdfDoc, order, {
    pageWidth, pageHeight, margin, onNewPage: drawHeader, startY: (pdfDoc.lastAutoTable.finalY || infoBottom) + 8,
    day: dates?.dayMonthYear,
  });

  drawFooter(pdfDoc, { pageWidth, pageHeight, margin }, images);
  return pdfDoc;
}

/** The browser's Print slip: the page's logo and codes, then the share sheet or a download. */
export async function generateOrderSlipPDF(order: Order, _settings?: Settings) {
  if (typeof window === 'undefined') return;
  // Opened before any await, or iOS treats the later open as a pop-up.
  const iOSWin = openPDFWindowForIOS();
  // The logo once per session, not once per print — see pdf-logo.ts.
  const images = await browserPdfImages();
  const pdfDoc = drawOrderSlipPdf(order, { images });
  await savePDF(pdfDoc, orderSlipFileName(order), iOSWin);
}
