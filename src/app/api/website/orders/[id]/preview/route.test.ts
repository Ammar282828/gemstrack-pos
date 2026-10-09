import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// One in-memory orders collection behind the Admin SDK. All data made up.
const docs: Record<string, Record<string, unknown>> = {};

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({ get: async () => ({ exists: !!docs[id], id, data: () => docs[id] }) }),
    }),
  },
}));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({
  roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : e === 'staff@example.com' ? 'staff' : 'none'),
}));

const { GET } = await import('./route');

const call = async (id: string, query: string, email: string | null = 'owner@example.com') => {
  const res = await GET(new NextRequest(`https://erp.example.com/api/website/orders/${id}/preview?${query}`, {
    headers: email ? { 'x-test-email': email } : {},
  }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

beforeEach(() => {
  for (const k of Object.keys(docs)) delete docs[k];
  docs['ORD-000901'] = {
    status: 'Pending', customerName: 'Sara Test', customerContact: '923000000001',
    subtotal: 100_000, advancePayment: 0, grandTotal: 100_000,
    website: { paymentStatus: 'slip_sent', deliveryCharge: 800, onlineId: 'ONL-TEST22', total: 100_800, token: 'tok-test' },
  };
  docs['ORD-000902'] = { status: 'Pending', customerName: 'Counter Sale', subtotal: 5_000 };
});

describe('GET /api/website/orders/:id/preview', () => {
  it('is for owners and staff, signed in', async () => {
    expect((await call('ORD-000901', 'action=lapse', null)).status).toBe(401);
    expect((await call('ORD-000901', 'action=lapse', 'someone@example.com')).status).toBe(403);
    expect((await call('ORD-000901', 'action=lapse', 'staff@example.com')).status).toBe(200);
  });

  it('says the thank-you and what Transfer received books', async () => {
    const r = await call('ORD-000901', 'action=transfer_received');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ move: 'transfer_received', ref: 'ONL-TEST22', to: '923000000001', booking: { advance: 100_000, deliveryRevenue: 800, total: 100_800 } });
    expect(String(r.body.text)).toContain('we have received your transfer for order ONL-TEST22');
  });

  it('says the lapse', async () => {
    const r = await call('ORD-000901', 'action=lapse');
    expect(String(r.body.text)).toContain('we did not receive the transfer for order ONL-TEST22');
  });

  it('refuses a paid one, a counter order, an unknown order and an unknown action', async () => {
    (docs['ORD-000901'].website as Record<string, unknown>).paymentStatus = 'transfer_received';
    expect((await call('ORD-000901', 'action=transfer_received')).status).toBe(409);
    expect((await call('ORD-000902', 'action=lapse')).status).toBe(409);
    expect((await call('ORD-404404', 'action=lapse')).status).toBe(404);
    expect((await call('ORD-000901', 'action=ship')).status).toBe(400);
  });
});
