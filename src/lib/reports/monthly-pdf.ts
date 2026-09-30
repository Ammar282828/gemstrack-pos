/**
 * The monthly report as an A4 PDF: the month's figures on one page, then every sale, every
 * open order taken, every payment, other income and every expense, each as a table.
 *
 * Drawn with the invoices' own furniture (pdf-chrome.ts: the wordmark header, the maroon,
 * the ruled tables) so it reads as the shop's document. Runs in the browser and in Node — the
 * WhatsApp report builds it on the server — so the caller hands in the logo.
 */

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { STORE_CONFIG, STORE_LOGO_ASPECT } from '@/lib/store-config';
import { POS_LABEL } from '@/lib/notify-label';
import { lacCrore } from '@/lib/money';
import { alignHeadCell, BAND, BRAND, drawDocHeader, drawRowRule, hairline, INK, label, MUTED, tableStyles } from '@/lib/pdf-chrome';
import type { MonthlyReport } from './monthly';

declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: { finalY?: number };
  }
}

export interface ReportLogo { dataUrl: string; format: 'PNG' | 'JPEG' }

const M = 14;
const TOP = 28;

/**
 * jsPDF's built-in Helvetica only has WinAnsi's characters: anything else (an arrow, an emoji,
 * a name typed in Urdu) comes out as garbage. Swap the few we use for plain ones.
 */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function plain(s: unknown): string {
  return String(s ?? '')
    .replace(/[→⇒]/g, '->').replace(/[▲↑]/g, '+').replace(/[▼↓]/g, '-').replace(/−/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/[^\u0000-ÿ]/g, ch => (WIN_ANSI_EXTRA.includes(ch) ? ch : ''))
    .replace(/[ \t]{2,}/g, ' ');
}

const rs = (v: number) => Math.round(v).toLocaleString('en-PK');
const pkr = (v: number) => `PKR ${rs(v)}`;
const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' }).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00+05:00` : iso));
const stamp = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

function change(now: number, before: number, prevLabel: string, partial: boolean): string {
  if (partial) return '';
  if (!before) return now ? `nothing in ${prevLabel}` : '';
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return `${pct >= 0 ? '+' : '-'}${Math.abs(pct)}% on ${prevLabel}`;
}

export function buildMonthlyPdf(r: MonthlyReport, logo: ReportLogo | null): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  // Page 1 always: the header's own "Page n" would sit beside this report's "Page n of m".
  const header = () => drawDocHeader(doc, {
    pageWidth: W, pageHeight: H, margin: M, title: 'Monthly report',
    logoDataUrl: logo?.dataUrl ?? null, logoFormat: logo?.format ?? 'PNG', logoAspect: STORE_LOGO_ASPECT, pageNum: 1,
  });
  header();
  const prev = r.previous.label.split(' ')[0];
  const ink = (c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);

  // ── The month
  let y = 36;
  doc.setFont('helvetica', 'bold').setFontSize(20);
  ink(BRAND);
  doc.text(plain(`${r.label}${r.partial ? ' (so far)' : ''}`), M, y);
  y += 6;
  doc.setFont('helvetica', 'normal').setFontSize(8);
  ink(MUTED);
  doc.text(plain(`${STORE_CONFIG.name} · ${day(r.from)} to ${day(r.partial ? r.generatedAt : r.to)} · made ${stamp(r.generatedAt)}`), M, y);

  // ── Four figures; the first on the one tinted band.
  y += 8;
  const tiles = [
    { name: 'Revenue', value: r.revenue.total, note: change(r.revenue.total, r.previous.revenue, prev, r.partial) },
    { name: 'Cash in', value: r.cashIn.total, note: change(r.cashIn.total, r.previous.cashIn, prev, r.partial) },
    { name: 'Expenses', value: r.expenses.business, note: change(r.expenses.business, r.previous.expenses, prev, r.partial) },
    { name: 'After expenses', value: r.net, note: 'before metal and making' },
  ];
  const gap = 4;
  const tileW = (W - 2 * M - gap * 3) / 4;
  tiles.forEach((t, i) => {
    const x = M + i * (tileW + gap);
    if (i === 0) { doc.setFillColor(BAND[0], BAND[1], BAND[2]); doc.rect(x - 2, y - 4, tileW + 2, 20, 'F'); }
    label(doc, t.name, x, y, { size: 6 });
    doc.setFont('helvetica', 'bold').setFontSize(13);
    ink(i === 0 ? BRAND : INK);
    doc.text(plain(`PKR ${lacCrore(t.value)}`), x, y + 7);
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    ink(MUTED);
    doc.text(plain(t.note), x, y + 12);
  });
  y += 22;
  hairline(doc, M, y, W - M, 'rule');
  y += 7;

  // ── Two columns of short lists.
  const colW = (W - 2 * M - 10) / 2;
  const list = (title: string, rows: [string, string, boolean?][], x: number, startY: number): number => {
    let yy = startY;
    label(doc, title, x, yy, { colour: BRAND });
    yy += 5;
    for (const [k, v, strong] of rows) {
      doc.setFont('helvetica', strong ? 'bold' : 'normal').setFontSize(8);
      ink(strong ? INK : [70, 66, 66]);
      const lines = doc.splitTextToSize(plain(k), colW - 34) as string[];
      doc.text(lines, x, yy);
      doc.text(plain(v), x + colW, yy, { align: 'right' });
      yy += 4.4 * lines.length;
      if (strong) yy += 0.6;
    }
    return yy;
  };

  const left = M, right = M + colW + 10;
  const revenueRows: [string, string, boolean?][] = [
    [`Sales · ${r.counts.invoices} invoice${r.counts.invoices === 1 ? '' : 's'}`, pkr(r.revenue.invoices)],
    [`Orders taken, not yet invoiced · ${r.counts.openOrders}`, pkr(r.revenue.openOrders)],
    ['Other income (repairs and the like)', pkr(r.revenue.other)],
    ['Revenue', pkr(r.revenue.total), true],
  ];
  if (r.revenue.coins) revenueRows.push(['Gold coins (kept out of revenue)', pkr(r.revenue.coins)]);
  const cashRows: [string, string, boolean?][] = [
    ['Payments on invoices', pkr(r.cashIn.invoicePayments)],
    ['Advances on open orders', pkr(r.cashIn.orderAdvances)],
    ['Exchange taken', pkr(r.cashIn.exchange)],
    ['Other income', pkr(r.cashIn.extraRevenue)],
    ['Cash in', pkr(r.cashIn.total), true],
    ...r.byMethod.map(m => [m.method === 'Not recorded' ? '  how paid not recorded' : `  paid by ${m.method}`, pkr(m.amount)] as [string, string]),
  ];
  const yA = list('Revenue', revenueRows, left, y);
  const yB = list('Cash in', cashRows, right, y);
  y = Math.max(yA, yB) + 5;

  const metalRows: [string, string, boolean?][] = r.metal.length
    ? r.metal.map(m => [m.label, `${m.grams.toFixed(2)} g`] as [string, string])
    : [['No weighed pieces sold', '']];
  metalRows.push([`${r.counts.pieces} piece${r.counts.pieces === 1 ? '' : 's'} to ${r.counts.customers} customer${r.counts.customers === 1 ? '' : 's'}`, '', true]);
  const expenseRows: [string, string, boolean?][] = [
    ...r.expenses.byCategory.map(c => [c.category, pkr(c.amount)] as [string, string]),
    ['Expenses', pkr(r.expenses.business), true],
  ];
  if (r.expenses.drawings) expenseRows.push(['Partner drawings (not an expense)', pkr(r.expenses.drawings)]);
  const yC = list('Metal sold', metalRows, left, y);
  const yD = list('Expenses', expenseRows, right, y);
  y = Math.max(yC, yD) + 5;

  const yE = list('Still owed', [
    [`On ${r.label}'s sales`, pkr(r.owed.onThisMonth)],
    ['On every sale, all months', pkr(r.owed.allOpen)],
  ], left, y);
  const yF = list(`Against ${r.previous.label}`, [
    ['Revenue', pkr(r.previous.revenue)],
    ['Cash in', pkr(r.previous.cashIn)],
    ['Expenses', pkr(r.previous.expenses)],
  ], right, y);
  y = Math.max(yE, yF) + 4;

  // ── The lists.
  const table = (title: string, note: string, head: string[], body: (string | number)[][], columnStyles: Record<number, object>, foot?: string[], opts: { muted?: (row: number) => boolean } = {}) => {
    if (y > H - 50) { doc.addPage(); header(); y = TOP + 6; } else y += 6;
    label(doc, title, M, y, { colour: BRAND, size: 7 });
    if (note) {
      doc.setFont('helvetica', 'normal').setFontSize(6.5);
      ink(MUTED);
      doc.text(plain(note), W - M, y, { align: 'right' });
    }
    y += 2;
    if (!body.length) {
      doc.setFont('helvetica', 'normal').setFontSize(8);
      ink(MUTED);
      doc.text('None this month.', M, y + 5);
      y += 9;
      return;
    }
    const last = head.length - 1;
    const base = tableStyles(M);
    doc.autoTable({
      ...base,
      margin: { left: M, right: M, top: TOP, bottom: 16 },
      head: [head.map(plain)],
      body: body.map(row => row.map(c => (typeof c === 'number' ? c : plain(c)))),
      ...(foot ? { foot: [foot.map(plain)], showFoot: 'lastPage' } : {}),
      footStyles: { fontStyle: 'bold', textColor: INK as unknown as number[], fontSize: 7.5, cellPadding: { top: 2.4, bottom: 2.4, left: 2, right: 2 } },
      styles: { ...base.styles, fontSize: 7.2, cellPadding: { top: 1.8, bottom: 1.8, left: 1.6, right: 1.6 } },
      headStyles: { ...base.headStyles, cellPadding: { top: 1.4, bottom: 1.8, left: 1.6, right: 1.6 } },
      startY: y,
      // A sale's lines stay together: half a row at the foot of a page and half at the top of the next reads as two sales.
      rowPageBreak: 'avoid',
      columnStyles,
      didParseCell: (data: any) => {
        alignHeadCell(data, columnStyles);
        if (data.section === 'foot') data.cell.styles.halign = (columnStyles as any)[data.column.index]?.halign ?? 'left';
        if (data.section === 'body' && opts.muted?.(data.row.index)) data.cell.styles.textColor = MUTED as unknown as number[];
      },
      didDrawCell: (data: any) => drawRowRule(doc, data, last, { margin: M, pageWidth: W }),
      didDrawPage: () => header(),
    });
    y = doc.lastAutoTable.finalY || y;
  };

  const live = r.sales.filter(s => !s.refunded);
  table(
    'Sales — every invoice',
    `${live.length} sale${live.length === 1 ? '' : 's'}${r.counts.refunded ? `, ${r.counts.refunded} refunded (greyed, not counted)` : ''} · an invoice from an order counts on the order's day`,
    ['Date', 'Invoice', 'Customer', 'Pieces', 'Sale value', 'Paid', 'Balance'],
    r.sales.map(s => [
      day(s.date),
      [s.id, s.orderId ? `from ${s.orderId}` : '', s.invoicedOn ? `invoiced ${day(s.invoicedOn)}` : ''].filter(Boolean).join('\n'),
      s.customer,
      [...s.pieces, s.coin ? '(gold coin — not in revenue)' : '', s.exchange ? `exchange ${rs(s.exchange)}` : '', s.discount ? `discount ${rs(s.discount)}` : ''].filter(Boolean).join('\n'),
      rs(s.value),
      rs(s.paid),
      s.refunded ? 'Refunded' : s.balance ? rs(s.balance) : '—',
    ]),
    {
      0: { cellWidth: 13 },
      1: { cellWidth: 25 },
      2: { cellWidth: 32 },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 21, halign: 'right' },
      5: { cellWidth: 19, halign: 'right' },
      6: { cellWidth: 18, halign: 'right' },
    },
    ['', `${live.length} sales`, '', '', rs(live.reduce((s, x) => s + x.value, 0)), rs(live.reduce((s, x) => s + x.paid, 0)), rs(live.reduce((s, x) => s + x.balance, 0))],
    { muted: i => r.sales[i]?.refunded || r.sales[i]?.coin },
  );

  table(
    'Orders taken, not yet invoiced',
    'counted in revenue at their full value, as in Analytics',
    ['Date', 'Order', 'Customer', 'What', 'Value', 'Advance'],
    r.openOrders.map(o => [day(o.date), o.id, o.customer, o.summary, rs(o.value), o.advance ? rs(o.advance) : '—']),
    { 0: { cellWidth: 13 }, 1: { cellWidth: 25 }, 2: { cellWidth: 32 }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 21, halign: 'right' }, 5: { cellWidth: 19, halign: 'right' } },
    r.openOrders.length ? ['', `${r.openOrders.length} orders`, '', '', rs(r.revenue.openOrders), rs(r.openOrders.reduce((s, o) => s + o.advance, 0))] : undefined,
  );

  table(
    'Payments received',
    'on invoices of any month, and advances on open orders',
    ['Date', 'For', 'Customer', 'Paid by', 'Amount'],
    r.payments.map(p => [day(p.date), p.ref, p.customer, p.method, rs(p.amount)]),
    { 0: { cellWidth: 13 }, 1: { cellWidth: 25 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 30 }, 4: { cellWidth: 24, halign: 'right' } },
    r.payments.length ? ['', `${r.payments.length} payments`, '', '', rs(r.payments.reduce((s, p) => s + p.amount, 0))] : undefined,
  );

  if (r.income.length) table(
    'Other income',
    '',
    ['Date', 'What', 'Amount'],
    r.income.map(i => [day(i.date), i.description, rs(i.amount)]),
    { 0: { cellWidth: 13 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 24, halign: 'right' } },
    ['', `${r.income.length} entries`, rs(r.revenue.other)],
  );

  table(
    'Expenses',
    r.expenses.drawings ? 'partner drawings are listed, greyed, and not counted' : '',
    ['Date', 'Category', 'What', 'Amount'],
    r.expenseRows.map(e => [day(e.date), e.category, e.description, rs(e.amount)]),
    { 0: { cellWidth: 13 }, 1: { cellWidth: 38 }, 2: { cellWidth: 'auto' }, 3: { cellWidth: 24, halign: 'right' } },
    r.expenseRows.length ? ['', '', 'Expenses', rs(r.expenses.business)] : undefined,
    { muted: i => !r.expenseRows[i]?.business },
  );

  // ── Every page: who it is and where it is.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(6.5);
    ink(MUTED);
    doc.text(plain(`${POS_LABEL} · Monthly report · ${r.label}`), M, H - 7);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 7, { align: 'right' });
  }
  return doc;
}

export const monthlyPdfName = (r: MonthlyReport) =>
  `${STORE_CONFIG.name.replace(/[^A-Za-z0-9]+/g, '-')}-monthly-report-${r.month.year}-${String(r.month.month).padStart(2, '0')}.pdf`;
