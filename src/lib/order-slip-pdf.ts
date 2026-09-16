"use client";

/**
 * The workshop order slip as a PDF, from anywhere that has an order.
 *
 * Lifted out of the invoices page so the orders list can print one per row without
 * opening the order first. Everything about it is unchanged: it pre-opens the iOS
 * window in the tap, draws the slip, and hands it to savePDF, which shares or
 * downloads as the device allows.
 *
 * The footer's QR codes (WhatsApp, Instagram) are read off hidden <QRCode> canvases
 * that the calling page renders; a page that has not rendered them gets a slip with
 * no codes rather than an error -- see drawDocFooter.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import type { Order, Settings } from '@/lib/store';
import { openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { loadPdfLogo } from '@/lib/pdf-logo';
import { fitText } from '@/lib/pdf-text';
import { drawDocHeader, drawDocFooter, tableStyles, drawRowRule, alignHeadCell } from '@/lib/pdf-chrome';
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

export async function generateOrderSlipPDF(order: Order, settings: Settings) {
  if (typeof window === 'undefined') return;
  const iOSWin = openPDFWindowForIOS();
  const pdfDoc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageHeight = pdfDoc.internal.pageSize.getHeight();
  const pageWidth = pdfDoc.internal.pageSize.getWidth();
  const margin = 10;

  // Once per session, not once per print — see pdf-logo.ts.
  const pdfLogo = await loadPdfLogo();
  const logoDataUrl: string | null = pdfLogo?.dataUrl ?? null;
  const logoFormat: string = pdfLogo?.format ?? 'PNG';

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
  fitText(pdfDoc, `Date: ${format(parseISO(order.createdAt), 'PP')}`, margin, infoY + 5, leftW);
  fitText(pdfDoc, `Customer: ${order.customerName || 'Walk-in'}`, margin, infoY + 10, leftW);
  // What the customer was told, printed so the slip can be held to it.
  // The rule under this block follows whatever the last line turned out to
  // be. A silver order has no gold-rate line and most have no promised date
  // yet, and a fixed offset left a hand's width of blank above the table.
  let lastLine = infoY + 10;
  if (order.promisedDate) {
    lastLine += 5;
    fitText(pdfDoc, `Promised: ${format(parseISO(order.promisedDate), 'PP')}`, margin, lastLine, leftW);
  }

  const rates = order.ratesApplied as Record<string, number>;
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
  drawOrderTotals(pdfDoc, order, { pageWidth, pageHeight, margin, onNewPage: drawHeader, startY: (pdfDoc.lastAutoTable.finalY || infoBottom) + 8 });

  drawDocFooter(pdfDoc, {
    pageWidth, pageHeight, margin,
    whatsappQr: document.getElementById('wa-qr-code') as HTMLCanvasElement | null,
    instagramQr: document.getElementById('insta-qr-code') as HTMLCanvasElement | null,
  });

  await savePDF(pdfDoc, `OrderSlip-${order.id}.pdf`, iOSWin);
}
