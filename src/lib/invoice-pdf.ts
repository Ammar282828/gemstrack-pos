"use client";

/**
 * The customer's invoice, on paper.
 *
 * One builder for the three places that print one — the invoices list, the
 * post-sale screen in the cart, and the customer's own link — where there
 * used to be three near-identical copies drifting apart by a line each.
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
import { STORE_LOGO_ASPECT } from '@/lib/store-config';
import { staticCategories, type Invoice, type InvoiceItem, type Customer } from '@/lib/store';
import { openPDFWindowForIOS, savePDF } from '@/lib/utils';
import { loadPdfLogo } from '@/lib/pdf-logo';
import { stockSku } from '@/lib/sku';
import { format } from 'date-fns';
import { getInvoiceAdjustmentsAmount } from '@/lib/financials';
import { drawItemCell, itemCellHeight, type ItemBlock, wastageLine } from '@/lib/invoice-item-cell';
import { drawDocHeader, drawDocFooter, tableStyles, drawRowRule, alignHeadCell, label, drawTotals, type TotalRow } from '@/lib/pdf-chrome';
import { describeExchangeEntry } from '@/lib/exchange';

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
    `Date: ${new Date(inv.createdAt).toLocaleDateString()}`,
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

  doc.autoTable({
    ...tableStyles(margin),
    head: [['#', 'Product & Breakdown', 'Qty', 'Unit', 'Total']],
    body: tableRows,
    startY: tableStartY,
    columnStyles: INVOICE_COLUMNS,
    didParseCell: (data: any) => {
      alignHeadCell(data, INVOICE_COLUMNS);
      // Tell autoTable how tall the hand-drawn cell will be, and stop it
      // laying out text of its own there.
      if (data.section === 'body' && data.column.index === 1) {
        const block = itemBlocks[data.row.index];
        if (block) {
          data.cell.text = [];
          data.cell.styles.minCellHeight = itemCellHeight(doc, block, descColWidth);
        }
      }
    },
    didDrawCell: (data: any) => {
      if (data.section === 'body' && data.column.index === 1) {
        const block = itemBlocks[data.row.index];
        if (block) drawItemCell(doc, block, data.cell, descColWidth);
      }
      drawRowRule(doc, data, 4, { margin, pageWidth });
    },
    didDrawPage: (data: { pageNumber: number; settings: { startY: number } }) => {
      if (data.pageNumber > firstPage) { doc.setPage(data.pageNumber); data.settings.startY = 28; }
      drawHeader(data.pageNumber);
    },
  });

  let finalY = doc.lastAutoTable.finalY || 0;

  if (inv.paymentHistory && inv.paymentHistory.length > 0) {
    finalY += 8;
    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0);
    doc.text('Payment History', margin, finalY);
    finalY += 4;
    // How each was paid — an order's advances arrive here one by one, each with its method —
    // and notes that wrap rather than run off the page.
    doc.autoTable({
      head: [['Date', 'How', 'Notes', 'Amount']],
      body: inv.paymentHistory.map(p => [
        format(new Date(p.date), 'PP'),
        [p.method, p.reference].filter(Boolean).join(' · ') || '—',
        p.notes || 'Payment received',
        pkr(p.amount),
      ]),
      startY: finalY, theme: 'striped',
      margin: { left: margin, right: margin },
      headStyles: { fillColor: [240, 240, 240], textColor: 50, fontSize: 8 },
      styles: { fontSize: 7, overflow: 'linebreak', valign: 'top' },
      columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 30 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 26, halign: 'right' } },
    });
    finalY = doc.lastAutoTable.finalY || finalY;
  }

  if (finalY + 70 > pageHeight - margin) {
    doc.addPage(); drawHeader(doc.getNumberOfPages()); finalY = 28;
  }

  const adjustmentsAmount = getInvoiceAdjustmentsAmount(inv);
  const totalRows: TotalRow[] = [{ label: 'Subtotal', value: pkr(inv.subtotal) }];
  if (inv.discountAmount > 0) totalRows.push({ label: 'Discount', value: `- ${pkr(inv.discountAmount)}`, tone: 'ink' });
  if (adjustmentsAmount !== 0) totalRows.push({ label: 'Adjustments', value: pkr(adjustmentsAmount) });
  // One line per thing taken in exchange (lib/exchange.ts); an older invoice, or one piece
  // of a split, has a description and its amounts.
  const exchangeRows = (inv.exchanges || []).filter(e => e.value > 0);
  if (exchangeRows.length === 1) {
    totalRows.push({ label: `Exchange (${describeExchangeEntry(exchangeRows[0])})`, value: `- ${pkr(exchangeRows[0].value)}` });
  } else if (exchangeRows.length > 1) {
    totalRows.push({ label: 'Exchange', value: '', tone: 'ink' });
    for (const e of exchangeRows) totalRows.push({ label: describeExchangeEntry(e), value: `- ${pkr(e.value)}` });
  } else if (inv.exchangeAmount1 || inv.exchangeAmount2) {
    totalRows.push({ label: inv.exchangeDescription ? `Exchange (${inv.exchangeDescription})` : 'Exchange', value: '', tone: 'ink' });
    if (inv.exchangeAmount1) totalRows.push({ label: '', value: `- ${pkr(inv.exchangeAmount1)}` });
    if (inv.exchangeAmount2) totalRows.push({ label: '', value: `- ${pkr(inv.exchangeAmount2)}` });
  }
  drawTotals(doc, {
    pageWidth, pageHeight, margin, startY: finalY + 10, onNewPage: drawHeader,
    rows: totalRows,
    total: { label: 'Grand Total', value: pkr(inv.grandTotal) },
    after: inv.amountPaid > 0 ? [{ label: 'Amount Paid', value: `- ${pkr(inv.amountPaid)}` }] : [],
    closing: inv.amountPaid > 0 ? { label: 'Balance Due', value: pkr(inv.balanceDue) } : undefined,
  });

  // The QR codes are canvases the printing page renders off-screen under
  // these ids; a page without them prints the footer without codes.
  drawDocFooter(doc, {
    pageWidth, pageHeight, margin,
    linksQr: document.getElementById('links-qr-code') as HTMLCanvasElement | null,
    whatsappQr: document.getElementById('wa-qr-code') as HTMLCanvasElement | null,
    instagramQr: document.getElementById('insta-qr-code') as HTMLCanvasElement | null,
  });
}

/** The finished document, not yet saved. */
export async function buildInvoicePdf(invoice: Invoice, opts: InvoicePdfOptions = {}): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a5' });
  // Once per session, not once per print — see pdf-logo.ts.
  const pdfLogo = await loadPdfLogo();
  const chrome: Chrome = {
    pageWidth: doc.internal.pageSize.getWidth(),
    pageHeight: doc.internal.pageSize.getHeight(),
    margin: 10,
    logoDataUrl: pdfLogo?.dataUrl ?? null,
    logoFormat: pdfLogo?.format ?? 'PNG',
  };
  const invoices = opts.perPiece ? splitInvoicePerPiece(invoice) : [invoice];
  invoices.forEach((inv, i) => {
    if (i > 0) doc.addPage();
    drawInvoice(doc, inv, opts.customer, chrome);
  });
  return doc;
}

/** Build and hand the file to the browser (or iOS share sheet). */
export async function saveInvoicePdf(invoice: Invoice, opts: InvoicePdfOptions = {}): Promise<void> {
  if (typeof window === 'undefined') return;
  // Opened before any await, or iOS treats the later open as a pop-up.
  const iOSWin = openPDFWindowForIOS();
  try {
    const doc = await buildInvoicePdf(invoice, opts);
    const name = opts.perPiece && itemsOf(invoice).length > 1
      ? `Invoice-${invoice.id}-per-piece.pdf`
      : `Invoice-${invoice.id}.pdf`;
    await savePDF(doc, name, iOSWin);
  } catch (e) {
    iOSWin?.close();
    throw e;
  }
}
