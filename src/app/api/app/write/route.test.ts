import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { DbPort, TxCtx } from '@/lib/db-port';

// One in-memory database behind both the Admin SDK (the route's own reads and writes) and the port
// (the shared writes). All data made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
let ids = 0;
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (id?: string) => {
        const key = id ?? `auto${++ids}`;
        return {
          id: key,
          get: async () => ({ exists: !!col(c)[key], data: () => col(c)[key] }),
          set: async (d: Record<string, unknown>, o?: { merge?: boolean }) => put(c, key, d, o?.merge),
          // Firestore's create: refused (ALREADY_EXISTS, code 6) when the document is there.
          create: async (d: Record<string, unknown>) => { if (col(c)[key]) throw Object.assign(new Error('exists'), { code: 6 }); put(c, key, d); },
          delete: async () => { delete col(c)[key]; },
        };
      },
      add: async (d: Record<string, unknown>) => { const id = `auto${++ids}`; put(c, id, d); return { id }; },
      get: async () => ({ docs: Object.entries(col(c)).map(([id, d]) => ({ id, data: () => d })) }),
      select: () => ({ get: async () => ({ docs: Object.keys(col(c)).map((id) => ({ id, data: () => ({}) })) }) }),
    }),
  },
}));

const port: DbPort = {
  async runTransaction(fn) {
    const writes: (() => void)[] = [];
    const tx: TxCtx = {
      async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    return out;
  },
  async queryEquals(c, field, value) { return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never); },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add(c, d) { const id = `auto${++ids}`; put(c, id, d); return id; },
  async update(c, id, d) { put(c, id, d, true); },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      async commit() { writes.forEach((w) => w()); },
    };
  },
  newId() { return `auto${++ids}`; },
  timestamp: (d) => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({
  roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : e === 'staff@example.com' ? 'staff' : e === 'mkt@example.com' ? 'marketing' : 'none'),
}));
vi.mock('@/lib/people', () => ({ personFor: () => undefined }));

const { POST } = await import('./route');

const call = async (body: unknown, email: string | null = 'owner@example.com') => {
  const res = await POST(new NextRequest('https://erp.example.com/api/app/write', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(email ? { 'x-test-email': email } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> & { followUps?: { path: string; body: Record<string, unknown> }[] } };
};

const RING = {
  sku: 'RNG-T1', name: 'Demo ring', categoryId: 'Ring', metalType: 'gold', karat: '21k', metalWeightG: 4, stoneWeightG: 0,
  wastagePercentage: 10, makingCharges: 5_000, hasDiamonds: false, hasStones: false, diamondCharges: 0, stoneCharges: 0, miscCharges: 0,
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  ids = 0;
  put('app_settings', 'global', { lastInvoiceNumber: 1, goldRatePerGram21k: 30_000 });
  put('invoices', 'INV-000001', { grandTotal: 100_000, amountPaid: 0, balanceDue: 100_000, customerId: 'c1', customerName: 'Demo One', paymentHistory: [] });
  put('orders', 'ORD-000001', { status: 'In Progress', subtotal: 50_000, advancePayment: 0, items: [{ description: 'A', isCompleted: false }, { description: 'B', isCompleted: true }] });
  put('orders', 'ORD-000002', { status: 'Completed', invoiceId: 'INV-000001', subtotal: 1, items: [{ description: 'A' }] });
  put('products', 'RNG-T1', RING);
});

const OPS = ['recordPayment', 'recordOrderAdvance', 'setOrderStatus', 'setPieceDone', 'setPieceKarigar', 'setPieceGiven', 'addCustomer',
  'setRates', 'createInvoice', 'createOrder', 'addRepair', 'setRepairStatus', 'recordRepairPayment', 'addExpense', 'addGivenItem', 'markGivenReturned', 'updateSettings', 'updateOrder',
  'updateCustomer', 'addKarigar', 'updateKarigar', 'finalizeOrder', 'addProduct', 'updateProduct',
  'setInvoiceCustomer', 'saveOverheadPlan', 'addShareholderEntry', 'deleteShareholderEntry', 'deletePartnerSalary',
  'setWorkingCapitalFloor', 'restoreRemoved', 'purgeRemoved'];
const STAFF_MAY = ['recordPayment', 'setOrderStatus', 'addCustomer', 'createOrder'];

describe('who may write', () => {
  it('nobody signed in gets nothing', async () => {
    expect((await call({ op: 'addCustomer', name: 'x' }, null)).status).toBe(401);
  });

  it('marketing and anyone not on the lists are refused every operation', async () => {
    for (const op of OPS) {
      expect((await call({ op }, 'mkt@example.com')).status, op).toBe(403);
      expect((await call({ op }, 'stranger@example.com')).status, op).toBe(403);
    }
  });

  it('staff may do only what the browser lets the shop floor do', async () => {
    for (const op of OPS) {
      const { status } = await call({ op }, 'staff@example.com');
      if (STAFF_MAY.includes(op)) expect(status, op).not.toBe(403);
      else expect(status, op).toBe(403);
    }
  });

  it('an unknown operation, or a body that is not JSON, is refused', async () => {
    expect((await call({ op: 'deleteEverything' })).status).toBe(400);
    expect((await call('not json')).status).toBe(400);
  });

  it("the owner's lock stops every write, from everyone", async () => {
    put('app_settings', 'global', { databaseLocked: true }, true);
    for (const op of OPS) expect((await call({ op }, 'owner@example.com')).status, op).toBe(423);
    expect(data.invoices['INV-000001'].amountPaid).toBe(0);
  });
});

describe('money', () => {
  it('a payment must be a positive number', async () => {
    for (const amount of [0, -5, 'abc', null, Number.NaN, '']) {
      expect((await call({ op: 'recordPayment', invoiceId: 'INV-000001', amount })).status, String(amount)).toBe(400);
    }
    expect(data.invoices['INV-000001'].amountPaid).toBe(0);
  });

  it('a payment lands, and names its alert for the app to send', async () => {
    const r = await call({ op: 'recordPayment', invoiceId: 'INV-000001', amount: 40_000, method: 'Cash', date: '2026-10-08T10:00:00.000Z' });
    expect(r.status).toBe(200);
    expect(data.invoices['INV-000001']).toMatchObject({ amountPaid: 40_000, balanceDue: 60_000 });
    expect(r.body.followUps).toEqual([{ path: '/api/notifications/alert', body: { event: 'payment', id: 'INV-000001', payment: { amount: 40_000, date: '2026-10-08T10:00:00.000Z' } } }]);
  });

  it('a payment on an invoice that is not there says so', async () => {
    expect((await call({ op: 'recordPayment', invoiceId: 'INV-999999', amount: 1 })).status).toBe(409);
  });

  it('an advance on an invoiced order is refused; one on an open order lands', async () => {
    expect((await call({ op: 'recordOrderAdvance', orderId: 'ORD-000002', amount: 5_000 })).status).toBe(409);
    expect((await call({ op: 'recordOrderAdvance', orderId: 'ORD-000001', amount: 0 })).status).toBe(400);
    const r = await call({ op: 'recordOrderAdvance', orderId: 'ORD-000001', amount: 5_000, method: 'Card' });
    expect(r.status).toBe(200);
    expect(data.orders['ORD-000001']).toMatchObject({ advancePayment: 5_000, grandTotal: 45_000 });
  });
});

describe('orders', () => {
  it('never a bare Refunded, never a made-up status', async () => {
    expect((await call({ op: 'setOrderStatus', orderId: 'ORD-000001', status: 'Refunded' })).status).toBe(400);
    expect((await call({ op: 'setOrderStatus', orderId: 'ORD-000001', status: 'Shipped' })).status).toBe(400);
    expect(data.orders['ORD-000001'].status).toBe('In Progress');
  });

  it('cancelling raises the alert and drops the Shopify draft; a plain move raises nothing', async () => {
    const plain = await call({ op: 'setOrderStatus', orderId: 'ORD-000001', status: 'Pending' });
    expect(plain.body.followUps).toEqual([]);
    const cancelled = await call({ op: 'setOrderStatus', orderId: 'ORD-000001', status: 'Cancelled' });
    expect(cancelled.body.followUps!.map((f) => f.path)).toEqual(['/api/notifications/alert', '/api/shopify/sync/order']);
  });

  it('the last piece ticked finishes the order and raises its alert; a piece that is not there is refused', async () => {
    expect((await call({ op: 'setPieceDone', orderId: 'ORD-000001', index: 7, done: true })).status).toBe(409);
    expect((await call({ op: 'setPieceDone', orderId: 'ORD-000001', index: 1.5, done: true })).status).toBe(400);
    const r = await call({ op: 'setPieceDone', orderId: 'ORD-000001', index: 0, done: true });
    expect(r.body.status).toBe('Completed');
    expect(r.body.followUps).toEqual([{ path: '/api/notifications/alert', body: { event: 'order-status', id: 'ORD-000001', status: 'Completed' } }]);
  });
});

describe('editing an order from the phone', () => {
  const editOf = (order: Record<string, unknown>) => ({ op: 'updateOrder', orderId: 'ORD-000001', order });
  const pieces = [
    { editIndex: 0, description: 'A, resized', karigarId: null },
    { editIndex: 1, description: 'B' },
  ];

  it('owners only; needs pieces and an order that is there', async () => {
    expect((await call(editOf({ items: pieces }), 'staff@example.com')).status).toBe(403);
    expect((await call(editOf({ items: [] }))).status).toBe(400);
    expect((await call({ op: 'updateOrder', orderId: 'ORD-404', order: { items: pieces } })).status).toBe(404);
    expect((await call(editOf({ items: pieces, grandTotal: -5 }))).status).toBe(400);
  });

  it("lays the form's fields over each stored piece, keeps what the form does not show, and ignores unknown fields", async () => {
    put('orders', 'ORD-000001', { items: [{ description: 'A', isCompleted: false, karigarId: 'KAR-1', samplePhotoId: 'photo-1' }, { description: 'B', isCompleted: true, givenAt: '2026-10-01' }] }, true);
    const r = await call(editOf({ items: pieces, customerName: 'Demo Two', grandTotal: 40_000, invoiceId: 'INV-X', status: 'Completed', promisedDate: null }));
    expect(r.status).toBe(200);
    const o = data.orders['ORD-000001'];
    expect(o.items).toEqual([
      { description: 'A, resized', isCompleted: false, samplePhotoId: 'photo-1' },
      { description: 'B', isCompleted: true, givenAt: '2026-10-01' },
    ]);
    expect(o.customerName).toBe('Demo Two');
    expect(o.grandTotal).toBe(40_000);
    // Not the form's to set: an invoice link or a bare status.
    expect(o.invoiceId).toBeUndefined();
    expect(o.status).toBe('In Progress');
    expect(o.promisedDate).toBeNull();
  });

  it('more advance than before is money taken today, listed with its method', async () => {
    const r = await call(editOf({ items: pieces, advancePayment: 10_000, advanceMethod: 'Bank Transfer' }));
    expect(r.status).toBe(200);
    const advances = data.orders['ORD-000001'].advances as { amount: number; method?: string; notes?: string }[];
    expect(advances).toHaveLength(1);
    expect(advances[0]).toMatchObject({ amount: 10_000, method: 'Bank Transfer', notes: 'Added in the order form' });
  });

  it('every piece finished completes the order and raises its alert', async () => {
    const r = await call(editOf({ items: [{ editIndex: 0, description: 'A', isCompleted: true }, { editIndex: 1, description: 'B' }] }));
    expect(data.orders['ORD-000001'].status).toBe('Completed');
    expect(r.body.followUps).toEqual([{ path: '/api/notifications/alert', body: { event: 'order-status', id: 'ORD-000001', status: 'Completed' } }]);
  });

  it('a new picture replaces the old one, filed in order_photos', async () => {
    put('orders', 'ORD-000001', { items: [{ description: 'A', samplePhotoId: 'photo-old' }] }, true);
    await call(editOf({ items: [{ editIndex: 0, description: 'A', sampleImageDataUri: 'data:image/jpeg;base64,AAAA' }] }));
    const item = (data.orders['ORD-000001'].items as Record<string, unknown>[])[0];
    expect(item.samplePhotoId).not.toBe('photo-old');
    expect(item.sampleImageDataUri).toBeUndefined();
    expect(data.order_photos[item.samplePhotoId as string]).toMatchObject({ orderId: 'ORD-000001' });
  });
});

describe('finalizing an order from the phone', () => {
  const ORDER = {
    status: 'In Progress', customerId: 'c1', customerName: 'Demo One', createdAt: '2026-10-01T10:00:00.000Z',
    ratesApplied: { goldRatePerGram21k: 20_000 }, advancePayment: 30_000,
    advances: [{ amount: 30_000, date: '2026-10-01T10:00:00.000Z', method: 'Cash' }],
    items: [{ description: 'Demo ring', metalType: 'gold', karat: '21k', estimatedWeightG: 5, stoneWeightG: 0, wastagePercentage: 10, makingCharges: 2_000 }],
  };
  const fin = (extra: Record<string, unknown> = {}) => ({
    op: 'finalizeOrder', orderId: 'ORD-000003',
    items: [{ description: 'Demo ring', metalType: 'gold', karat: '21k', finalWeightG: 5.5, finalWastagePercentage: 10, finalMakingCharges: 2_000, finalDiamondCharges: 0, finalStoneCharges: 0 }],
    additionalDiscount: 1_000, ...extra,
  });

  it('owners only; figures checked; the pieces must match the order', async () => {
    put('orders', 'ORD-000003', ORDER);
    expect((await call(fin(), 'staff@example.com')).status).toBe(403);
    expect((await call(fin({ items: [] }))).status).toBe(400);
    expect((await call(fin({ additionalDiscount: -5 }))).status).toBe(400);
    expect((await call(fin({ items: [{ finalWeightG: 0 }] }))).status).toBe(400);
    expect((await call(fin({ items: [{ finalWeightG: 1 }, { finalWeightG: 1 }] }))).status).toBe(409);
    expect(data.orders['ORD-000003'].invoiceId).toBeUndefined();
  });

  it('prices at the booked rate and the typed figures, carries the advance as a payment, and links the order', async () => {
    put('orders', 'ORD-000003', ORDER);
    const r = await call(fin());
    expect(r.status).toBe(200);
    const inv = r.body.invoice as Record<string, unknown>;
    // 5.5 g at 20,000 = 110,000; wastage 10% = 11,000; making 2,000.
    expect(inv.subtotal).toBe(123_000);
    expect(inv.grandTotal).toBe(122_000);
    expect(inv.amountPaid).toBe(30_000);
    expect(inv.balanceDue).toBe(92_000);
    expect(inv.id).toBe('INV-000002');
    expect(data.orders['ORD-000003']).toMatchObject({ status: 'Completed', invoiceId: 'INV-000002', grandTotal: 92_000 });
    expect((data.app_settings.global as { lastInvoiceNumber: number }).lastInvoiceNumber).toBe(2);
    expect(Object.values(data.hisaab ?? {})).toEqual([expect.objectContaining({ linkedInvoiceId: 'INV-000002', cashDebit: 92_000 })]);
    // Twice is refused: undoing an invoice is the delete code's.
    expect((await call(fin())).status).toBe(409);
  });
});

describe('a new sale from the phone', () => {
  const sale = (over: Record<string, unknown> = {}) => ({ op: 'createInvoice', cart: [RING], customer: { name: 'Walk-in Customer' }, rates: { goldRatePerGram21k: 30_000 }, discountAmount: 0, ...over });

  it('is numbered, prices the piece itself, moves it to sold, and names the sale alert', async () => {
    const r = await call(sale({ payments: [{ amount: 137_000, method: 'Cash' }] }));
    expect(r.status).toBe(200);
    expect(r.body.invoice).toMatchObject({ id: 'INV-000002', grandTotal: 137_000, balanceDue: 0 });
    expect(data.products['RNG-T1']).toBeUndefined();
    expect(data.sold_products['RNG-T1']).toBeDefined();
    expect(r.body.followUps).toEqual([{ path: '/api/notifications/alert', body: { event: 'sale', id: (r.body.invoice as { id: string }).id } }]);
  });

  it('a piece sold meanwhile is refused by name, and nothing is written', async () => {
    delete data.products['RNG-T1'];
    const r = await call(sale());
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toContain('RNG-T1');
    expect(data.app_settings.global.lastInvoiceNumber).toBe(1);
  });

  it('a piece described at the counter (never stock) sells, once', async () => {
    const oneOff = { ...RING, sku: 'NEW-T9', name: 'Demo one-off ring' };
    const r = await call(sale({ cart: [oneOff] }));
    expect(r.status).toBe(200);
    expect(data.sold_products['NEW-T9']).toBeDefined();
    // The same save again (a dropped line, a second tap) is not a second sale.
    const again = await call(sale({ cart: [oneOff] }));
    expect(again.status).toBe(409);
    expect(String(again.body.error)).toContain('Demo one-off ring (already sold)');
  });

  it('a made-up SKU that is not a one-off is still refused', async () => {
    const r = await call(sale({ cart: [{ ...RING, sku: 'FAKE-1' }] }));
    expect(r.status).toBe(409);
  });

  it('a stale counter is refused rather than writing over an invoice', async () => {
    put('app_settings', 'global', { lastInvoiceNumber: 0 }, true);
    const r = await call(sale());
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toMatch(/already exists/);
    expect(data.invoices['INV-000001'].grandTotal).toBe(100_000);
  });

  it('no pieces, an edit, or a walk-in paying past the total is refused', async () => {
    expect((await call(sale({ cart: [] }))).status).toBe(400);
    expect((await call(sale({ existingInvoiceId: 'INV-404' }))).status).toBe(404);
    expect((await call(sale({ payments: [{ amount: 999_999 }] }))).status).toBe(409);
    expect(data.products['RNG-T1']).toBeDefined();
  });
});

describe('editing an invoice from the phone', () => {
  it("keeps its number, its date and its payments; its own pieces pass, another sold piece does not", async () => {
    put('invoices', 'INV-000001', {
      items: [{ sku: 'RNG-T1', name: 'Demo ring', unitPrice: 137_000, itemTotal: 137_000, quantity: 1 }],
      grandTotal: 137_000, amountPaid: 10_000, balanceDue: 127_000, createdAt: '2026-10-01T10:00:00.000Z',
      customerId: 'c1', customerName: 'Demo One', paymentHistory: [{ amount: 10_000, date: '2026-10-01T10:00:00.000Z' }],
    });
    // The ring is the invoice's: sold, out of stock.
    put('sold_products', 'RNG-T1', RING);
    delete data.products['RNG-T1'];
    const edit = (extra: Record<string, unknown>) => ({
      op: 'createInvoice', existingInvoiceId: 'INV-000001', cart: [{ ...RING }],
      customer: { id: 'c1', name: 'Demo One' }, rates: { goldRatePerGram21k: 30_000 }, ...extra,
    });
    const r = await call(edit({ discountAmount: 2_000 }));
    expect(r.status).toBe(200);
    const inv = data.invoices['INV-000001'];
    expect(inv.createdAt).toBe('2026-10-01T10:00:00.000Z');
    expect(inv.amountPaid).toBe(10_000);
    expect(inv.discountAmount).toBe(2_000);
    expect((data.app_settings.global as { lastInvoiceNumber: number }).lastInvoiceNumber).toBe(1);
    // A piece sold to someone else meanwhile is still refused by name.
    put('sold_products', 'RNG-T2', { ...RING, sku: 'RNG-T2' });
    const other = await call(edit({ cart: [{ ...RING }, { ...RING, sku: 'RNG-T2' }] }));
    expect(other.status).toBe(409);
    expect(String(other.body.error)).toContain('RNG-T2');
  });
});

describe('the rest of the book', () => {
  it('a customer needs a name, and only the fields the browser writes are kept', async () => {
    expect((await call({ op: 'addCustomer', name: '   ' })).status).toBe(400);
    const r = await call({ op: 'addCustomer', name: 'Demo New', phone: '0300 0000099', balance: 1_000_000, role: 'owner' });
    const c = r.body.customer as Record<string, unknown>;
    expect(Object.keys(c).sort()).toEqual(['address', 'email', 'id', 'name', 'phone']);
    expect(data.customers[c.id as string]).not.toHaveProperty('balance');
  });

  it('rates: nonsense is dropped, unchanged is a confirmation, and who set them is recorded', async () => {
    const r = await call({ op: 'setRates', rates: { goldRatePerGram21k: '31000', goldRatePerGram24k: -5, silverRatePerGram: 'abc' } });
    expect(r.body.moved).toEqual(['goldRatePerGram21k']);
    expect(data.app_settings.global).toMatchObject({ goldRatePerGram21k: 31_000, ratesUpdatedBy: 'owner@example.com' });
    expect(data.app_settings.global).not.toHaveProperty('goldRatePerGram24k');
    const again = await call({ op: 'setRates', rates: {} });
    expect(again.body.moved).toEqual([]);
  });

  it('a repair needs a piece; an expense needs a description and an amount; a given item needs whom', async () => {
    expect((await call({ op: 'addRepair', repair: { customerName: 'x', pieces: [{ item: '' }] } })).status).toBe(400);
    expect((await call({ op: 'addExpense', description: 'x', amount: 0 })).status).toBe(400);
    expect((await call({ op: 'addExpense', description: '', amount: 10 })).status).toBe(400);
    expect((await call({ op: 'addGivenItem', description: 'Sample', recipientName: 'K', recipientType: 'stranger' })).status).toBe(400);
    const e = await call({ op: 'addExpense', description: 'Demo tea', amount: 500, paidBy: 'someone-else' });
    expect(e.status).toBe(200);
    expect((e.body.expense as Record<string, unknown>).paidBy).toBeUndefined();
  });

  it('every follow-up the app is told to send is one of the ERP\'s own routes', async () => {
    const r = await call({ op: 'setOrderStatus', orderId: 'ORD-000001', status: 'Cancelled' });
    for (const f of r.body.followUps!) expect(f.path.startsWith('/api/')).toBe(true);
  });
});

describe('the same change sent twice', () => {
  it('records a payment once: a double tap, or a retry after the line dropped, is refused', async () => {
    const pay = { op: 'recordPayment', invoiceId: 'INV-000001', amount: 40_000, method: 'Cash', requestId: 'req-demo-0001' };
    const first = await call(pay);
    expect(first.status).toBe(200);
    const again = await call(pay);
    expect(again.status).toBe(409);
    expect(again.body.duplicate).toBe(true);
    expect((data.invoices['INV-000001'].paymentHistory as unknown[]).length).toBe(1);
    expect(data.invoices['INV-000001'].amountPaid).toBe(40_000);
  });

  it('a refused change gives its name back, so the corrected one goes through', async () => {
    const bad = await call({ op: 'recordPayment', invoiceId: 'INV-000001', amount: 0, requestId: 'req-demo-0002' });
    expect(bad.status).toBe(400);
    expect(data.app_requests?.['req-demo-0002']).toBeUndefined();
    const good = await call({ op: 'recordPayment', invoiceId: 'INV-000001', amount: 5_000, requestId: 'req-demo-0002' });
    expect(good.status).toBe(200);
  });

  it('an order sent twice is one order', async () => {
    const order = { op: 'createOrder', requestId: 'req-demo-0003', order: { items: [{ description: 'Demo ring', metalType: 'gold', karat: '21k', estimatedWeightG: 4 }], subtotal: 1, grandTotal: 1, customerName: 'Walk-in Customer' } };
    put('app_settings', 'global', { lastOrderNumber: 2 }, true);
    expect((await call(order)).status).toBe(200);
    expect((await call(order)).status).toBe(409);
    expect(Object.keys(data.orders).filter((k) => k.startsWith('ORD-0000')).length).toBe(3);
  });

  it('a request name that is not one is ignored, never trusted as a key', async () => {
    const r = await call({ op: 'recordPayment', invoiceId: 'INV-000001', amount: 1_000, requestId: '../settings/global' });
    expect(r.status).toBe(200);
    expect(data.app_requests).toBeUndefined();
  });
});

describe('the hisaab put right, repairs numbered past what is held, sizes to the profile', () => {
  it('syncHisaab books what an invoice owes, drops what it no longer does, and owners only', async () => {
    put('hisaab', 'stale', { linkedInvoiceId: 'INV-000001', description: 'Outstanding balance for Invoice INV-000001', cashDebit: 1, cashCredit: 0 });
    put('hisaab', 'orphan', { linkedInvoiceId: 'INV-GONE', description: 'Outstanding balance for Invoice INV-GONE', cashDebit: 5 });
    put('hisaab', 'typed', { description: 'Typed by hand', cashDebit: 7 });
    expect((await call({ op: 'syncHisaab' }, 'staff@example.com')).status).toBe(403);
    const r = await call({ op: 'syncHisaab' });
    expect(r.status).toBe(200);
    expect(data.hisaab.stale).toMatchObject({ cashDebit: 100_000, cashCredit: 0 });
    expect(data.hisaab.orphan).toBeUndefined();
    expect(data.hisaab.typed).toBeDefined();
    // Once every two minutes at most: each reads every invoice.
    expect((await call({ op: 'syncHisaab' })).body.skipped).toBe(true);
  });

  it('a repair takes the number after the highest held, whatever the counter says', async () => {
    put('repairs', 'REP-000041', { item: 'Demo' });
    put('app_settings', 'global', { lastRepairNumber: 3 }, true);
    const r = await call({ op: 'addRepair', repair: { pieces: [{ item: 'Demo chain', work: 'Solder' }], customerName: '  ' } });
    expect(r.status).toBe(200);
    expect((r.body.repair as { id: string }).id).toBe('REP-000042');
    // Blank stays blank, as the browser saves it.
    expect((r.body.repair as { customerName?: string }).customerName ?? '').toBe('');
  });

  it('setCustomerSizes keeps only the profile sizes, for a customer who exists', async () => {
    put('customers', 'c1', { name: 'Demo One' });
    const r = await call({ op: 'setCustomerSizes', customerId: 'c1', sizes: { ringSize: '14', bangleSize: ' ', name: 'Hacked' } }, 'staff@example.com');
    expect(r.status).toBe(200);
    expect(data.customers.c1).toEqual({ name: 'Demo One', ringSize: '14' });
    expect((await call({ op: 'setCustomerSizes', customerId: 'nobody', sizes: { ringSize: '9' } })).status).toBe(409);
  });
});

describe('a partner\'s salary', () => {
  it('names the partner only on a Partner Salary, and only a real partner', async () => {
    const pay = (over: Record<string, unknown>) => call({ op: 'addExpense', description: 'Demo salary', amount: 50_000, ...over });
    const a = await pay({ category: 'Partner Salary', shareholderId: 'mina', paidBy: 'business' });
    expect((a.body.expense as { shareholderId?: string }).shareholderId).toBe('mina');
    const b = await pay({ category: 'Rent', shareholderId: 'mina' });
    expect((b.body.expense as { shareholderId?: string }).shareholderId).toBeUndefined();
    const c = await pay({ category: 'Partner Salary', shareholderId: 'someone' });
    expect((c.body.expense as { shareholderId?: string }).shareholderId).toBeUndefined();
  });
});

describe('the shop\'s settings from the phone', () => {
  const patch = (p: Record<string, unknown>, email = 'owner@example.com') => call({ op: 'updateSettings', patch: p }, email);

  it('an owner changes the whitelisted fields, merged, and the log names them without their values', async () => {
    const r = await patch({
      shopName: '  Demo Jewellers ', shopAddress: '1 Example Road', shopContact: '0300 0000000', theme: 'default', uiStyle: 'glass',
      autoDraftForms: false, notifEnabled: true, notifNewInvoice: true, notifDailyReportTime: '21:30',
      notifPhones: ['+92 300 0000001', 923000000001, '923000000002'],
      paymentMethods: [{ id: 'pm-1', bankName: ' Demo Bank ', accountName: 'Demo Jewellers', accountNumber: '0000-1', iban: '' }, { id: 'pm-2', bankName: 'B', accountName: 'N', accountNumber: '2', iban: 'PK00DEMO' }],
    });
    expect(r.status).toBe(200);
    expect(data.app_settings.global).toMatchObject({
      lastInvoiceNumber: 1, goldRatePerGram21k: 30_000,
      shopName: 'Demo Jewellers', shopAddress: '1 Example Road', theme: 'default', uiStyle: 'glass', autoDraftForms: false,
      notifEnabled: true, notifNewInvoice: true, notifDailyReportTime: '21:30',
      notifPhones: ['923000000001', '923000000002'],
      paymentMethods: [{ id: 'pm-1', bankName: 'Demo Bank', accountName: 'Demo Jewellers', accountNumber: '0000-1' }, { id: 'pm-2', bankName: 'B', accountName: 'N', accountNumber: '2', iban: 'PK00DEMO' }],
    });
    expect((data.app_settings.global.paymentMethods as Record<string, unknown>[])[0]).not.toHaveProperty('iban');
    const entry = Object.values(data.activity_log).find((e) => e.action === 'settings.update');
    expect(entry).toMatchObject({ by: 'owner@example.com', via: 'iphone-app' });
    expect(JSON.stringify(entry)).not.toContain('0000-1');
    expect(JSON.stringify(entry)).not.toContain('923000000001');
  });

  it('staff, marketing and strangers are refused, and nothing changes', async () => {
    for (const who of ['staff@example.com', 'mkt@example.com', 'stranger@example.com']) {
      expect((await patch({ shopName: 'Hacked' }, who)).status, who).toBe(403);
    }
    expect(data.app_settings.global).not.toHaveProperty('shopName');
  });

  it('drops what is not on the list: rates, the lock, counters, tokens, anything unknown', async () => {
    const r = await patch({
      shopName: 'Demo', goldRatePerGram21k: 1, silverRatePerGram: 1, databaseLocked: true, lastInvoiceNumber: 0, lastOrderNumber: 0,
      lastRepairNumber: 0, shopifyAccessToken: 'x', deleteCode: '1234', firebaseConfig: { apiKey: 'x' }, allowedDeviceIds: ['d'], ratesUpdatedAt: 'now', somethingNew: 1,
    });
    expect(r.status).toBe(200);
    expect(r.body.changed).toEqual(['shopName']);
    expect(data.app_settings.global).toEqual({ lastInvoiceNumber: 1, goldRatePerGram21k: 30_000, shopName: 'Demo' });
  });

  it('a patch with nothing allowed in it is refused', async () => {
    for (const p of [{ databaseLocked: true }, { lastInvoiceNumber: 5 }, {}, null, 'shopName', ['shopName']]) {
      expect((await call({ op: 'updateSettings', patch: p })).status, JSON.stringify(p)).toBe(400);
    }
    expect((await call({ op: 'updateSettings' })).status).toBe(400);
    expect(data.app_settings.global).toEqual({ lastInvoiceNumber: 1, goldRatePerGram21k: 30_000 });
  });

  it('wrong types are refused whole, not half-saved', async () => {
    const bad: Record<string, unknown>[] = [
      { shopName: '' }, { shopName: '   ' }, { shopName: 5 }, { shopName: 'x'.repeat(81) }, { shopAddress: 'x'.repeat(301) }, { shopContact: {} },
      { theme: 'forest' }, { uiStyle: 'neon' },
      { autoDraftForms: 'yes' }, { notifEnabled: 1 }, { notifNewOrder: null },
      { notifDailyReportTime: '25:00' }, { notifEndOfDayTime: '9:00' }, { notifDailyChecklistTime: 900 },
      { notifPhones: 'x' }, { notifPhones: ['123'] }, { notifPhones: ['1'.repeat(16)] }, { notifPhones: [null] }, { notifPhones: Array.from({ length: 21 }, (_, i) => `92300000${1000 + i}`) },
      { paymentMethods: {} }, { paymentMethods: [null] }, { paymentMethods: [{ id: 'a', bankName: 'B', accountName: '', accountNumber: '1' }] },
      { paymentMethods: [{ id: 'a b', bankName: 'B', accountName: 'N', accountNumber: '1' }] },
      { paymentMethods: [{ bankName: 'B', accountName: 'N', accountNumber: '1' }] },
      { paymentMethods: [{ id: 'a', bankName: 'B', accountName: 'N', accountNumber: '1' }, { id: 'a', bankName: 'B', accountName: 'N', accountNumber: '2' }] },
      { paymentMethods: [{ id: 'a', bankName: 'B', accountName: 'N', accountNumber: 12345 }] },
    ];
    for (const b of bad) {
      expect((await patch({ shopAddress: 'ok', ...b })).status, JSON.stringify(b)).toBe(400);
    }
    expect(data.app_settings.global).toEqual({ lastInvoiceNumber: 1, goldRatePerGram21k: 30_000 });
  });

  it('removing every bank account and every number is allowed', async () => {
    put('app_settings', 'global', { paymentMethods: [{ id: 'pm-1' }], notifPhones: ['923000000001'] }, true);
    expect((await patch({ paymentMethods: [], notifPhones: [] })).status).toBe(200);
    expect(data.app_settings.global).toMatchObject({ paymentMethods: [], notifPhones: [] });
  });

  it('the owner\'s lock stops it', async () => {
    put('app_settings', 'global', { databaseLocked: true }, true);
    expect((await patch({ shopName: 'Demo' })).status).toBe(423);
    expect(data.app_settings.global).not.toHaveProperty('shopName');
  });
});
