import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { fakeFirestore } from '@/lib/agent/fake-firestore';
import type { DbPort, TxCtx } from '@/lib/db-port';

const fake = fakeFirestore();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: fake.db, adminAuth: {} }));
vi.mock('firebase-admin', () => ({ default: { firestore: { FieldValue: { serverTimestamp: () => 'now' } } } }));
const port: DbPort = {
  async runTransaction(fn) {
    const writes: (() => void)[] = [];
    const tx: TxCtx = {
      async get(c, id) { const d = fake.col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
      set(c, id, d, merge) { writes.push(() => { fake.col(c)[id] = merge ? { ...fake.col(c)[id], ...d } : { ...d }; }); },
      update(c, id, d) { writes.push(() => { fake.col(c)[id] = { ...fake.col(c)[id], ...d }; }); },
      delete(c, id) { writes.push(() => { delete fake.col(c)[id]; }); },
    };
    const out = await fn(tx);
    writes.forEach(w => w());
    return out;
  },
  async queryEquals() { return []; }, async get() { return null; }, async add() { return 'x'; }, async update() { /* unused */ },
  batch() { throw new Error('unused'); }, newId: () => 'n', timestamp: d => d.toISOString(), serverTime: () => 'now',
};
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string | null) => (e === 'staff@example.com' ? 'staff' : 'none') }));

const { POST } = await import('./route');
const call = async (body: unknown) => {
  const res = await POST(new NextRequest('https://erp.example.com/api/staff/write', { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-email': 'staff@example.com' }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

beforeEach(() => {
  fake.reset();
  fake.col('orders')['O-INV'] = { status: 'Completed', invoiceId: 'INV-1', items: [] };
  fake.col('orders')['O-X'] = { status: 'Cancelled', items: [] };
});

describe('/api/staff/write updateOrderStatus', () => {
  it('answers a refused move as 409 JSON with the machine, from, to and allowed', async () => {
    const r = await call({ op: 'updateOrderStatus', orderId: 'O-INV', status: 'Pending' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: expect.stringMatching(/undo the invoice first/), machine: 'Order', from: 'Completed', to: 'Pending' });
    expect(Array.isArray(r.body.allowed)).toBe(true);
    expect((fake.col('orders')['O-INV'] as { status: string }).status).toBe('Completed');
  });
  it('still reopens a Cancelled order, and still 404s a missing one', async () => {
    expect((await call({ op: 'updateOrderStatus', orderId: 'O-X', status: 'Pending' })).status).toBe(200);
    expect((fake.col('orders')['O-X'] as { status: string }).status).toBe('Pending');
    expect((await call({ op: 'updateOrderStatus', orderId: 'nope', status: 'Pending' })).status).toBe(404);
  });
  it('with `from`: a replay over a newer state is refused (409, nothing written); a matching or repeated one goes through; no `from` is as before', async () => {
    fake.col('orders')['O-P'] = { status: 'Completed', items: [] };
    const r = await call({ op: 'updateOrderStatus', orderId: 'O-P', status: 'Cancelled', from: 'Pending' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ machine: 'Order', from: 'Completed', to: 'Cancelled', error: "This order is now Completed: your change to Cancelled from Pending wasn't applied." });
    expect((fake.col('orders')['O-P'] as { status: string }).status).toBe('Completed');
    expect((await call({ op: 'updateOrderStatus', orderId: 'O-P', status: 'Cancelled', from: 'Completed' })).status).toBe(200);
    expect((fake.col('orders')['O-P'] as { status: string }).status).toBe('Cancelled');
    // Replayed again: already where it was going.
    expect((await call({ op: 'updateOrderStatus', orderId: 'O-P', status: 'Cancelled', from: 'Pending' })).status).toBe(200);
    expect((await call({ op: 'updateOrderStatus', orderId: 'O-P', status: 'Pending' })).status).toBe(200);
  });
});
