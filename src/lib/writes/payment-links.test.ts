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

describe('payment links and the closed records (Link machine)', () => {
  const paidNow = { read: async () => ({ token: TOKEN, amount: 4350, currency: 'PKR', state: 'TRACKER_ENDED', transaction: { state: 'PAID' } }), now: new Date('2026-11-09T21:10:00Z') };
  const link = (extra: Record<string, unknown> = {}) => ({ [TOKEN]: { id: TOKEN, target: 'order', targetId: 'ORD-1', amount: 4350, url: 'u', state: 'open', createdAt: '2026-11-09T21:00:00Z', ...extra } });
  const logs: { action: string; title: string; detail: string; id?: string }[] = [];
  const fx = { log: (action: string, title: string, detail: string, id?: string) => { logs.push({ action, title, detail, id }); } };

  it('an order that was invoiced since takes the money on its INVOICE, once, with the same request id; the link is paid', async () => {
    const { db, data } = fakeDb({
      orders: { 'ORD-1': { status: 'Completed', invoiceId: 'INV-1', subtotal: 4350, advancePayment: 0, advances: [] } },
      invoices: { 'INV-1': { customerName: 'Sara', grandTotal: 4350, amountPaid: 0, balanceDue: 4350, paymentHistory: [] } },
      payment_links: link(),
    });
    expect((await settleOpenLinks(db, paidNow, fx)).paid).toEqual(['order ORD-1']);
    expect(data.invoices['INV-1']).toMatchObject({ amountPaid: 4350, balanceDue: 0 });
    expect((data.invoices['INV-1'].paymentHistory as { id?: string; method?: string }[])[0]).toMatchObject({ id: `pay-safepay-${TOKEN}`, method: 'Card' });
    expect(data.orders['ORD-1']).toMatchObject({ advancePayment: 0, advances: [] });
    expect(data.payment_links[TOKEN]).toMatchObject({ state: 'paid' });
    expect((await settleOpenLinks(db, paidNow, fx)).checked).toBe(0);
  });

  it('a Cancelled or Refunded order, or a Refunded invoice, records nothing: the link needs the owner, with a reason and a log line, and is not retried', async () => {
    for (const [seed, kind, id] of [
      [{ orders: { 'ORD-1': { status: 'Cancelled', subtotal: 4350, advances: [] } } }, 'order', 'ORD-1'],
      [{ orders: { 'ORD-1': { status: 'Refunded', subtotal: 4350, advances: [] } } }, 'order', 'ORD-1'],
      [{ invoices: { 'INV-9': { status: 'Refunded', grandTotal: 4350, amountPaid: 0, balanceDue: 4350, paymentHistory: [] } } }, 'invoice', 'INV-9'],
    ] as const) {
      logs.length = 0;
      const { db, data } = fakeDb({ ...seed, payment_links: link({ target: kind, targetId: id }) });
      const r = await settleOpenLinks(db, paidNow, fx);
      expect(r.paid).toEqual([]);
      expect(r.errors).toEqual([]);
      expect(data.payment_links[TOKEN]).toMatchObject({ state: 'attention', attentionReason: expect.stringMatching(/4,350.*Safepay/) });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: `${kind}.update`, id });
      if (data.orders) expect(data.orders['ORD-1'].advances).toEqual([]);
      if (data.invoices) expect(data.invoices['INV-9'].paymentHistory).toEqual([]);
      expect((await settleOpenLinks(db, paidNow, fx)).checked).toBe(0);
    }
  });

  it('an expired link is still read for a late payment for 90 days, then left alone', async () => {
    const { db, data } = fakeDb({
      orders: { 'ORD-1': { status: 'Pending', subtotal: 4350, advancePayment: 0, advances: [] } },
      payment_links: link({ state: 'expired', createdAt: '2026-10-01T00:00:00Z' }),
    });
    const r = await settleOpenLinks(db, paidNow, fx);
    expect(r.paid).toEqual(['order ORD-1']);
    expect(data.orders['ORD-1']).toMatchObject({ advancePayment: 4350 });
    expect(data.payment_links[TOKEN]).toMatchObject({ state: 'paid' });

    const old = fakeDb({ orders: { 'ORD-1': { status: 'Pending', subtotal: 4350, advancePayment: 0, advances: [] } }, payment_links: link({ state: 'expired', createdAt: '2026-06-01T00:00:00Z' }) });
    const r2 = await settleOpenLinks(old.db, paidNow, fx);
    expect(r2.checked).toBe(0);
    expect(old.data.orders['ORD-1']).toMatchObject({ advancePayment: 0 });
  });

  it('an expired link that is still unpaid stays expired and is not closed twice', async () => {
    const { db, data } = fakeDb({ orders: { 'ORD-1': { status: 'Pending' } }, payment_links: link({ state: 'expired', createdAt: '2026-10-01T00:00:00Z' }) });
    const r = await settleOpenLinks(db, { read: async () => ({ token: TOKEN, amount: 1, currency: 'PKR', state: 'TRACKER_STARTED', transaction: null }), now: new Date('2026-11-09T00:00:00Z') }, fx);
    expect(r).toMatchObject({ checked: 1, paid: [], expired: [] });
    expect(data.payment_links[TOKEN].state).toBe('expired');
  });
});

