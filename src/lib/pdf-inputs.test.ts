import { describe, expect, it, vi } from 'vitest';

// A house with a link page (made-up address), set before store-config reads it.
vi.hoisted(() => { process.env.NEXT_PUBLIC_STORE_LINKS_URL = 'https://links.example.com'; });

// The wordmark is the house's file on disk or its address; none here, which every document allows.
vi.mock('@/lib/reports/monthly-server', () => ({ serverLogo: async () => null }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {}, adminAuth: {} }));

const { KARACHI_DATES } = await import('./pdf-inputs');
const { serverPdfImages } = await import('./pdf-inputs-server');
const { drawInvoicePdf, invoicePdfFileName } = await import('./invoice-pdf');
const { drawOrderSlipPdf, orderSlipFileName } = await import('./order-slip-pdf');

import type { Invoice, Order } from '@/lib/store';

const pdfText = (doc: { output: (t: 'arraybuffer') => ArrayBuffer }) => new TextDecoder('latin1').decode(doc.output('arraybuffer'));
const images = (doc: { output: (t: 'arraybuffer') => ArrayBuffer }) => (pdfText(doc).match(/\/Subtype \/Image/g) || []).length;

// Made up.
const invoice = {
  id: 'INV-T1', customerName: 'Test Customer', items: [{
    sku: 'NEW-1', name: 'Test ring', categoryId: 'cat001', metalType: 'gold', karat: '22k', metalWeightG: 3.5, quantity: 1,
    unitPrice: 99_000, itemTotal: 99_000, metalCost: 90_000, wastageCost: 4_000, makingCharges: 5_000,
    diamondChargesIfAny: 0, stoneChargesIfAny: 0, miscChargesIfAny: 0,
  }],
  subtotal: 99_000, discountAmount: 0, grandTotal: 99_000, amountPaid: 0, balanceDue: 99_000,
  createdAt: '2026-10-09T09:00:00.000Z', ratesApplied: { goldRatePerGram22k: 25_000 },
} as unknown as Invoice;

const order = {
  id: 'ORD-T1', createdAt: '2026-10-09T09:00:00.000Z', status: 'Pending', customerName: 'Test Customer',
  items: [{ itemCategory: 'cat001', description: 'Test ring', metalType: 'gold', karat: '22k', estimatedWeightG: 4, wastagePercentage: 8, totalEstimate: 120_000 }],
  ratesApplied: {}, subtotal: 120_000, advancePayment: 10_000, grandTotal: 110_000,
  advances: [{ amount: 5_000, date: '2026-10-09T20:00:00.000Z', method: 'Cash' }],
} as unknown as Order;

describe('KARACHI_DATES', () => {
  it("writes the shop's day, not the server's (UTC)", () => {
    const lateNight = '2026-10-08T20:30:00.000Z'; // 01:30 on the 9th in Karachi
    expect(KARACHI_DATES.short(lateNight)).toBe('09/10/2026');
    expect(KARACHI_DATES.medium(lateNight)).toBe('Oct 9, 2026');
    expect(KARACHI_DATES.dayMonthYear(lateNight)).toBe('9 Oct 2026');
  });
  it('a plain day is that day; September as date-fns spells it; nonsense is blank', () => {
    expect(KARACHI_DATES.medium('2026-10-20')).toBe('Oct 20, 2026');
    expect(KARACHI_DATES.dayMonthYear('2026-09-03T10:00:00.000Z')).toBe('3 Sep 2026');
    expect(KARACHI_DATES.short('not a date')).toBe('');
  });
});

describe('the builders without a page', () => {
  it('draw the invoice with the server codes, as one file per invoice', async () => {
    const imgs = await serverPdfImages();
    expect(String(imgs.linksQr)).toMatch(/^data:image\/png;base64,/);
    const doc = drawInvoicePdf(invoice, { images: imgs, dates: KARACHI_DATES });
    // The code is drawn (jsPDF adds its alpha mask as a second image object).
    expect(images(doc)).toBeGreaterThan(0);
    const t = pdfText(doc);
    // The one code, and its address written out under the contacts.
    expect(t).toContain('links.example.com');
    expect(t).toContain('Estimate #: INV-T1');
    expect(t).toContain('Date: 09/10/2026');
    expect(invoicePdfFileName(invoice)).toBe('Invoice - Test Customer.pdf');
    // Per piece only names a bill of more than one.
    expect(invoicePdfFileName(invoice, { perPiece: true })).toBe('Invoice - Test Customer.pdf');
  });

  it('draw with no pictures at all', () => {
    const doc = drawInvoicePdf(invoice, { images: {} });
    expect(images(doc)).toBe(0);
    expect(pdfText(doc)).toContain('Estimate #: INV-T1');
  });

  it("draw the slip, its advances on the shop's day", async () => {
    const doc = drawOrderSlipPdf(order, { images: await serverPdfImages(), dates: KARACHI_DATES });
    const t = pdfText(doc);
    expect(t).toContain('Order ID: ORD-T1');
    // 01:00 on the 10th in Karachi.
    expect(t).toContain('Advance 10 Oct 2026');
    expect(t).toContain('Balance Due');
    expect(orderSlipFileName(order)).toBe('OrderSlip-ORD-T1.pdf');
  });
});
