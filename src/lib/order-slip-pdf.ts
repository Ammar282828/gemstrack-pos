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
import { drawDocHeader, tableStyles, drawRowRule, alignHeadCell, label } from '@/lib/pdf-chrome';
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

  // The block above the table is the estimate's own (lib/invoice-pdf.ts drawInvoice): BILL TO on the left, the
  // document's details on the right, same labels, sizes and spacing (owner, 2026-11-02: the estimate and the slip
  // "have discrepancies in format of the header and customer details"). The pieces below are unchanged.
  const shortDay = dates?.short ?? ((iso: string) => new Date(iso).toLocaleDateString());
  let infoY = 28;
  label(pdfDoc, 'Bill to', margin, infoY);
  label(pdfDoc, 'Order details', pageWidth / 2, infoY);
  infoY += 5;
  pdfDoc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0);
  const halfW = pageWidth / 2 - margin - 2;
  const customer = [order.customerName || 'Walk-in Customer', ...(order.customerContact ? [`Phone: ${order.customerContact}`] : [])]
    .map(line => pdfDoc.splitTextToSize(line, halfW)[0] as string);
  pdfDoc.text(customer.join('\n'), margin, infoY, { lineHeightFactor: 1.4 });
  const details = [
    `Order #: ${order.id}`,
    `Date: ${shortDay(order.createdAt)}`,
    // What the customer was told, printed so the slip can be held to it.
    ...(order.promisedDate ? [`Promised: ${shortDay(order.promisedDate)}`] : []),
  ];
  pdfDoc.text(details.join('\n'), pageWidth / 2, infoY, { lineHeightFactor: 1.4 });

  // Staff's copy of an order has no rates (roles.ts), so a gold order's slip prints without the line.
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
  // Under the details block, as the estimate places it (one line lower when a promised date is printed).
  const extra = details.length > 2 ? 4 : 0;
  if (ratesApplied.length > 0) {
    pdfDoc.setFontSize(6.5).setTextColor(150);
    pdfDoc.text(ratesApplied.join(' | '), pageWidth / 2 + 2, infoY + 10 + extra, { lineHeightFactor: 1.4 });
  }
  // The table starts where the estimate's does (its startY is infoBottom + 7).
  const infoBottom = infoY + (ratesApplied.length > 0 ? 18 : 13) + extra - 7;

  // Items, drawn the way the invoice draws them: the piece leads, its specification sits
  // under it in grey, and what has to be set into it is darker because that is what the
  // karigar is actually reading.
  const itemBlocks = buildOrderItemBlocks(order);
  const tableRows: any[][] = order.items.map((item, i) => [i + 1, '', `PKR ${(item.totalEstimate || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`]);
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
