/**
 * The Expenses page's report, on paper: "Expense Report", when it was asked for, the filters that
 * were on screen, the rows in the screen's own buckets with each bucket's subtotal, and the total.
 *
 * One drawer for the page's Report button and the server's copy for the iPhone app
 * (/api/app/pdf/expenses). Which rows, in which buckets, is expense-report.ts; this only draws.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format, parseISO } from 'date-fns';
import { fitText } from '@/lib/pdf-text';
import type { ExpenseGroup } from '@/lib/expense-report';
import { deviceWall, type WallClock } from '@/lib/wall-clock';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
  }
}

export interface ExpenseReportPdfInput {
  groups: ExpenseGroup[];
  total: number;
  /** expenseFilterLine. */
  filterLine: string;
  /** When it was asked for, already on the wall clock. */
  asOf: Date;
  /** How a row's day is read (expense-report.ts). */
  wall?: WallClock;
}

export const expenseReportFileName = (asOf: Date) => `Expense-Report-${format(asOf, 'yyyy-MM-dd')}.pdf`;

const amount = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2 });

export function drawExpenseReportPdf({ groups, total, filterLine, asOf, wall = deviceWall }: ExpenseReportPdfInput): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold').setFontSize(18);
  doc.text(`Expense Report`, 14, 22);
  doc.setFont('helvetica', 'normal').setFontSize(10);
  doc.text(`As of: ${format(asOf, 'PPpp')}`, pageWidth - 14, 22, { align: 'right' });
  // A long search term used to run straight off the page.
  fitText(doc, `Filters: ${filterLine}`, 14, 29, pageWidth - 28);

  // The PDF follows the same graduation as the screen, subtotals included,
  // so a printed report matches what was on screen when it was asked for.
  const body: any[] = [];
  for (const g of groups) {
    body.push([{ content: `${g.label}${g.sub ? ` · ${g.sub}` : ''}`, colSpan: 3, styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } },
               { content: amount(g.total), styles: { fontStyle: 'bold', halign: 'right', fillColor: [240, 240, 240] } }]);
    for (const e of g.rows) {
      body.push([
        format(wall(parseISO(e.date)), 'dd-MMM-yyyy'),
        e.category,
        e.description,
        amount(e.amount),
      ]);
    }
  }

  doc.autoTable({
    head: [['Date', 'Category', 'Description', 'Amount (PKR)']],
    body,
    startY: 40,
    margin: { left: 14, right: 14 },
    theme: 'grid',
    headStyles: { fillColor: [41, 128, 185], textColor: 255 },
    columnStyles: { 3: { halign: 'right' } },
  });

  const finalY = (doc as any).lastAutoTable.finalY;
  doc.setFont('helvetica', 'bold').setFontSize(12);
  doc.text(`Total Expenses: PKR ${amount(total)}`, pageWidth - 14, finalY + 10, { align: 'right' });
  return doc;
}
