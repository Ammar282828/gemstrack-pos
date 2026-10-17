/**
 * The Hisaab page's two papers: the Summary (everyone outstanding, cash and metal, receivable or
 * payable) and one person's Ledger Statement (their rows oldest first, under where they stand).
 *
 * One drawer each for the pages' buttons and the server's copy for the iPhone app
 * (/api/app/pdf/hisaab, /api/app/pdf/hisaab/[id]). The sums are hisaab-report.ts; this only draws.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { STORE_METAL_WORD } from '@/lib/store-config';
import { fitText } from '@/lib/pdf-text';
import { deviceWall, type WallClock } from '@/lib/wall-clock';
import type { HisaabAccountBalance, HisaabLedgerLine } from '@/lib/hisaab-report';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

// ── the summary ─────────────────────────────────────────────────────────────

/** "12,000 (Receivable)" / "3,500 (Payable)": the page's words for a side. */
export function hisaabSummaryRow(summary: HisaabAccountBalance, index: number): (string | number)[] {
  const cashBalanceText = summary.cashBalance > 0
    ? `${summary.cashBalance.toLocaleString()} (Receivable)`
    : `${Math.abs(summary.cashBalance).toLocaleString()} (Payable)`;
  const goldBalanceText = summary.goldBalance > 0
    ? `${summary.goldBalance.toLocaleString(undefined, { minimumFractionDigits: 3 })} (Receivable)`
    : `${Math.abs(summary.goldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })} (Payable)`;
  return [
    index + 1,
    summary.entityName,
    summary.entityType.charAt(0).toUpperCase() + summary.entityType.slice(1),
    cashBalanceText,
    goldBalanceText,
  ];
}

export const hisaabSummaryFileName = (asOf: Date) => `Hisaab-Summary-${format(asOf, 'yyyy-MM-dd')}.pdf`;

/** `asOf` already on the wall clock (wall-clock.ts). */
export function drawHisaabSummaryPdf(accounts: HisaabAccountBalance[], asOf: Date): jsPDF {
  const doc = new jsPDF();
  doc.setFont('helvetica', 'bold').setFontSize(18);
  doc.text(`Hisaab Summary Report`, 14, 22);
  doc.setFontSize(10);
  doc.text(`As of: ${format(asOf, 'PPpp')}`, 14, 29);

  doc.autoTable({
    head: [['#', 'Name', 'Type', 'Cash Balance (PKR)', `${STORE_METAL_WORD} Balance (g)`]],
    body: accounts.map(hisaabSummaryRow),
    startY: 40,
    margin: { left: 14, right: 14 },
    theme: 'grid',
    headStyles: { fillColor: [41, 128, 185], textColor: 255 },
  });
  return doc;
}

// ── one person's ledger ─────────────────────────────────────────────────────

export interface HisaabLedgerPdfInput {
  name: string;
  entityType: 'customer' | 'karigar';
  /** Oldest first (hisaabLedger). */
  lines: HisaabLedgerLine[];
  finalCashBalance: number;
  finalGoldBalance: number;
  /** Already on the wall clock. */
  asOf: Date;
  /** How a row's day is read. */
  wall?: WallClock;
}

export const hisaabLedgerFileName = (name: string, asOf: Date) => `Ledger-${name}-${format(asOf, 'yyyy-MM-dd')}.pdf`;

export function drawHisaabLedgerPdf({ name, entityType, lines, finalCashBalance, finalGoldBalance, asOf, wall = deviceWall }: HisaabLedgerPdfInput): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;

  // Header
  doc.setFont('helvetica', 'bold').setFontSize(18);
  doc.text(`Ledger Statement`, margin, 22);
  doc.setFontSize(12);
  fitText(doc, name, margin, 29, pageWidth - margin * 2);
  doc.setFontSize(10);
  doc.text(`(${entityType})`, margin, 35);

  doc.setFont('helvetica', 'normal').setFontSize(10);
  doc.text(`Date: ${format(asOf, 'PP')}`, pageWidth - margin, 22, { align: 'right' });

  // Balance Summary
  let summaryY = 50;
  doc.setFont('helvetica', 'bold').setFontSize(12);
  doc.text('Final Balance', margin, summaryY);
  summaryY += 7;

  doc.setFont('helvetica', 'normal').setFontSize(10);
  const cashBalanceText = finalCashBalance > 0
    ? `Receivable: PKR ${finalCashBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `Payable: PKR ${Math.abs(finalCashBalance).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  doc.text(`Cash: ${cashBalanceText}`, margin, summaryY);
  summaryY += 7;

  const goldBalanceText = finalGoldBalance > 0
    ? `Receivable: ${finalGoldBalance.toLocaleString(undefined, { minimumFractionDigits: 3 })}g`
    : `Payable: ${Math.abs(finalGoldBalance).toLocaleString(undefined, { minimumFractionDigits: 3 })}g`;
  doc.text(`${STORE_METAL_WORD}: ${goldBalanceText}`, margin, summaryY);

  // Table — oldest first for the printed statement
  const tableStartY = summaryY + 15;
  const tableColumns = ['Date', 'Description', 'Debit (Dr)', 'Credit (Cr)', `${STORE_METAL_WORD} Out (g)`, `${STORE_METAL_WORD} In (g)`];
  const tableRows = lines.map(entry => [
    format(wall(parseISO(entry.date)), 'dd-MMM-yy'),
    entry.description,
    entry.cashDebit > 0 ? entry.cashDebit.toLocaleString() : '-',
    entry.cashCredit > 0 ? entry.cashCredit.toLocaleString() : '-',
    entry.goldDebitGrams > 0 ? entry.goldDebitGrams.toLocaleString(undefined, { minimumFractionDigits: 3 }) : '-',
    entry.goldCreditGrams > 0 ? entry.goldCreditGrams.toLocaleString(undefined, { minimumFractionDigits: 3 }) : '-',
  ]);

  doc.autoTable({
    head: [tableColumns],
    body: tableRows,
    startY: tableStartY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    headStyles: { fillColor: [240, 240, 240], textColor: 50, fontStyle: 'bold', fontSize: 9 },
    styles: { fontSize: 8, cellPadding: 2, valign: 'middle' },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 'auto' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  });
  return doc;
}
