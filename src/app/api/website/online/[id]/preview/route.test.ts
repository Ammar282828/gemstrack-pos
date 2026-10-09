import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// One in-memory online_orders collection behind the Admin SDK. All data made up.
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
  roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : e === 'staff@example.com' ? 'staff' : e === 'mkt@example.com' ? 'marketing' : 'none'),
}));

const { GET } = await import('./route');

const call = async (id: string, query: string, email: string | null = 'staff@example.com') => {
  const res = await GET(new NextRequest(`https://erp.example.com/api/website/online/${id}/preview?${query}`, {
    headers: email ? { 'x-test-email': email } : {},
  }), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

beforeEach(() => {
  for (const k of Object.keys(docs)) delete docs[k];
  docs['ONL-TEST22'] = {
    state: 'to_confirm', token: 'tok-test', placedAt: '2026-10-05T06:00:00Z',
    customer: { name: 'Sara Test', phone: '923000000001' },
    delivery: { address: '1 Test Street', city: 'Lahore' },
    lines: [{ key: 'rings/test-1', description: 'Test ring', price: 100_000, image: 'https://example.com/r.jpg' }],
    subtotal: 100_000, deliveryCharge: 0, grandTotal: 100_000,
    rates: {}, draft: { products: [], order: {} },
  };
});

describe('GET /api/website/online/:id/preview', () => {
  it('is for owners and staff, signed in', async () => {
    expect((await call('ONL-TEST22', 'action=confirm', null)).status).toBe(401);
    expect((await call('ONL-TEST22', 'action=confirm', 'mkt@example.com')).status).toBe(403);
    expect((await call('ONL-TEST22', 'action=confirm', 'owner@example.com')).status).toBe(200);
  });

  it('says the confirmation word for word, to whom, and when the hold would end', async () => {
    const r = await call('ONL-TEST22', 'action=confirm');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ move: 'confirm', ref: 'ONL-TEST22', name: 'Sara Test', to: '923000000001' });
    expect(String(r.body.text)).toContain('your order ONL-TEST22 is confirmed');
    expect(Date.parse(String(r.body.holdUntil))).toBeGreaterThan(Date.now());
  });

  it('says the decline with the reason, and asks for one', async () => {
    const r = await call('ONL-TEST22', `action=decline&reason=${encodeURIComponent('We cannot deliver to this city')}`);
    expect(r.status).toBe(200);
    expect(String(r.body.text)).toContain('We cannot deliver to this city');
    expect((await call('ONL-TEST22', 'action=decline&reason=no')).status).toBe(400);
  });

  it('refuses what the move would, an unknown order and an unknown action', async () => {
    docs['ONL-TEST22'].state = 'confirmed';
    expect((await call('ONL-TEST22', 'action=confirm')).status).toBe(409);
    expect((await call('ONL-NOPE22', 'action=confirm')).status).toBe(404);
    expect((await call('ONL-TEST22', 'action=hold')).status).toBe(400);
  });
});
