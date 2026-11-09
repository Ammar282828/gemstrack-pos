import { describe, expect, it } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { trackerPaid, checkoutUrl, isSafepayPublicKey } from '@/lib/safepay';
import { createPaymentLink, settleOpenLinks } from './payment-links';

function fakeDb(seed: Record<string, Record<string, Record<string, unknown>>>) {
  const data = structuredClone(seed);
  const col = (c: string) => (data[c] ??= {});
  const db: DbPort = {
    async runTransaction(fn) {
      const writes: (() => void)[] = [];
      const tx: TxCtx = {
        async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
        set(c, id, d, merge) { writes.push(() => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; }); },
        update(c, id, d) { writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }); },
        delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      };
      const out = await fn(tx);
      writes.forEach(w => w());
      return out;
    },
    async queryEquals(c, field, value) { return Object.entries(col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...structuredClone(d), id }) as never); },
    async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
    async add() { return 'x'; },
    async update(c, id, d) { col(c)[id] = { ...col(c)[id], ...d }; },
    batch() { throw new Error('unused'); },
    newId() { return 'n'; },
    timestamp: (d: Date) => ({ ts: d.toISOString() }),
    serverTime: () => 'server-time',
  };
  return { db, data };
}

const TOKEN = 'track_85c828f9-574f-4145-ad2d-53c451eaf91f';
const open = async (amount: number) => ({ token: TOKEN, amount, currency: 'PKR', state: 'TRACKER_STARTED', transaction: null });

describe('Safepay payment links', () => {
  it('reads Safepay\'s tracker: paid only with a transaction that went through', () => {
    expect(trackerPaid({ state: 'TRACKER_STARTED', transaction: null })).toBe(false);
    expect(trackerPaid({ state: 'TRACKER_ENDED', transaction: { state: 'PAID' } })).toBe(true);
    expect(trackerPaid({ state: 'TRACKER_STARTED', transaction: { state: 'CAPTURED' } })).toBe(true);
    expect(trackerPaid({ state: 'TRACKER_ENDED', transaction: { state: 'FAILED' } })).toBe(false);
    expect(trackerPaid({ state: 'TRACKER_ENDED', transaction: null })).toBe(false);
    expect(isSafepayPublicKey('sec_0050837b-bdd1-4313-ade4-7a3852219901')).toBe(true);
    expect(isSafepayPublicKey('ca27c231f47dc8efce')).toBe(false);
    expect(checkoutUrl(TOKEN, 'INV-1', 'https://x.y')).toMatch(/^https:\/\/getsafepay\.com\/components\?env=production&beacon=track_/);
  });

  it('makes a link for an invoice; once Safepay says paid, the payment goes on the invoice once, by card', async () => {
    const { db, data } = fakeDb({ invoices: { 'INV-000007': { customerName: 'Sara', grandTotal: 8350, amountPaid: 0, balanceDue: 8350, paymentHistory: [] } } });
    const link = await createPaymentLink(db, { target: 'invoice', targetId: 'INV-000007', amount: 8350, returnTo: 'https://houseofmina.store' }, { open, now: '2026-11-09T21:00:00Z' });
    expect(data.payment_links[TOKEN]).toMatchObject({ state: 'open', amount: 8350, target: 'invoice', targetId: 'INV-000007', customerName: 'Sara' });
    expect(link.url).toContain('order_id=INV-000007');
    const waiting = await settleOpenLinks(db, { read: async () => ({ token: TOKEN, amount: 8350, currency: 'PKR', state: 'TRACKER_STARTED', transaction: null }), now: new Date('2026-11-09T21:05:00Z') });
    expect(waiting.paid).toEqual([]);
    const paid = { read: async () => ({ token: TOKEN, amount: 8350, currency: 'PKR', state: 'TRACKER_ENDED', transaction: { state: 'PAID' } }), now: new Date('2026-11-09T21:10:00Z') };
    expect((await settleOpenLinks(db, paid)).paid).toEqual(['invoice INV-000007']);
    expect(data.invoices['INV-000007']).toMatchObject({ amountPaid: 8350, balanceDue: 0 });
    expect((data.invoices['INV-000007'].paymentHistory as { method?: string; id?: string }[])[0]).toMatchObject({ method: 'Card', id: `pay-safepay-${TOKEN}` });
    expect(data.payment_links[TOKEN]).toMatchObject({ state: 'paid' });
    expect((await settleOpenLinks(db, paid)).checked).toBe(0);
  });

  it('an order\'s link becomes an advance; an unpaid link closes after 30 days; a cancelled sale refuses a link', async () => {
    const { db, data } = fakeDb({ orders: { 'SHOPIFY-1476': { customerName: 'Mahin', subtotal: 4350, advancePayment: 0, advances: [], status: 'Pending' }, 'ORD-1': { status: 'Cancelled' } } });
    await createPaymentLink(db, { target: 'order', targetId: 'SHOPIFY-1476', amount: 4350, returnTo: 'https://x' }, { open });
    await settleOpenLinks(db, { read: async () => ({ token: TOKEN, amount: 4350, currency: 'PKR', state: 'TRACKER_ENDED', transaction: { state: 'PAID' } }) });
    expect(data.orders['SHOPIFY-1476']).toMatchObject({ advancePayment: 4350 });
    await expect(createPaymentLink(db, { target: 'order', targetId: 'ORD-1', amount: 10, returnTo: 'x' }, { open })).rejects.toThrow(/cancelled/);
    data.payment_links[TOKEN] = { ...data.payment_links[TOKEN], state: 'open', createdAt: '2026-09-01T00:00:00Z' };
    const r = await settleOpenLinks(db, { read: async () => ({ token: TOKEN, amount: 10, currency: 'PKR', state: 'TRACKER_STARTED', transaction: null }), now: new Date('2026-11-09T00:00:00Z') });
    expect(r.expired).toEqual([TOKEN]);
  });
});
