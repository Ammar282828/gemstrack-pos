import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The invoices, orders and customers behind the Admin SDK. All names, numbers and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: !!col(c)[id], id, data: () => col(c)[id], get: (k: string) => col(c)[id]?.[k] }),
        set: async (d: Record<string, unknown>) => { col(c)[id] = { ...(col(c)[id] ?? {}), ...d }; },
      }),
    }),
    doc: (path: string) => ({
      get: async () => {
        const [c, id] = path.split('/');
        return { exists: !!col(c)[id], get: (k: string) => col(c)[id]?.[k] };
      },
    }),
  },
  adminAuth: {},
}));
// The token is the email, so a request passed on (the WhatsApp send) is still the same person.
vi.mock('@/lib/karigar-auth', () => ({
  verifyRequestEmail: async (req: NextRequest) => (req.headers.get('authorization') || '').replace(/^Bearer /, '') || null,
}));
vi.mock('@/lib/roles', async (actual) => ({
  ...(await actual<typeof import('@/lib/roles')>()),
  roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : e === 'staff@example.com' ? 'staff' : e === 'mkt@example.com' ? 'marketing' : 'none'),
}));
vi.mock('@/lib/reports/monthly-server', () => ({ serverLogo: async () => null }));
const sent: { to: string; file: Blob; name: string; caption: string }[] = [];
vi.mock('@/lib/whatsapp', async (actual) => ({
  ...(await actual<typeof import('@/lib/whatsapp')>()),
  whatsAppProvider: () => 'waha',
  whatsAppNumberExists: async () => true,
  sendWhatsAppFile: async (to: string, file: Blob, name: string, caption: string) => { sent.push({ to, file, name, caption }); },
}));

const { GET: invoiceGET } = await import('./invoice/[id]/route');
const { GET: slipGET } = await import('./order-slip/[id]/route');
const { POST: whatsappPOST } = await import('./invoice/[id]/whatsapp/route');

const headers = (email: string | null): Record<string, string> => (email ? { authorization: `Bearer ${email}` } : {});

const getInvoice = async (id: string, email: string | null = 'owner@example.com', query = '') => {
  const res = await invoiceGET(new NextRequest(`https://erp.example.com/api/app/pdf/invoice/${encodeURIComponent(id)}${query}`, { headers: headers(email) }), { params: Promise.resolve({ id }) });
  return res;
};
const getSlip = async (id: string, email: string | null = 'owner@example.com') =>
  slipGET(new NextRequest(`https://erp.example.com/api/app/pdf/order-slip/${encodeURIComponent(id)}`, { headers: headers(email) }), { params: Promise.resolve({ id }) });

/** The PDF's text (jsPDF writes it uncompressed). */
const text = async (res: Response) => new TextDecoder('latin1').decode(await res.arrayBuffer());

const piece = (over: Record<string, unknown> = {}) => ({
  sku: 'R-0001', name: 'Test band', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 5,
  quantity: 1, unitPrice: 160_000, itemTotal: 160_000, metalCost: 150_000, wastageCost: 6_000, wastagePercentage: 4,
  makingCharges: 4_000, diamondChargesIfAny: 0, stoneChargesIfAny: 0, miscChargesIfAny: 0, adminNote: 'Owner only: bought back once',
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  sent.length = 0;
  col('customers')['CUS-1'] = { name: 'Test Buyer', phone: '+923001234567', address: '1 Example Street', email: 'buyer@example.com', adminNote: 'Owner only' };
  col('invoices')['INV-1'] = {
    customerId: 'CUS-1', customerName: 'Test Buyer', customerContact: '+923001234567',
    items: [piece()], subtotal: 160_000, discountAmount: 0, grandTotal: 160_000, amountPaid: 60_000, balanceDue: 100_000,
    // 01:30 on the 9th in the shop, still the 8th in UTC.
    createdAt: '2026-10-08T20:30:00.000Z', ratesApplied: { goldRatePerGram21k: 30_000 },
    paymentHistory: [{ amount: 60_000, date: '2026-10-08T20:31:00.000Z', method: 'Cash', notes: 'Payment received' }],
  };
  col('orders')['ORD-1'] = {
    createdAt: '2026-10-08T20:30:00.000Z', promisedDate: '2026-10-20', status: 'In Progress', customerName: 'Test Buyer',
    items: [{
      itemCategory: 'cat001', description: 'Test band', metalType: 'gold', karat: '21k', estimatedWeightG: 5, stoneWeightG: 0,
      hasStones: false, hasDiamonds: false, wastagePercentage: 10, makingCharges: 5_000, diamondCharges: 0, stoneCharges: 0,
      sampleGiven: false, isCompleted: false, totalEstimate: 170_000, metalCost: 150_000, wastageCost: 15_000,
      adminNote: 'Owner only: use the old stock', notes: 'Bench: polish twice',
    }],
    ratesApplied: { goldRatePerGram21k: 30_000 }, subtotal: 170_000, advancePayment: 20_000, grandTotal: 150_000,
  };
});

describe('/api/app/pdf/invoice/[id]', () => {
  it('the PDF Print saves, named for the customer, its day in Karachi', async () => {
    const res = await getInvoice('INV-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('content-disposition')).toBe(`inline; filename="Invoice - Test Buyer.pdf"; filename*=UTF-8''${encodeURIComponent('Invoice - Test Buyer.pdf')}`);
    const t = await text(res);
    expect(t.startsWith('%PDF')).toBe(true);
    expect(t).toContain('Estimate #: INV-1');
    expect(t).toContain('Date: 09/10/2026');
    expect(t).toContain('1 Example Street');
    expect(t).toContain('Oct 9, 2026');
    // An owner's copy: the rates and the line's metal, as the owner's browser prints them.
    expect(t).toContain('21k: 30,000/g');
    expect(t).toContain('Metal: PKR 150,000.00');
  });

  it("staff's is what their browser prints: no rates, no line's cost", async () => {
    const t = await text(await getInvoice('INV-1', 'staff@example.com'));
    expect(t).toContain('Estimate #: INV-1');
    expect(t).toContain('Test Buyer');
    expect(t).not.toContain('30,000/g');
    expect(t).not.toContain('Metal: PKR');
    expect(t).not.toContain('Owner only');
  });

  it('one invoice per piece when asked', async () => {
    col('invoices')['INV-1'].items = [piece(), piece({ sku: 'R-0002', name: 'Second band', unitPrice: 40_000, itemTotal: 40_000 })];
    col('invoices')['INV-1'].subtotal = 200_000;
    const res = await getInvoice('INV-1', 'owner@example.com', '?perPiece=1');
    expect(res.headers.get('content-disposition')).toContain('filename="Invoice - Test Buyer (per piece).pdf"');
    const t = await text(res);
    expect(t).toContain('Piece 1 of 2');
    expect(t).toContain('Piece 2 of 2');
  });

  it("a walk-in's carries its day, and needs no customer on file", async () => {
    col('invoices')['INV-1'] = { ...col('invoices')['INV-1'], customerId: '__WALK_IN__', customerName: 'Walk-in Customer' };
    const res = await getInvoice('INV-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('filename="Invoice - 9 Oct 2026.pdf"');
  });

  it('no such invoice, or not an id', async () => {
    expect((await getInvoice('INV-404')).status).toBe(404);
    expect((await getInvoice('../customers/CUS-1')).status).toBe(404);
  });

  it('owners and staff only', async () => {
    expect((await getInvoice('INV-1', null)).status).toBe(401);
    expect((await getInvoice('INV-1', 'mkt@example.com')).status).toBe(403);
    expect((await getInvoice('INV-1', 'karigar@example.com')).status).toBe(403);
    expect((await getInvoice('INV-1', 'staff@example.com')).status).toBe(200);
  });
});

describe('/api/app/pdf/order-slip/[id]', () => {
  it("the workshop slip, with the owner's notes and the rates for an owner", async () => {
    const res = await getSlip('ORD-1');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('filename="OrderSlip-ORD-1.pdf"');
    const t = await text(res);
    expect(t).toContain('Order ID: ORD-1');
    expect(t).toContain('Date: Oct 9, 2026');
    expect(t).toContain('Promised: Oct 20, 2026');
    // jsPDF escapes a bracket in its text.
    expect(t).toContain('Gold Rates \\(PKR\\): 21k: 30,000/g');
    expect(t).toContain('Owner only: use the old stock');
    expect(t).toContain('Bench: polish twice');
  });

  it("staff's: the bench notes, never the owner's, and no rates (their slip used to stop on them)", async () => {
    const res = await getSlip('ORD-1', 'staff@example.com');
    expect(res.status).toBe(200);
    const t = await text(res);
    expect(t).toContain('Bench: polish twice');
    expect(t).not.toContain('Owner only');
    expect(t).not.toContain('Gold Rates');
  });

  it('no such order; owners and staff only', async () => {
    expect((await getSlip('ORD-404')).status).toBe(404);
    expect((await getSlip('ORD-1', null)).status).toBe(401);
    expect((await getSlip('ORD-1', 'mkt@example.com')).status).toBe(403);
  });
});

describe('/api/app/pdf/invoice/[id]/whatsapp', () => {
  const post = (body: unknown, email: string | null = 'owner@example.com', id = 'INV-1') =>
    whatsappPOST(new NextRequest(`https://erp.example.com/api/app/pdf/invoice/${id}/whatsapp`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers(email) }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) });

  it("draws the PDF here and sends it through the browser's own send, which notes it on the invoice", async () => {
    const res = await post({ to: '0300 1234567' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, fileName: 'Invoice - Test Buyer.pdf', to: '+923001234567', by: 'owner@example.com' });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('923001234567');
    expect(sent[0].name).toBe('Invoice - Test Buyer.pdf');
    expect(sent[0].caption).toContain('Dear Test Buyer');
    const bytes = new Uint8Array(await sent[0].file.arrayBuffer());
    expect(new TextDecoder('latin1').decode(bytes.subarray(0, 4))).toBe('%PDF');
    expect(col('invoices')['INV-1'].sentOnWhatsApp).toMatchObject({ to: '+923001234567', by: 'owner@example.com' });
  });

  it("the send's own refusals come back as they are", async () => {
    const res = await post({ to: '123' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('WhatsApp number');
    expect(sent).toHaveLength(0);
  });

  it('no such invoice; owners and staff only', async () => {
    expect((await post({ to: '03001234567' }, 'owner@example.com', 'INV-404')).status).toBe(404);
    expect((await post({ to: '03001234567' }, null)).status).toBe(401);
    expect((await post({ to: '03001234567' }, 'mkt@example.com')).status).toBe(403);
    expect((await post({ to: '03001234567' }, 'staff@example.com')).status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});
