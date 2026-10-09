import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// An in-memory `drafts` collection behind the Admin SDK. All data made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: !!col(c)[id], data: () => col(c)[id] }),
        set: async (d: Record<string, unknown>) => { col(c)[id] = { ...d }; },
        delete: async () => { delete col(c)[id]; },
      }),
    }),
  },
}));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({
  roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : e === 'staff@example.com' ? 'staff' : e === 'mkt@example.com' ? 'marketing' : 'none'),
}));

const { POST } = await import('./route');

const call = async (body: unknown, email: string | null = 'owner@example.com') => {
  const res = await POST(new NextRequest('https://erp.example.com/api/app/drafts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(email ? { 'x-test-email': email } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

const order = {
  items: [{ description: 'Test band', metalType: 'gold', karat: '21k', estimatedWeightG: 5, wastagePercentage: 10, makingCharges: 0 }],
  customerName: 'Test Buyer', customerId: '__WALK_IN__', advancePayment: 20_000, goldRate21k: 30_000,
};

beforeEach(() => { for (const k of Object.keys(data)) delete data[k]; });

describe('/api/app/drafts', () => {
  it('keeps an order begun on the phone in Drafts, with its card worked out from the form', async () => {
    const r = await call({ action: 'save', id: 'order-mg1abcd2-x7k2p', kind: 'order', data: order, total: 150_000, device: 'iPhone', createdAt: '2026-10-09T01:00:00.000Z' });
    expect(r).toEqual({ status: 200, json: { ok: true, id: 'order-mg1abcd2-x7k2p' } });
    const saved = col('drafts')['order-mg1abcd2-x7k2p'];
    expect(saved).toMatchObject({
      kind: 'order', data: order, title: 'Test Buyer', items: 1, total: 150_000, device: 'iPhone', createdAt: '2026-10-09T01:00:00.000Z',
    });
    expect(saved.detail).toContain('Test band');
    expect(saved.detail).toContain('advance');
  });

  it('names a sale by the customer picked, else the name typed', async () => {
    await call({ action: 'save', id: 'sale-mg1abcd2-a1b2c', kind: 'sale', data: { cart: [{ sku: 'R-1', name: 'Ring' }], subtotal: 90_000, walkInCustomerName: '' }, customerName: 'Test Customer', total: 90_000 });
    expect(col('drafts')['sale-mg1abcd2-a1b2c']).toMatchObject({ kind: 'sale', title: 'Test Customer', items: 1, total: 90_000 });
  });

  it('says whether a draft is still there, and drops it', async () => {
    await call({ action: 'save', id: 'order-mg1abcd2-x7k2p', kind: 'order', data: order, total: 1 });
    expect((await call({ action: 'check', id: 'order-mg1abcd2-x7k2p' })).json).toEqual({ ok: true, exists: true });
    expect((await call({ action: 'drop', id: 'order-mg1abcd2-x7k2p' })).status).toBe(200);
    expect((await call({ action: 'check', id: 'order-mg1abcd2-x7k2p' })).json).toEqual({ ok: true, exists: false });
    // Dropping one that is gone already is fine: the counter finished it first.
    expect((await call({ action: 'drop', id: 'order-mg1abcd2-x7k2p' })).status).toBe(200);
  });

  it('refuses an id that is not a draft, or not of its kind, and touches nothing else', async () => {
    expect((await call({ action: 'save', id: 'orders/ORD-1', kind: 'order', data: order })).status).toBe(400);
    expect((await call({ action: 'save', id: 'sale-mg1abcd2-x7k2p', kind: 'order', data: order })).status).toBe(400);
    expect((await call({ action: 'drop', id: '../invoices/INV-1' })).status).toBe(400);
    expect((await call({ action: 'check', id: '' })).status).toBe(400);
    expect((await call({ action: 'save', id: 'order-mg1abcd2-x7k2p', kind: 'order', data: [1, 2] })).status).toBe(400);
    expect((await call({ action: 'nope', id: 'order-mg1abcd2-x7k2p' })).status).toBe(400);
    expect(col('drafts')).toEqual({});
  });

  it('owners and staff only', async () => {
    const body = { action: 'save', id: 'order-mg1abcd2-x7k2p', kind: 'order', data: order, total: 1 };
    expect((await call(body, null)).status).toBe(401);
    expect((await call(body, 'mkt@example.com')).status).toBe(403);
    expect((await call(body, 'stranger@example.com')).status).toBe(403);
    expect((await call(body, 'staff@example.com')).status).toBe(200);
  });

  it('leaves out photos too big to keep, and keeps the rest of the order', async () => {
    const photo = `data:image/jpeg;base64,${'A'.repeat(300_000)}`;
    const big = { ...order, items: Array.from({ length: 4 }, () => ({ ...order.items[0], sampleImageDataUri: photo })) };
    await call({ action: 'save', id: 'order-mg1abcd2-x7k2p', kind: 'order', data: big, total: 1 });
    const saved = col('drafts')['order-mg1abcd2-x7k2p'];
    expect(saved.leftOut).toEqual(['photos']);
    expect((saved.data as typeof big).items.map((i) => i.sampleImageDataUri)).toEqual(['', '', '', '']);
    expect((saved.data as typeof big).items[0].description).toBe('Test band');
  });

  it('never dates a draft in the future', async () => {
    await call({ action: 'save', id: 'order-mg1abcd2-x7k2p', kind: 'order', data: order, total: 1, createdAt: '2099-01-01T00:00:00.000Z' });
    expect(Date.parse(col('drafts')['order-mg1abcd2-x7k2p'].createdAt as string)).toBeLessThanOrEqual(Date.now());
  });
});
