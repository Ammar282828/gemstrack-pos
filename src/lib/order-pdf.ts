/**
 * The customer's copy of an order: what they asked for, what it is estimated at, what they have
 * paid and what is left, and the day it was promised. Sent to them on WhatsApp from the shop's line
 * (lib/customer-doc-server.ts; owner, 2026-11-02: "send the pdf (order or invoice) directly to the
 * customer on whatsapp") and shared from the order page.
 *
 * Not the workshop slip (lib/order-slip-pdf.ts): the slip is the bench's and carries the shop's own
 * notes (`adminNote`, the bench's `notes`), the karigar and the sample. None of those is drawn here —
 * `orderCustomerBlocks` is the one place that decides what of a piece the customer reads, and its tests
 * hold it to that. The money is the slip's block (drawOrderTotals), which was already written for the
 * customer's eyes: price, discount, each advance, exchange, balance.
 *
 * One drawer for the browser and the server: pictures and days are handed in (pdf-inputs.ts).
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import type { Order, OrderItem } from '@/lib/store';
import { staticCategories, categorySingular } from '@/lib/categories';
import { describeMetal, describeSettings } from '@/lib/materials';
import { drawItemCell, itemCellHeight, wastageGrams, type ItemBlock } from '@/lib/invoice-item-cell';
import { drawDocHeader, tableStyles, drawRowRule, alignHeadCell, label, FOOTER_HEIGHT } from '@/lib/pdf-chrome';
import { browserPdfImages, drawFooter, type PdfDates, type PdfImages } from '@/lib/pdf-inputs';
import { drawOrderTotals } from '@/lib/order-slip';
import { orderFileName } from '@/lib/invoice-share';
import { openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { STORE_INVOICE_BY_CUSTOMER, STORE_LOGO_ASPECT } from '@/lib/store-config';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: { finalY?: number };
  }
}

const COLUMNS = { 0: { cellWidth: 7, halign: 'center' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 28, halign: 'right' } } as const;

const pkr = (n: number) => `PKR ${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

/** A piece's price as the order holds it: its fixed price, else its estimate at the order's rates. */
export const orderPiecePrice = (item: Pick<OrderItem, 'isManualPrice' | 'manualPrice' | 'totalEstimate'>) =>
  Number(item.isManualPrice ? item.manualPrice ?? item.totalEstimate : item.totalEstimate) || 0;

/**
 * Each piece as the customer reads it: the piece, its description, metal, estimated weight, wastage in
 * grams (as the bill writes it), size, and what is set in it. Never the shop's notes, the karigar or
 * the sample.
 */
export function orderCustomerBlocks(order: Pick<Order, 'items'>): ItemBlock[] {
  return (order.items || []).map((item) => {
    const catName = categorySingular(item.itemCategory) || staticCategories.find(c => c.id === item.itemCategory)?.title || '';
    const metalName = describeMetal(item.metalType, item.karat);
    const wastage = item.metalType !== 'silver' && !item.isManualPrice
      ? wastageGrams({ metalWeightG: item.estimatedWeightG, stoneWeightG: item.stoneWeightG, wastagePercentage: item.wastagePercentage, wastageCost: item.wastageCost, metalCost: item.metalCost })
      : 0;
    const metalPart = `${metalName}${item.estimatedWeightG ? ` · Est. ${item.estimatedWeightG}g` : ''}${wastage > 0 ? ` · Wastage ${wastage.toFixed(2)}g` : ''}`;
    return {
      name: catName || item.description || 'Piece',
      spec: [
        item.description && item.description.trim().toLowerCase() !== catName.toLowerCase() ? item.description.trim() : '',
        metalPart,
        item.size ? `Size ${item.size}` : '',
      ].filter(Boolean).join('  ·  '),
      settings: describeSettings(item),
      breakdown: [],
    };
  });
}

/** Taheri: "Order - <customer>.pdf"; a house that names by number (STORE_INVOICE_BY_CUSTOMER off): "Order-<id>.pdf". */
export const orderPdfFileName = (order: Pick<Order, 'id' | 'customerName' | 'createdAt'>) =>
  STORE_INVOICE_BY_CUSTOMER ? orderFileName(order) : `Order-${order.id}.pdf`;

export interface OrderPdfOptions {
  images: PdfImages;
  /** How days are written; the device's way when left out (the server passes Karachi's). */
  dates?: PdfDates;
}

/** The customer's order, drawn from the order and the pictures handed in; touches no page. */
export function drawOrderPdf(order: Order, { images, dates }: OrderPdfOptions): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const drawHeader = (pageNum: number) => drawDocHeader(doc, {
    pageWidth, pageHeight, margin, title: 'Order',
    logoDataUrl: images.logo?.dataUrl ?? null, logoFormat: images.logo?.format ?? 'PNG', logoAspect: STORE_LOGO_ASPECT, pageNum,
  });
  drawHeader(1);

  // The block above the table is the estimate's and the workshop slip's own (lib/order-slip-pdf.ts, owner
  // 2026-11-02): BILL TO on the left, ORDER DETAILS on the right, same labels, sizes, spacing and day format.
  const shortDay = dates?.short ?? ((iso: string) => new Date(iso).toLocaleDateString());
  let infoY = 28;
  label(doc, 'Bill to', margin, infoY);
  label(doc, 'Order details', pageWidth / 2, infoY);
  infoY += 5;
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0);
  const halfW = pageWidth / 2 - margin - 2;
  const customer = [order.customerName || 'Walk-in Customer', ...(order.customerContact ? [`Phone: ${order.customerContact}`] : [])]
    .map(line => doc.splitTextToSize(line, halfW)[0] as string);
  doc.text(customer.join('\n'), margin, infoY, { lineHeightFactor: 1.4 });
  const details = [
    `Order #: ${order.id}`,
    `Date: ${shortDay(order.createdAt)}`,
    ...(order.promisedDate ? [`Promised: ${shortDay(order.promisedDate)}`] : []),
  ];
  doc.text(details.join('\n'), pageWidth / 2, infoY, { lineHeightFactor: 1.4 });

  // The rates the estimate was worked at, as the slip prints them (unless hidden).
  const rates = (order.ratesApplied || {}) as Record<string, number>;
  const usedKarats = new Set(order.items.filter(i => i.metalType === 'gold').map(i => i.karat).filter(Boolean));
  const ratesApplied: string[] = [];
  if (!order.hideRates) {
    for (const k of ['24k', '22k', '21k', '18k'] as const) {
      const r = rates[`goldRatePerGram${k}`];
      if (usedKarats.has(k) && r) ratesApplied.push(`${k}: ${r.toLocaleString()}/g`);
    }
  }
  const extra = details.length > 2 ? 4 : 0;
  if (ratesApplied.length > 0) {
    doc.setFontSize(6.5).setTextColor(150);
    doc.text(ratesApplied.join(' | '), pageWidth / 2 + 2, infoY + 10 + extra, { lineHeightFactor: 1.4 });
  }
  // The table starts where the estimate's and the slip's do (startY infoBottom + 7).
  const infoBottom = infoY + (ratesApplied.length > 0 ? 18 : 13) + extra - 7;

  const blocks = orderCustomerBlocks(order);
  const descWidth = pageWidth - margin * 2 - 7 - 28;
  doc.autoTable({
    ...tableStyles(margin),
    head: [['#', 'Piece', 'Est. price']],
    body: order.items.map((item, i) => [i + 1, '', pkr(orderPiecePrice(item))]),
    startY: infoBottom + 7,
    columnStyles: COLUMNS,
    didParseCell: (data: any) => {
      alignHeadCell(data, COLUMNS);
      if (data.section === 'body' && data.column.index === 1) {
        const block = blocks[data.row.index];
        if (block) { data.cell.text = []; data.cell.styles.minCellHeight = itemCellHeight(doc, block, descWidth); }
      }
    },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 1) {
        const block = blocks[data.row.index];
        if (block) drawItemCell(doc, block, data.cell, descWidth);
      }
      drawRowRule(doc, data, 2, { margin, pageWidth });
    },
    didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
      if (data.pageNumber > 1) { doc.setPage(data.pageNumber); data.settings.startY = 30; }
      drawHeader(data.pageNumber);
    },
  });

  const after = drawOrderTotals(doc, order, {
    pageWidth, pageHeight, margin, onNewPage: drawHeader, startY: (doc.lastAutoTable.finalY || infoBottom) + 8,
    day: dates?.dayMonthYear,
  });

  // What an estimate is, once, above the footer when there is room.
  const noteY = Math.min(after + 6, pageHeight - FOOTER_HEIGHT - 4);
  if (noteY > after) {
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(110);
    doc.text('Weights and prices are estimates; the invoice is made from the finished piece.', margin, noteY, { maxWidth: pageWidth - margin * 2 });
  }

  drawFooter(doc, { pageWidth, pageHeight, margin }, images);
  return doc;
}

/** The browser's: the page's logo and codes, then the share sheet or a download. */
export async function saveOrderPdf(order: Order): Promise<void> {
  if (typeof window === 'undefined') return;
  const iOSWin = openPDFWindowForIOS();
  try {
    await savePDF(drawOrderPdf(order, { images: await browserPdfImages() }), orderPdfFileName(order), iOSWin);
  } catch (e) {
    iOSWin?.close();
    throw e;
  }
}
