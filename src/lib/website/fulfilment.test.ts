import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from '@/lib/agent/fake-firestore';

const fake = fakeFirestore();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: fake.db, adminAuth: {} }));
const sent: string[] = [];
vi.mock('./notify', () => ({
  customerExpiredMessage: () => 'expired', customerPaidMessage: () => 'paid', customerShippedMessage: () => 'shipped',
  trySend: async (_to: string | undefined, text: string) => { sent.push(text); return 'sent'; },
}));
const track = vi.fn();
vi.mock('@/lib/leopards', () => ({ bookPacket: vi.fn(), leopardsConfig: () => null, trackingUrlFor: (c: string) => `https://t/${c}`, trackPacket: (...a: unknown[]) => track(...a) }));

const { lapseOrder, markDelivered, refreshTracking } = await import('./fulfilment');

const order = (extra: Record<string, unknown> = {}) => ({
  status: 'Pending', customerName: 'Demo', customerContact: '0300', items: [{ description: 'Ring', isCompleted: false }, { description: 'Chain', isCompleted: false }],
  website: { onlineId: 'ONL-1', paymentStatus: 'awaiting' }, leopards: { cn: 'CN1', bookedAt: 'x' }, ...extra,
});
const put = (id: string, o: Record<string, unknown>) => { fake.col('orders')[id] = o; };
const get = (id: string) => fake.col('orders')[id] as Record<string, any>;

beforeEach(() => { fake.reset(); sent.length = 0; track.mockReset(); });

describe('lapse (website order whose transfer never came)', () => {
  it('cancels an open order, marks the transfer expired and tells the customer', async () => {
    put('O1', order());
    const r = await lapseOrder('O1', 'owner@x');
    expect(r.notified).toBe('sent');
    expect(get('O1')).toMatchObject({ status: 'Cancelled', website: { paymentStatus: 'expired', lapsedBy: 'owner@x' } });
    expect(sent).toEqual(['expired']);
  });
  it('is refused once the transfer is recorded, and writes nothing', async () => {
    put('O2', order({ website: { onlineId: 'ONL-2', paymentStatus: 'transfer_received' } }));
    await expect(lapseOrder('O2', 'o')).rejects.toMatchObject({ status: 409 });
    expect(get('O2').status).toBe('Pending');
    expect(sent).toEqual([]);
  });
  it('is refused for a Completed or invoiced order with the machine\'s reason; already expired is a quiet success', async () => {
    put('O3', order({ status: 'Completed' }));
    await expect(lapseOrder('O3', 'o')).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Order cannot go from Completed to Cancelled/) });
    expect(get('O3').status).toBe('Completed');
    put('O4', order({ website: { onlineId: 'ONL-4', paymentStatus: 'expired' }, status: 'Cancelled' }));
    expect(await lapseOrder('O4', 'o')).toEqual({ ok: true, notified: null });
    expect(sent).toEqual([]);
  });
});

describe('delivered', () => {
  it('finishes an open order and ticks its pieces (unchanged), recording when', async () => {
    put('D1', order({ status: 'In Progress' }));
    await markDelivered('D1');
    expect(get('D1').status).toBe('Completed');
    expect(get('D1').items.every((i: { isCompleted: boolean }) => i.isCompleted)).toBe(true);
    expect(get('D1').leopards.deliveredAt).toBeTruthy();
  });
  it('records the delivery on a Cancelled order but leaves its status alone', async () => {
    put('D2', order({ status: 'Cancelled' }));
    await markDelivered('D2');
    expect(get('D2')).toMatchObject({ status: 'Cancelled' });
    expect(get('D2').leopards.deliveredAt).toBeTruthy();
    expect(get('D2').items.some((i: { isCompleted: boolean }) => i.isCompleted)).toBe(false);
  });
  it('the tracking refresh does the same when Leopards says delivered, and not twice', async () => {
    put('D3', order({ status: 'Cancelled' }));
    track.mockResolvedValue({ delivered: true });
    await refreshTracking('D3');
    expect(get('D3').status).toBe('Cancelled');
    const at = get('D3').leopards.deliveredAt;
    expect(at).toBeTruthy();
    await refreshTracking('D3');
    expect(get('D3').leopards.deliveredAt).toBe(at);
    put('D4', order({ status: 'Pending' }));
    await refreshTracking('D4');
    expect(get('D4').status).toBe('Completed');
  });
});
