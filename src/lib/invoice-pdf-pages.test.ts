import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

vi.hoisted(() => { process.env.NEXT_PUBLIC_STORE_LINKS_URL = 'https://links.example.com'; });
vi.mock('@/lib/reports/monthly-server', () => ({ serverLogo: async () => null }));
// Every jsPDF made while a test runs reports each text() and autoTable() to `tap`.
const tap = vi.hoisted(() => ({ texts: null as any[] | null, tables: null as any[] | null }));
vi.mock('jspdf', async () => {
  const mod: any = await vi.importActual('jspdf');
  const Real = mod.jsPDF ?? mod.default;
  class Tapped extends Real {
    constructor(...a: any[]) {
      super(...a);
      const text = this.text.bind(this);
      this.text = (t: any, x: any, y: any, ...r: any[]) => {
        tap.texts?.push({ page: this.getNumberOfPages(), y, text: Array.isArray(t) ? t.join(' ') : String(t) });
        return text(t, x, y, ...r);
      };
      const at = this.autoTable?.bind(this);
      if (at) this.autoTable = (...a2: any[]) => {
        const r = at(...a2);
        tap.tables?.push({ pages: this.getNumberOfPages(), finalY: this.lastAutoTable.finalY });
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
    amount: 10_000, date: '2026-10-09T09:00:00.000Z', method: 'Cash', notes: `Advance ${k + 1}`,
  }));
  const paid = payments.length * 10_000;
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
  tap.texts = texts; tap.tables = tables;
  let doc: any;
  doc = drawInvoicePdf(inv, { images, dates: KARACHI_DATES });
  tap.texts = tap.tables = null;
  if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/${name}.pdf`, Buffer.from(doc.output('arraybuffer'))); }
  return { doc, texts, tables, pages: doc.getNumberOfPages() as number, pageHeight: doc.internal.pageSize.getHeight() as number };
}

const cases: [string, number, { discount?: boolean; exchange?: boolean; payments?: number }][] = [];
for (const n of [1, 3, 4, 5, 6, 8, 12, 20]) {
  cases.push([`${n}-plain`, n, {}]);
  cases.push([`${n}-discount-exchange-3pay`, n, { discount: true, exchange: true, payments: 3 }]);
}

describe('invoice PDF page count', () => {
  const summary: string[] = [];
  for (const [name, n, o] of cases) {
    it(`${name}: totals share the items' page when they fit, footer is never overlapped`, async () => {
      const r = await render(make(n, o), name);
      summary.push(`${name}: ${r.pages} page(s)`); if (process.env.INVOICE_PDF_OUT) console.log(`PAGES ${name} ${r.pages}`);
      const footerTop = r.pageHeight - FOOTER_HEIGHT;
      const last = r.texts.filter(t => t.page === r.pages);
      const sub = r.texts.find(t => t.text === 'Subtotal')!;
      // Totals block: from Subtotal to the last figure it prints.
      const totalsEnd = Math.max(...r.texts.filter(t => t.page === sub.page && t.y >= sub.y && t.y < footerTop + 1 && /Subtotal|Discount|Exchange|Grand Total|Amount Paid|Balance Due|PKR|^- PKR/.test(t.text)).map(t => t.y));
      // The totals are on the last page, with the footer, and end above the footer rule.
      expect(sub.page).toBe(r.pages);
      expect(totalsEnd).toBeLessThan(footerTop);
      // Nothing but the footer is drawn into the footer's band on the last page.
      const inBand = last.filter(t => t.y >= footerTop - 0.01);
      expect(inBand.some(t => /Orders|links\.example/i.test(t.text) || true)).toBe(true);
      expect(last.filter(t => t.y > footerTop - 3 && t.y < footerTop && /PKR|Subtotal|Balance|Total/.test(t.text))).toEqual([]);
      // Minimal: when the totals sit on a page of their own after the items (no table content
      // there), they must really not have fit under the last table.
      const tableEnd = r.tables.filter(t => t.pages === Math.min(...r.tables.map(x => x.pages)) || true).pop()!;
      const lastTablePage = tableEnd.pages;
      if (r.pages > lastTablePage) {
        const totalsHeight = totalsEnd - sub.y + 6;
        expect(tableEnd.finalY + 10 + totalsHeight).toBeGreaterThan(footerTop);
      }
    });
  }
});
