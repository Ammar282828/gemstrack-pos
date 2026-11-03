import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/reports/monthly-server', () => ({ serverLogo: async () => null }));
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {}, adminAuth: {} }));

const { drawInvoicePdf } = await import('./invoice-pdf');
const { drawOrderPdf } = await import('./order-pdf');
const { drawOrderSlipPdf } = await import('./order-slip-pdf');
const { cleanReferenceImage, referenceKey, wantedReferences } = await import('./reference-image');

import type { Invoice, Order } from '@/lib/store';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const pic = { dataUrl: PNG, format: 'PNG' as const, aspect: 1 };
const imageCount = (doc: { output: (t: 'arraybuffer') => ArrayBuffer }) =>
  (new TextDecoder('latin1').decode(doc.output('arraybuffer')).match(/\/Subtype \/Image/g) || []).length;
const text = (doc: { output: (t: 'arraybuffer') => ArrayBuffer }) => new TextDecoder('latin1').decode(doc.output('arraybuffer'));

const line = (n: number, extra: Record<string, unknown> = {}) => ({
  sku: `NEW-${n}`, name: `Test ring ${n}`, categoryId: 'cat001', metalType: 'gold', karat: '22k', metalWeightG: 3.5, quantity: 1,
  unitPrice: 99_000, itemTotal: 99_000, metalCost: 90_000, wastageCost: 4_000, makingCharges: 5_000,
  diamondChargesIfAny: 0, stoneChargesIfAny: 0, miscChargesIfAny: 0, ...extra,
});
const URL1 = 'https://shop.example.com/catalog-full/Rings/Ring%201.webp';
const URL2 = 'https://shop.example.com/catalog-full/Rings/Ring%202.webp';
const invoiceOf = (items: unknown[]) => ({
  id: 'INV-T1', customerName: 'Test Customer', items, subtotal: 198_000, discountAmount: 0, grandTotal: 198_000, amountPaid: 0, balanceDue: 198_000,
  createdAt: '2026-10-09T09:00:00.000Z', ratesApplied: { goldRatePerGram22k: 25_000 },
}) as unknown as Invoice;
const orderOf = (items: unknown[]) => ({
  id: 'ORD-T1', createdAt: '2026-10-09T09:00:00.000Z', status: 'Pending', customerName: 'Test Customer', items,
  ratesApplied: {}, subtotal: 120_000, advancePayment: 0, grandTotal: 120_000,
}) as unknown as Order;
const piece = (extra: Record<string, unknown> = {}) => ({ itemCategory: 'cat001', description: 'Test ring', metalType: 'gold', karat: '22k', estimatedWeightG: 4, wastagePercentage: 8, totalEstimate: 120_000, ...extra });

describe('reference images on the bill', () => {
  it('prints nothing extra without images, and does not break with missing ones', async () => {
    const marked = invoiceOf([line(1, { printReference: true, referenceImage: URL1 })]);
    const none = imageCount(await drawInvoicePdf(marked, { images: {} }));
    expect(await drawInvoicePdf(marked, { images: { references: {} } })).toBeTruthy();
    expect(imageCount(await drawInvoicePdf(marked, { images: { references: { [URL1]: null } } }))).toBe(none);
  });
  it('prints a marked piece\'s picture beside its name, and only marked ones', async () => {
    const a = invoiceOf([line(1, { printReference: true, referenceImage: URL1 })]);
    const base = imageCount(await drawInvoicePdf(invoiceOf([line(1)]), { images: {} }));
    expect(imageCount(await drawInvoicePdf(a, { images: { references: { [URL1]: pic } } }))).toBeGreaterThan(base);
    expect(imageCount(await drawInvoicePdf(invoiceOf([line(1, { referenceImage: URL1 })]), { images: { references: { [URL1]: pic } } }))).toBe(base);
  });
  it('per piece: each page its own; combined: each marked row its own, beside its name', async () => {
    const inv = invoiceOf([line(1, { printReference: true, referenceImage: URL1 }), line(2, { printReference: true, referenceImage: URL2 })]);
    const references = { [URL1]: pic, [URL2]: pic };
    const base = imageCount(await drawInvoicePdf(inv, { images: {} }));
    expect(imageCount(await drawInvoicePdf(inv, { images: { references } }))).toBeGreaterThan(base);
    expect(imageCount(await drawInvoicePdf(inv, { images: { references }, perPiece: true }))).toBeGreaterThan(base);
  });
  it('the order estimate prints it, with or without it', () => {
    const o = orderOf([piece({ printReference: true, referenceImage: URL1 })]);
    const base = imageCount(drawOrderPdf(o, { images: {} }));
    expect(imageCount(drawOrderPdf(o, { images: { references: { [URL1]: pic } } }))).toBeGreaterThan(base);
    expect(() => drawOrderPdf(o, { images: { references: { [URL1]: null } } })).not.toThrow();
    // A piece with no address of its own is keyed `own:<index>`.
    const own = orderOf([piece({ printReference: true })]);
    expect(imageCount(drawOrderPdf(own, { images: { references: { 'own:0': pic } } }))).toBeGreaterThan(base);
  });
  it('the slip never prints it, and is titled "Order slip", not "Workshop"', () => {
    const o = orderOf([piece({ printReference: true, referenceImage: URL1 })]);
    const slip = drawOrderSlipPdf(o, { images: { references: { [URL1]: pic } } });
    expect(imageCount(slip)).toBe(imageCount(drawOrderSlipPdf(o, { images: {} })));
    expect(text(slip).toLowerCase()).not.toContain('workshop');
  });
});

describe('reference helpers', () => {
  it('keeps only https addresses', () => {
    expect(cleanReferenceImage(' https://a.example.com/x.webp ')).toBe('https://a.example.com/x.webp');
    expect(cleanReferenceImage('http://a.example.com/x.webp')).toBeUndefined();
    expect(cleanReferenceImage('javascript:alert(1)')).toBeUndefined();
    expect(cleanReferenceImage('data:image/png;base64,AAAA')).toBeUndefined();
  });
  it('wants each marked piece once', () => {
    const w = wantedReferences([{ printReference: true }, { printReference: true, referenceImage: URL1 }, { printReference: true, referenceImage: URL1 }, {}]);
    expect(w.map(x => x.key)).toEqual(['own:0', URL1]);
    expect(referenceKey({}, 3)).toBe('own:3');
  });
});

describe('the picture in the item row', () => {
  it('makes the row at least as tall as the picture, and narrows the words', async () => {
    const { default: JsPDF } = await import('jspdf');
    const { itemCellHeight, PICTURE_BOX } = await import('./invoice-item-cell');
    const doc = new JsPDF({ unit: 'mm', format: 'a5' });
    const block = { name: 'Ring', spec: 'x', settings: [], breakdown: [] };
    const plain = itemCellHeight(doc, block, 90);
    const withPic = itemCellHeight(doc, { ...block, picture: pic }, 90);
    expect(withPic).toBeGreaterThanOrEqual(PICTURE_BOX + 4);
    expect(withPic).toBeGreaterThan(plain);
    const long = { ...block, spec: 'long words '.repeat(30) };
    expect(itemCellHeight(doc, { ...long, picture: pic }, 90)).toBeGreaterThan(itemCellHeight(doc, long, 90));
  });
});
