import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

vi.hoisted(() => { process.env.NEXT_PUBLIC_STORE_LINKS_URL = 'https://links.example.com'; });
vi.mock('@/lib/reports/monthly-server', () => ({ serverLogo: async () => null }));
// Every jsPDF made while a test runs reports each text() and autoTable() to `tap`.
const tap = vi.hoisted(() => ({ texts: null as any[] | null, tables: null as any[] | null, owner: null as any }));
vi.mock('jspdf', async () => {
  const mod: any = await vi.importActual('jspdf');
  const Real = mod.jsPDF ?? mod.default;
  class Tapped extends Real {
    constructor(...a: any[]) {
      super(...a);
      // Only the document being drawn is watched; the scratch sheet the layout measures on is not.
      if (tap.texts && !tap.owner) tap.owner = this;
      const text = this.text.bind(this);
      this.text = (t: any, x: any, y: any, ...r: any[]) => {
        if (tap.owner === this) tap.texts?.push({ page: this.getNumberOfPages(), y, text: Array.isArray(t) ? t.join(' ') : String(t) });
        return text(t, x, y, ...r);
      };
      const at = this.autoTable?.bind(this);
      if (at) this.autoTable = (...a2: any[]) => {
        const r = at(...a2);
        if (tap.owner === this) tap.tables?.push({ pages: this.getNumberOfPages(), finalY: this.lastAutoTable.finalY });
        return r;
      };
    }
  }
  return { ...mod, jsPDF: Tapped, default: Tapped };
});
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {}, adminAuth: {} }));

const { KARACHI_DATES } = await import('./pdf-inputs');
const { serverPdfImages } = await import('./pdf-inputs-server');
const { drawInvoicePdf } = await import('./invoice-pdf');
const { FOOTER_HEIGHT } = await import('./pdf-chrome');

import type { Invoice } from '@/lib/store';

const OUT = process.env.INVOICE_PDF_OUT; // set to also write the PDFs for a look

const item = (i: number) => ({
  sku: `NEW-${i}`, name: `Test ring ${i}`, categoryId: 'cat001', metalType: 'gold', karat: '22k', metalWeightG: 3.5, quantity: 1,
  unitPrice: 99_000, itemTotal: 99_000, metalCost: 90_000, wastageCost: 4_000, makingCharges: 5_000,
  diamondChargesIfAny: 0, stoneChargesIfAny: 0, miscChargesIfAny: 0,
});

function make(n: number, o: { discount?: boolean; exchange?: boolean; payments?: number }): Invoice {
  const subtotal = n * 99_000;
  const discountAmount = o.discount ? 5_000 : 0;
  const exch = o.exchange ? 20_000 : 0;
  const grandTotal = subtotal - discountAmount - exch;
  const payments = Array.from({ length: o.payments ?? 0 }, (_, k) => ({
    amount: 5_000, date: '2026-10-09T09:00:00.000Z', method: 'Cash', notes: `Advance ${k + 1}`,
  }));
  const paid = payments.length * 5_000;
  return {
    id: `INV-${n}`, customerName: 'Test Customer', items: Array.from({ length: n }, (_, i) => item(i + 1)),
    subtotal, discountAmount, grandTotal, amountPaid: paid, balanceDue: grandTotal - paid,
    ...(exch ? { exchanges: [{ description: 'Old gold', value: exch }] } : {}),
    paymentHistory: payments,
    createdAt: '2026-10-09T09:00:00.000Z', ratesApplied: { goldRatePerGram22k: 25_000 },
  } as unknown as Invoice;
}

interface Trace { page: number; y: number; text: string }

async function render(inv: Invoice, name: string) {
  const images = await serverPdfImages();
  const texts: Trace[] = [];
  const tables: { pages: number; finalY: number }[] = [];
  tap.texts = texts; tap.tables = tables; tap.owner = null;
  let doc: any;
  doc = drawInvoicePdf(inv, { images, dates: KARACHI_DATES });
  tap.texts = tap.tables = tap.owner = null;
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(doc.output('arraybuffer'))); }
  return { doc, texts, tables, pages: doc.getNumberOfPages() as number, pageHeight: doc.internal.pageSize.getHeight() as number };
}

type Opts = { discount?: boolean; exchange?: boolean; payments?: number };
const cases: [string, number, Opts][] = [];
for (const n of [1, 3, 4, 5, 6, 8, 12, 20]) {
  cases.push([`${n}-plain`, n, {}]);
  cases.push([`${n}-discount-exchange-3pay`, n, { discount: true, exchange: true, payments: 3 }]);
  cases.push([`${n}-discount-exchange-8pay`, n, { discount: true, exchange: true, payments: 8 }]);
  cases.push([`${n}-discount-exchange-9pay`, n, { discount: true, exchange: true, payments: 9 }]);
}

const MARGIN = 10;
const TOP = 28;          // a continuation page's content starts here
const TABLE_START = 51;  // infoY 33 + 18 (the rates line shows for 22k gold)
const GAP = 10;          // items -> totals

type Cal = Awaited<ReturnType<typeof calibrate>>;

/** Block heights measured off the renderer itself. */
async function calibrate() {
  const one = await render(make(1, {}), 'cal-1');
  const two = await render(make(2, {}), 'cal-2');
  const rowH = two.tables[0].finalY - one.tables[0].finalY;
  const rowsStart = one.tables[0].finalY - rowH;
  // Where the rows start on a page the table runs over onto (autoTable leaves a gap under that head).
  const five = await render(make(12, {}), 'cal-12');
  const ring = (page: number) => five.texts.find(t => t.page === page && t.text === 'Ring')!.y;
  const contRowsStart = ring(2) - (ring(1) - rowsStart);
  // The full-width table (more than 8 payments).
  const h9 = await render(make(1, { payments: 9 }), 'cal-h9');
  const title = h9.texts.find(t => t.text === 'Payment History')!;
  const adv = (k: number) => h9.texts.find(t => t.text === `Advance ${k}`)!.y;
  const histRowH = adv(2) - adv(1);
  const histHeadH = h9.tables[h9.tables.length - 1].finalY - (title.y + 4) - 9 * histRowH;
  const h3 = await render(make(1, { payments: 3 }), 'cal-h3');
  // The narrow table beside the totals (up to 8 payments): its own row and head heights.
  const besideTitle = (r: typeof h3) => r.texts.find(t => t.text === 'Payment History')!;
  const b = (r: typeof h3, k: number) => r.texts.find(t => t.text.includes(`Advance ${k}`))!.y;
  const bRowH = b(h3, 2) - b(h3, 1);
  const bHeadH = h3.tables[h3.tables.length - 1].finalY - (besideTitle(h3).y + 2) - 3 * bRowH;
  return { rowH, rowsStart, contRowsStart, histRowH, histHeadH, bRowH, bHeadH, pageHeight: one.pageHeight as number };
}

/**
 * The fewest pages the layout rules allow: items (head repeated, split between rows), then the
 * totals whole (the last item row travels with them when they must break), then Payment History
 * (title + head + first row together, split between rows), and the footer band reserved only on
 * the last page.
 */
function minPages(n: number, o: Opts, c: Cal): number {
  const footerTop = c.pageHeight - FOOTER_HEIGHT;
  const bottom = c.pageHeight - MARGIN;
  const pay = o.payments ?? 0;
  const totalsH = (1 + (o.discount ? 1 : 0) + (o.exchange ? 1 : 0)) * 5 + 13.5 + (pay ? 5 + 11 : 0);
  const contStart = c.contRowsStart;
  let page = 1, y = c.rowsStart, left = n, onPage = 0;
  while (left > 0) {
    const take = Math.max(1, Math.min(left, Math.floor((bottom - y + 1e-6) / c.rowH)));
    y += take * c.rowH; left -= take; onPage = take;
    if (left > 0) { page++; y = contStart; }
  }
  let start = y + GAP;
  if (start + totalsH > bottom) {
    page++;
    if (n > 1 && onPage > 1) start = TOP + (c.rowsStart - TABLE_START) + c.rowH + GAP;   // the last row comes along, under a fresh head
    else start = 30;                                              // the block alone
  }
  let end = start + totalsH - 2;
  if (pay >= 1 && pay <= 8) {
    // Payment History sits beside the totals: one block, as tall as the taller, never split.
    const beside = 2.5 + 2 + c.bHeadH + pay * c.bRowH;
    const blockH = Math.max(totalsH, beside);
    if (start + blockH > bottom) { page++; start = 30; }
    end = start + Math.max(totalsH - 2, beside - 2);
    return end > footerTop ? page + 1 : page;
  }
  // Only the footer needs room under the last block; if it has none it takes a page alone.
  if (!pay) return end > footerTop ? page + 1 : page;
  let hy: number;
  if (end + 6 + 4 + c.histHeadH + c.histRowH > bottom) { page++; hy = 24 + 6 + 4; } else hy = end + 6 + 4;
  hy += c.histHeadH;
  let rest = pay;
  while (rest > 0) {
    const take = Math.max(1, Math.min(rest, Math.floor((bottom - hy + 1e-6) / c.histRowH)));
    hy += take * c.histRowH; rest -= take;
    if (rest > 0) { page++; hy = TOP + c.histHeadH; }
  }
  return hy > footerTop ? page + 1 : page;
}

describe('invoice PDF layout', () => {
  let cal: Cal;
  for (const [name, n, o] of cases) {
    it(`${name}: fewest pages, totals whole, footer clear`, async () => {
      cal ??= await calibrate();
      const r = await render(make(n, o), name);
      if (OUT) console.log(`PAGES ${name} ${r.pages}`);
      if (process.env.DBG === name) console.log(JSON.stringify(r.texts.map(t => [t.page, Math.round(t.y), t.text.slice(0, 18)])), JSON.stringify(r.tables), JSON.stringify(cal));
      const footerTop = r.pageHeight - FOOTER_HEIGHT;
      const onLast = r.texts.filter(t => t.page === r.pages);
      // The footer is the tail of the last page's text, at or below its rule.
      let cut = onLast.length;
      while (cut > 0 && onLast[cut - 1].y >= footerTop - 0.01) cut--;
      const content = onLast.slice(0, cut).filter(t => !/^Page \d+$/.test(t.text)), footer = onLast.slice(cut);
      expect(footer.length).toBeGreaterThan(0);
      expect(r.texts.filter(t => t.page < r.pages && /ORDERS & ENQUIRIES/i.test(t.text))).toEqual([]); // the footer is on the last page only
      expect(Math.max(...content.map(t => t.y))).toBeLessThan(footerTop);
      // The totals are one block on one page.
      const names = ['Subtotal', 'Discount', 'Exchange', 'Grand Total', 'Amount Paid', 'Balance Due'];
      const tot = r.texts.filter(t => names.some(k => t.text.startsWith(k)));
      expect(new Set(tot.map(t => t.page)).size).toBe(1);
      // Payment History follows the totals and the table below it never sits in the footer band.
      if (o.payments) expect(r.texts.find(t => t.text === 'Payment History')!.page).toBeGreaterThanOrEqual(tot[0].page);
      if (process.env.DBG === name) console.log('CAL', JSON.stringify(cal), minPages(n, o, cal));
      expect(r.pages).toBe(minPages(n, o, cal));
    });
  }
});
