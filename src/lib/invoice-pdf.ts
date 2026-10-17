/**
 * The customer's invoice, on paper.
 *
 * One builder for the three places that print one — the invoices list, the
 * post-sale screen in the cart, and the customer's own link — where there
 * used to be three near-identical copies drifting apart by a line each. The
 * server draws with it too (lib/app-pdf.ts: the iPhone app's PDF and the shop
 * line's WhatsApp send), so the drawing takes its pictures and its way of
 * writing a day as inputs (pdf-inputs.ts) and touches no page: drawInvoicePdf.
 * buildInvoicePdf and saveInvoicePdf are the browser's, with the page's own.
 *
 * `perPiece` prints a multi-item invoice as one invoice per piece, each on
 * its own page: the same number, "Piece 2 of 3" beside the date, and only
 * that piece's figures. The invoice-level amounts (discount, exchange,
 * adjustments, what has been paid) are shared out in proportion to each
 * piece's price, the last piece taking any rounding, so the pages add back
 * up to the bill. A customer buying three pieces for three people can hand
 * each one its own paper.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { metalLabel, describeSettings, describeDelivery } from '@/lib/materials';
import { categorySingular } from '@/lib/categories';
import { STORE_INVOICE_BY_CUSTOMER, STORE_LOGO_ASPECT } from '@/lib/store-config';
// The categories from their own module, not the store's re-export: the store is the browser's
// (Firebase, zustand) and the server builds from here too.
import { staticCategories } from '@/lib/categories';
import type { Invoice, InvoiceItem, Customer } from '@/lib/store';
import { openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { browserPdfImages, drawFooter, type PdfDates, type PdfImages } from '@/lib/pdf-inputs';
import { stockSku } from '@/lib/sku';
import { format } from 'date-fns';
import { getInvoiceAdjustmentsAmount } from '@/lib/financials';
import { drawItemCell, itemCellHeight, type ItemBlock, wastageLine } from '@/lib/invoice-item-cell';
import { drawDocHeader, tableStyles, drawRowRule, alignHeadCell, label, drawTotals, totalsHeight, totalsLeftEdge, type TotalRow } from '@/lib/pdf-chrome';
import { describeExchangeEntry } from '@/lib/exchange';
import { invoiceFileName, invoiceTitle } from '@/lib/invoice-share';
import { balanceLine } from '@/lib/invoice-credit';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: { finalY?: number };
  }
}

/** Shared by the table and by alignHeadCell, which needs the same object. */
const INVOICE_COLUMNS = {
  0: { cellWidth: 7, halign: 'center' },
  1: { cellWidth: 'auto' },
  2: { cellWidth: 9, halign: 'right' },
  3: { cellWidth: 22, halign: 'right' },
  4: { cellWidth: 22, halign: 'right' },
} as const;

export interface InvoicePdfOptions {
  /** The customer on file, for address and email; the invoice's own name and number otherwise. */
  customer?: Customer | null;
  /** One invoice per piece, each on its own page. */
  perPiece?: boolean;
  /** The wordmark and the footer's codes. buildInvoicePdf reads the page's own when none are given. */
  images?: PdfImages;
  /** How days are written; the device's way when left out (the server passes Karachi's). */
  dates?: PdfDates;
}

const itemsOf = (inv: Invoice): InvoiceItem[] =>
  Array.isArray(inv.items) ? inv.items : Object.values(inv.items as unknown as Record<string, InvoiceItem>);

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Share `total` across `weights`, to the paisa, so the shares add back up to
 * `total` exactly: the last share absorbs whatever rounding left over.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const t = Number(total) || 0;
  if (!t) return weights.map(() => 0);
  const sum = weights.reduce((a, b) => a + b, 0);
  const out = weights.map(w => round2(sum > 0 ? t * w / sum : t / weights.length));
  const drift = round2(t - out.reduce((a, b) => a + b, 0));
  out[out.length - 1] = round2(out[out.length - 1] + drift);
  return out;
}

/** An invoice for one piece of a larger bill, and where it sits in the set. */
export type PieceInvoice = Invoice & { piece?: { index: number; count: number } };

/**
 * One invoice per piece. A one-piece invoice comes back as itself.
 *
 * Payment history is left off the pieces: a payment was made against the
 * bill, not against a piece, and a table of it repeated on every page would
 * read as three payments.
 */
export function splitInvoicePerPiece(inv: Invoice): PieceInvoice[] {
  const items = itemsOf(inv);
  if (items.length <= 1) return [inv];
  const weights = items.map(i => Math.max(0, Number(i.itemTotal) || 0));
  const discount = allocate(inv.discountAmount || 0, weights);
  const exchange1 = allocate(inv.exchangeAmount1 || 0, weights);
  const exchange2 = allocate(inv.exchangeAmount2 || 0, weights);
  const adjustments = allocate(getInvoiceAdjustmentsAmount(inv), weights);
  const paid = allocate(inv.amountPaid || 0, weights);
  return items.map((item, i) => {
    const subtotal = round2(Number(item.itemTotal) || 0);
    const grandTotal = round2(subtotal - discount[i] - exchange1[i] - exchange2[i] + adjustments[i]);
    return {
      ...inv,
      items: [item],
      subtotal,
      discountAmount: discount[i],
      exchangeAmount1: exchange1[i] || undefined,
      exchangeAmount2: exchange2[i] || undefined,
      // The rows carry the whole bill's values; a piece shows its share of the total
      // under the rows' description instead (exchangeDescription).
      exchanges: undefined,
      adjustmentsAmount: adjustments[i] || undefined,
      grandTotal,
      amountPaid: paid[i],
      balanceDue: round2(grandTotal - paid[i]),
      paymentHistory: [],
      piece: { index: i + 1, count: items.length },
    };
  });
}

interface Chrome {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  logoDataUrl: string | null;
  logoFormat: string;
  images: PdfImages;
  /** The invoice's "Date:", and a payment's. */
  day: (iso: string) => string;
  paidDay: (iso: string) => string;
}

/** The customer block: name, address, phone, email — whatever is on file. */
function customerLines(inv: Invoice, customer: Customer | null | undefined): string {
  const lines: string[] = [];
  const name = customer?.name || inv.customerName;
  lines.push(name || 'Walk-in Customer');
  if (customer?.address) lines.push(customer.address);
  const phone = customer?.phone || inv.customerContact || '';
  const email = customer?.email || '';
  if (phone) lines.push(`Phone: ${phone}`);
  if (email) lines.push(`Email: ${email}`);
  return lines.join('\n');
}

/**
 * Draw one invoice, starting on the document's current (blank) page. Returns
 * nothing; the caller adds a page before the next one.
 */
function drawInvoice(doc: jsPDF, inv: PieceInvoice, customer: Customer | null | undefined, chrome: Chrome): void {
  const { pageWidth, pageHeight, margin, logoDataUrl, logoFormat } = chrome;
  // Page numbers restart for every invoice in the document — "Page 2" on a
  // piece's second sheet, not the document's fifth.
  const firstPage = doc.getNumberOfPages();
  const drawHeader = (absolutePage: number) => drawDocHeader(doc, {
    pageWidth, pageHeight, margin, title: 'Estimate',
    logoDataUrl, logoFormat, logoAspect: STORE_LOGO_ASPECT,
    pageNum: absolutePage - firstPage + 1,
  });
  drawHeader(firstPage);

  let infoY = 28;
  label(doc, 'Bill to', margin, infoY);
  label(doc, 'Estimate details', pageWidth / 2, infoY);
  infoY += 5;
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(0);

  const customerInfo = customerLines(inv, customer);
  doc.text(customerInfo, margin, infoY, { lineHeightFactor: 1.4 });

  // Where it is going, when it is being delivered. The address the customer
  // gave was never printed, so whoever packed the piece had to go and find
  // it in the order.
  const deliveryLines: string[] = describeDelivery(inv.delivery);
  if (deliveryLines.length) {
    const dy = infoY + (customerInfo.split('\n').length * 4) + 2;
    label(doc, 'Deliver to', margin, dy);
    doc.setFont('helvetica', 'normal').setFontSize(8);
    doc.text(deliveryLines.join('\n'), margin, dy + 4, { lineHeightFactor: 1.4 });
  }

  const details = [
    `Estimate #: ${inv.id}`,
    `Date: ${chrome.day(inv.createdAt)}`,
    ...(inv.piece ? [`Piece ${inv.piece.index} of ${inv.piece.count}`] : []),
  ];
  doc.text(details.join('\n'), pageWidth / 2, infoY, { lineHeightFactor: 1.4 });

  const rates = (inv.ratesApplied || {}) as Record<string, number>;
  const items = itemsOf(inv);
  const usedKarats = new Set(items.filter(i => i.metalType === 'gold').map(i => i.karat).filter(Boolean));
  const ratesApplied: string[] = [];
  // hideRates: the bill is priced at these rates and just does not say so.
  if (!inv.hideRates) {
    if (usedKarats.has('24k') && rates.goldRatePerGram24k) ratesApplied.push(`24k: ${rates.goldRatePerGram24k.toLocaleString()}/g`);
    if (usedKarats.has('22k') && rates.goldRatePerGram22k) ratesApplied.push(`22k: ${rates.goldRatePerGram22k.toLocaleString()}/g`);
    if (usedKarats.has('21k') && rates.goldRatePerGram21k) ratesApplied.push(`21k: ${rates.goldRatePerGram21k.toLocaleString()}/g`);
    if (usedKarats.has('18k') && rates.goldRatePerGram18k) ratesApplied.push(`18k: ${rates.goldRatePerGram18k.toLocaleString()}/g`);
  }
  // Under the details block, which is one line taller on a piece page.
  const ratesY = infoY + 10 + (inv.piece ? 4 : 0);
  if (ratesApplied.length > 0) {
    doc.setFontSize(6.5).setTextColor(150);
    doc.text(ratesApplied.join(' | '), pageWidth / 2 + 2, ratesY, { lineHeightFactor: 1.4 });
  }

  // The delivery block sits under BILL TO and grows with the address, so
  // the table has to start below whatever it actually took.
  const deliveryBlockHeight = deliveryLines.length ? 6 + deliveryLines.length * 4 : 0;
  const tableStartY = infoY + (ratesApplied.length > 0 ? 18 : 13) + (inv.piece ? 4 : 0) + deliveryBlockHeight;

  const tableRows: (string | number)[][] = [];
  const itemBlocks: ItemBlock[] = [];
  // The description column is 'auto', so its width is whatever the fixed
  // columns leave, at the margin autoTable is given. Computed here so the
  // height and the drawing wrap at the same measure.
  const descColWidth = (pageWidth - margin * 2) - (7 + 9 + 22 + 22);
  const pkr = (n: number) => `PKR ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  items.forEach((item, index) => {
    const breakdownLines: string[] = [];
    if (item.metalCost > 0) breakdownLines.push(`Metal: ${pkr(item.metalCost)}`);
    // Grams only — no rupee value, no percentage — on the customer's copy.
    { const w = item.wastageCost > 0 ? wastageLine(item) : null; if (w) breakdownLines.push(w); }
    if (item.makingCharges > 0) breakdownLines.push(`+ Making: ${pkr(item.makingCharges)}`);
    if (item.diamondChargesIfAny > 0) breakdownLines.push(`+ Diamonds: ${pkr(item.diamondChargesIfAny)}`);
    if (item.stoneChargesIfAny > 0) breakdownLines.push(`+ Stones: ${pkr(item.stoneChargesIfAny)}`);
    if (item.miscChargesIfAny > 0) breakdownLines.push(`+ Misc: ${pkr(item.miscChargesIfAny)}`);

    const metalTypeName = metalLabel(item.metalType);
    const karat = item.metalType === 'gold' && item.karat ? ` (${item.karat.toUpperCase()})` : '';
    const weightPart = item.metalWeightG > 0 ? `, Wt: ${(item.metalWeightG || 0).toFixed(2)}g` : '';
    // Category first, singular — "Ring", one of them, not the department — and
    // the piece's own name under it. An InvoiceItem carries categoryId; older
    // rows may carry itemCategory instead.
    const catId = item.categoryId || item.itemCategory;
    const catName = categorySingular(catId) || staticCategories.find(c => c.id === catId)?.title || '';
    itemBlocks.push({
      name: catName || item.name || '',
      spec: [
        // Dropped when it merely repeats the category, so "Ring" is not followed by "Ring".
        item.name && item.name.trim().toLowerCase() !== catName.toLowerCase() ? item.name : '',
        `${metalTypeName}${karat}${weightPart}`,
        item.size ? `Size ${item.size}` : '',
        stockSku(item.sku) ? `SKU ${item.sku}` : '',
      ].filter(Boolean).join('  ·  '),
      settings: describeSettings(item),
      breakdown: breakdownLines.map(l => l.trim().replace(/^\+\s*/, '')),
    });
    tableRows.push([
      index + 1, '', item.quantity,
      item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 }),
      item.itemTotal.toLocaleString(undefined, { minimumFractionDigits: 2 }),
    ]);
  });

  // The totals rows are built first: the items table needs the block's height to know whether
  // the last row has to travel with it.
  const adjustmentsAmount = getInvoiceAdjustmentsAmount(inv);
  const totalRows: TotalRow[] = [{ label: 'Subtotal', value: pkr(inv.subtotal) }];
  if (inv.discountAmount > 0) totalRows.push({ label: 'Discount', value: `- ${pkr(inv.discountAmount)}`, tone: 'ink' });
  if (adjustmentsAmount !== 0) totalRows.push({ label: 'Adjustments', value: pkr(adjustmentsAmount) });
  // One line per thing taken in exchange (lib/exchange.ts); an older invoice, or one piece
  // of a split, has a description and its amounts.
  const exchangeRows = (inv.exchanges || []).filter(e => e.value > 0);
  if (exchangeRows.length === 1) {
    const what = describeExchangeEntry(exchangeRows[0]);
    totalRows.push({ label: what === 'Exchange' ? 'Exchange' : `Exchange (${what})`, value: `- ${pkr(exchangeRows[0].value)}` });
  } else if (exchangeRows.length > 1) {
    totalRows.push({ label: 'Exchange', value: '', tone: 'ink' });
    for (const e of exchangeRows) totalRows.push({ label: describeExchangeEntry(e), value: `- ${pkr(e.value)}` });
  } else if (inv.exchangeAmount1 || inv.exchangeAmount2) {
    totalRows.push({ label: inv.exchangeDescription ? `Exchange (${inv.exchangeDescription})` : 'Exchange', value: '', tone: 'ink' });
    if (inv.exchangeAmount1) totalRows.push({ label: '', value: `- ${pkr(inv.exchangeAmount1)}` });
    if (inv.exchangeAmount2) totalRows.push({ label: '', value: `- ${pkr(inv.exchangeAmount2)}` });
  }
  const history = inv.paymentHistory || [];
  const totalsOpts = {
    pageWidth, pageHeight, margin, onNewPage: drawHeader,
    rows: totalRows,
    total: { label: 'Grand Total', value: pkr(inv.grandTotal) },
    after: inv.amountPaid > 0 ? [{ label: 'Amount Paid', value: `- ${pkr(inv.amountPaid)}` }] : [],
    closing: inv.amountPaid > 0 ? { label: balanceLine(inv.balanceDue).state === 'credit' ? 'Credit to Customer' : 'Balance Due', value: pkr(Math.abs(inv.balanceDue)) } : undefined,
    // Nothing here reserves the footer: it is drawn once, after the last block, shrinking into
    // whatever room the last page has left (it never adds a page).
    bottomReserve: margin,
  };
  const totalsH = totalsHeight(doc, { ...totalsOpts, startY: 0 });
  const TOTALS_GAP = 10;

  const rowPage: number[] = [];
  const drawItems = (target: jsPDF, from: number, to: number, startY: number, real: boolean) => {
    const basePage = target.getNumberOfPages();
    target.autoTable({
      ...tableStyles(margin),
      // A continuation page starts under the header (the head row once drew over it).
      margin: { left: margin, right: margin, top: 28 },
      head: [['#', 'Product & Breakdown', 'Qty', 'Unit', 'Total']],
      body: tableRows.slice(from, to),
      startY,
      columnStyles: INVOICE_COLUMNS,
      didParseCell: (data: any) => {
        alignHeadCell(data, INVOICE_COLUMNS);
        // Tell autoTable how tall the hand-drawn cell will be, and stop it
        // laying out text of its own there.
        if (data.section === 'body' && data.column.index === 1) {
          const block = itemBlocks[from + data.row.index];
          if (block) {
            data.cell.text = [];
            data.cell.styles.minCellHeight = itemCellHeight(target, block, descColWidth);
          }
        }
      },
      didDrawCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 1) {
          const block = itemBlocks[from + data.row.index];
          if (block) drawItemCell(target, block, data.cell, descColWidth);
        }
        if (!real && data.section === 'body' && data.column.index === 0) rowPage[from + data.row.index] = target.getCurrentPageInfo().pageNumber;
        drawRowRule(target, data, 4, { margin, pageWidth });
      },
      didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
        if (data.pageNumber > basePage) target.setPage(data.pageNumber);
        if (real) drawHeader(data.pageNumber);
      },
    });
  };

  // A dry run on a scratch sheet finds where the items end. If the totals would not fit under
  // them, the last item row goes to the next page with the block (never the block alone),
  // unless that row already stands first on its page.
  let splitLast = false;
  const n = tableRows.length;
  if (n > 1) {
    const scratch = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
    drawItems(scratch, 0, n, tableStartY, false);
    const endY = scratch.lastAutoTable.finalY || 0;
    const limit = pageHeight - margin;
    splitLast = endY + TOTALS_GAP + totalsH > limit && rowPage[n - 1] === scratch.getNumberOfPages() && rowPage[n - 2] === rowPage[n - 1];
  }

  if (splitLast) {
    drawItems(doc, 0, n - 1, tableStartY, true);
    doc.addPage();
    drawItems(doc, n - 1, n, 28, true);
  } else {
    drawItems(doc, 0, n, tableStartY, true);
  }

  // Totals straight after the items: kept whole, on the page where the items end unless they
  // truly do not fit there. No blind reserve (owner, 2026-10-17: "a lot of space ... still uses
  // the second page"); drawTotals measures what it will draw.
  const limit = pageHeight - margin;
  let y = (doc.lastAutoTable.finalY || 0) + TOTALS_GAP;
  let contentEnd = y;

  // Payment History: beside the totals when it fits (the left of the page stands empty next to
  // them, and a bill of a few advances was spilling a second page for it). The two columns are
  // one block, kept whole, as tall as the taller. Too many payments, or no room left of the
  // labels, and it goes full width below the totals as before.
  const BESIDE_MAX_ROWS = 8, BESIDE_GAP = 5, BESIDE_MIN_W = 46, BESIDE_MIN_NOTES = 16, BESIDE_TITLE = 2.5;
  const edge = totalsLeftEdge(doc, { ...totalsOpts, startY: 0 });
  const besideW = edge - BESIDE_GAP - margin;
  const besideBody = history.map(p => [
    chrome.paidDay(p.date),
    // How and what in one cell, cut with an ellipsis rather than wrapped: the column is narrow.
    [[p.method, p.reference].filter(Boolean).join(' · '), p.notes || (p.method ? '' : 'Payment received')].filter(Boolean).join(' · ') || '—',
    pkr(p.amount).replace(/^PKR\s*/, ''),
  ]);
  // Date and Amount are as wide as their widest entry (measured), Notes takes the rest.
  doc.setFont('helvetica', 'normal').setFontSize(6.5);
  const fitCol = (i: number, head: string) => Math.ceil((Math.max(...besideBody.map(r => doc.getTextWidth(String(r[i]))), doc.getTextWidth(head) + 0.8) + 2.4 + 0.6) * 2) / 2;
  const dateW = fitCol(0, 'Date'), amountW = fitCol(2, 'Amount');
  const notesW = besideW - dateW - amountW;
  const besideTable = (target: jsPDF, startY: number) => target.autoTable({
    head: [['Date', 'Notes', 'Amount']],
    body: besideBody,
    startY, theme: 'striped',
    tableWidth: besideW,
    margin: { left: margin, right: pageWidth - margin - besideW, top: 28, bottom: margin },
    headStyles: { fillColor: [240, 240, 240], textColor: 50, fontSize: 7 },
    styles: { fontSize: 6.5, overflow: 'ellipsize', valign: 'top', cellPadding: 1.2 },
    columnStyles: { 0: { cellWidth: dateW }, 1: { cellWidth: notesW }, 2: { cellWidth: amountW, halign: 'right' } },
  });
  let beside = false, besideH = 0;
  if (history.length > 0 && history.length <= BESIDE_MAX_ROWS && besideW >= BESIDE_MIN_W && notesW >= BESIDE_MIN_NOTES) {
    const scratch = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pageWidth, pageHeight] });
    besideTable(scratch, 0);
    besideH = BESIDE_TITLE + 2 + (scratch.lastAutoTable.finalY || 0);
    beside = scratch.getNumberOfPages() === 1;
  }

  if (beside) {
    const blockH = Math.max(totalsH, besideH);
    if (y + blockH > limit) {
      doc.addPage();
      drawHeader(doc.getNumberOfPages());
      y = 30;
    }
    const top = y;
    const totalsEnd = drawTotals(doc, { ...totalsOpts, startY: top });
    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0);
    doc.text('Payment History', margin, top + 0.5);
    besideTable(doc, top + BESIDE_TITLE);
    contentEnd = Math.max(totalsEnd, doc.lastAutoTable.finalY || 0);
  } else {
    y = drawTotals(doc, { ...totalsOpts, startY: y });
    contentEnd = y;
    if (history.length > 0) {
      // Title, head and the first row travel together.
      if (y + 6 + 4 + 18 > limit) {
        doc.addPage();
        drawHeader(doc.getNumberOfPages());
        y = 24;
      }
      y += 6;
      doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0);
      doc.text('Payment History', margin, y);
      y += 4;
      const histPage = doc.getNumberOfPages();
      // How each was paid — an order's advances arrive here one by one, each with its method —
      // and notes that wrap rather than run off the page.
      doc.autoTable({
        head: [['Date', 'How', 'Notes', 'Amount']],
        body: history.map(p => [
          chrome.paidDay(p.date),
          [p.method, p.reference].filter(Boolean).join(' · ') || '—',
          p.notes || 'Payment received',
          pkr(p.amount),
        ]),
        startY: y, theme: 'striped',
        margin: { left: margin, right: margin, top: 28, bottom: margin },
        headStyles: { fillColor: [240, 240, 240], textColor: 50, fontSize: 8 },
        styles: { fontSize: 7, overflow: 'linebreak', valign: 'top' },
        columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 30 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 26, halign: 'right' } },
        didDrawPage: (data: { pageNumber: number }) => {
          if (data.pageNumber > histPage) { doc.setPage(data.pageNumber); drawHeader(data.pageNumber); }
        },
      });
      contentEnd = doc.lastAutoTable.finalY || y;
    }
  }

  // The footer once, on the last page, below everything, and never on a page of its own: when the
  // content stands lower than the full footer's rule, a compact one goes in the room left (one
  // row, then one line, then none; pdf-chrome.ts). The codes are the caller's (pdf-inputs.ts):
  // in the browser, canvases the printing page renders off-screen.
  doc.setPage(doc.getNumberOfPages());
  drawFooter(doc, { pageWidth, pageHeight, margin }, chrome.images, contentEnd);
}

/**
 * The finished document, not yet saved, from what it is given: no page, no fetch, so the server
 * draws the same paper (lib/app-pdf.ts).
 */
export function drawInvoicePdf(invoice: Invoice, opts: InvoicePdfOptions & { images: PdfImages }): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  const { images, dates } = opts;
  const chrome: Chrome = {
    pageWidth: doc.internal.pageSize.getWidth(),
    pageHeight: doc.internal.pageSize.getHeight(),
    margin: 10,
    logoDataUrl: images.logo?.dataUrl ?? null,
    logoFormat: images.logo?.format ?? 'PNG',
    images,
    day: dates?.short ?? (iso => new Date(iso).toLocaleDateString()),
    paidDay: dates?.medium ?? (iso => format(new Date(iso), 'PP')),
  };
  // What a PDF viewer, and WhatsApp's preview of the file, shows as its name.
  if (STORE_INVOICE_BY_CUSTOMER) doc.setProperties({ title: invoiceTitle(invoice) });
  const invoices = opts.perPiece ? splitInvoicePerPiece(invoice) : [invoice];
  invoices.forEach((inv, i) => {
    if (i > 0) doc.addPage();
    drawInvoice(doc, inv, opts.customer, chrome);
  });
  return doc;
}

/** The finished document, not yet saved: in the browser, with the page's logo and codes unless given. */
export async function buildInvoicePdf(invoice: Invoice, opts: InvoicePdfOptions = {}): Promise<jsPDF> {
  // The logo once per session, not once per print — see pdf-logo.ts.
  const images = opts.images ?? await browserPdfImages();
  return drawInvoicePdf(invoice, { ...opts, images });
}

/**
 * The file's name. Taheri: "Invoice - <customer>", never the number (lib/invoice-share.ts);
 * House of Mina: the number. `perPiece` only counts on an invoice of more than one piece.
 */
export function invoicePdfFileName(invoice: Invoice, opts: { perPiece?: boolean } = {}): string {
  const perPiece = !!opts.perPiece && itemsOf(invoice).length > 1;
  return STORE_INVOICE_BY_CUSTOMER
    ? invoiceFileName(invoice, { perPiece })
    : perPiece ? `Invoice-${invoice.id}-per-piece.pdf` : `Invoice-${invoice.id}.pdf`;
}

/** Build and hand the file to the browser (or iOS share sheet). */
export async function saveInvoicePdf(invoice: Invoice, opts: InvoicePdfOptions = {}): Promise<void> {
  if (typeof window === 'undefined') return;
  // Opened before any await, or iOS treats the later open as a pop-up.
  const iOSWin = openPDFWindowForIOS();
  try {
    const doc = await buildInvoicePdf(invoice, opts);
    await savePDF(doc, invoicePdfFileName(invoice, opts), iOSWin);
  } catch (e) {
    iOSWin?.close();
    throw e;
  }
}
