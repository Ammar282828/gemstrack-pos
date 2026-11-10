import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from '@/lib/agent/fake-firestore';
import type { OpContext } from './op-context';

const fake = fakeFirestore();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: fake.db, adminAuth: {} }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { delete: () => undefined, arrayUnion: (...v: unknown[]) => ({ __union: v }), increment: (n: number) => ({ __inc: n }) } }));
class TcsError extends Error { constructor(m: string, public status = 400) { super(m); } }
const cancelAtTcs = vi.fn(async () => undefined);
const createAtTcs = vi.fn(async () => ({ cn: '700000001' }));
vi.mock('@/lib/tcs-cod-server', () => ({
  TcsError, codAccount: async () => ({ originCity: 'Karachi' }), tcsCities: async () => ['Lahore'], tcsCancelOrder: cancelAtTcs, tcsCreateOrder: createAtTcs,
}));
const tracking = vi.fn(async (_ask: unknown) => ({ state: 'booked' }) as { state: string } | null);
vi.mock('@/lib/tracking-server', () => ({ getTracking: tracking }));
vi.mock('@/lib/shopify-fulfil-server', () => ({ fulfilShopifyOrder: vi.fn() }));

const { runCourierOp } = await import('./ops-courier');
const ctx = (): OpContext => ({ email: 'owner@example.com', log: async () => undefined, alert: () => undefined, followUps: [] } as unknown as OpContext);
const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runCourierOp(op, body, ctx());
  return { status: res!.status, body: await res!.json() as Record<string, unknown> };
};
const book = { orderId: 'O1', consignee: { name: 'Sara', address: 'Street 1', mobile: '03001234567' }, destinationCity: 'Lahore', weight: 1, pieces: 1, codAmount: 1000 };
const order = (extra: Record<string, unknown> = {}) => { fake.col('orders').O1 = { status: 'Pending', ...extra }; };
const get = () => fake.col('orders').O1 as Record<string, any>;

beforeEach(() => { fake.reset(); cancelAtTcs.mockClear(); createAtTcs.mockClear(); tracking.mockReset(); tracking.mockResolvedValue({ state: 'booked' }); });

describe('bookTcs (BOOKING book)', () => {
  it('is refused on a Cancelled or Refunded order, 409 with the machine\'s reason, and nothing is booked', async () => {
    for (const status of ['Cancelled', 'Refunded']) {
      order({ status });
      const r = await run('bookTcs', book);
      expect(r.status).toBe(409);
      expect(r.body).toMatchObject({ machine: 'TCS booking', error: expect.stringMatching(/cancelled or refunded: reopen it/) });
      expect(createAtTcs).not.toHaveBeenCalled();
      expect(get().tcsBooking).toBeUndefined();
    }
  });
  it('books an open order as before', async () => {
    order();
    const r = await run('bookTcs', book);
    expect(r.status).toBe(200);
    expect(get()).toMatchObject({ tcsConsignmentNo: '700000001', tcsBooking: { cn: '700000001' } });
  });
  it('books again after a cancelled booking', async () => {
    order({ tcsBooking: { cn: '1', cancelledAt: 'x' }, tcsCancelledCns: ['1'] });
    expect((await run('bookTcs', book)).status).toBe(200);
  });
});

describe('cancelTcs (BOOKING cancel)', () => {
  it('cancels a parcel that has not left, clears the number and remembers it in tcsCancelledCns', async () => {
    order({ tcsConsignmentNo: '700000001', tcsBooking: { cn: '700000001', bookedAt: 'x' } });
    const r = await run('cancelTcs', { orderId: 'O1' });
    expect(r.status).toBe(200);
    expect(cancelAtTcs).toHaveBeenCalledWith('700000001');
    expect(get().tcsConsignmentNo).toBeUndefined();
    expect(get().tcsBooking.cancelledAt).toBeTruthy();
    expect(get().tcsCancelledCns).toEqual(['700000001']);
  });
  it('is refused when TCS already has the parcel moving, and TCS is not asked to cancel', async () => {
    for (const state of ['shipped', 'in_transit', 'out_for_delivery', 'delivered', 'returned']) {
      order({ tcsConsignmentNo: '700000001', tcsBooking: { cn: '700000001', bookedAt: 'x' } });
      tracking.mockResolvedValue({ state });
      const r = await run('cancelTcs', { orderId: 'O1' });
      expect(r.status, state).toBe(409);
      expect(r.body).toMatchObject({ machine: 'TCS booking', error: expect.stringMatching(/parcel moving/) });
    }
    expect(cancelAtTcs).not.toHaveBeenCalled();
    expect(get().tcsBooking.cancelledAt).toBeUndefined();
  });
  it('cancels when tracking cannot be read (not known to be moving)', async () => {
    order({ tcsConsignmentNo: '700000001', tcsBooking: { cn: '700000001', bookedAt: 'x' } });
    tracking.mockRejectedValue(new Error('TCS down'));
    expect((await run('cancelTcs', { orderId: 'O1' })).status).toBe(200);
  });
});
