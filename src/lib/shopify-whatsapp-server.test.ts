import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from '@/lib/agent/fake-firestore';

// A web order's WhatsApp conversation, against an in-memory Firestore. Nothing is sent. All data made up.
const fake = fakeFirestore();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: fake.db, adminAuth: {} }));
const sendMessage = vi.fn(async (_to: string, _text: string): Promise<unknown> => 'true_1@c.us_MSG1');
let polls = 0;
const sendPoll = vi.fn(async (_to: string, _name: string, _opts: string[]): Promise<string> => `true_1@c.us_POLL${++polls}`);
vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppMessage: (to: string, text: string) => sendMessage(to, text),
  sendWhatsAppPoll: (to: string, name: string, opts: string[]) => sendPoll(to, name, opts),
  toWhatsAppNumber: (n: string) => { const d = String(n).replace(/\D/g, ''); return d.startsWith('0') ? `92${d.slice(1)}` : d; },
  whatsAppNumberExists: vi.fn(async () => true),
}));
const push = vi.fn(async () => undefined);
vi.mock('@/lib/push/send', () => ({ pushToShop: push }));
const shopify = vi.fn(async (_s: string, _t: string, method: string) => (method === 'GET' ? { order: { tags: '' } } : {}));
vi.mock('@/app/api/shopify/_lib', () => ({ shopifyRequest: shopify }));

process.env.SHOPIFY_ORDER_WHATSAPP = '1';
const { startOrderFlow, handleInbound, handlePollVote, followUpPaidOrder } = await import('./shopify-whatsapp-server');

const creds = async () => ({ shop: 'mina.example', token: 't' });
const order = (o: Record<string, unknown> = {}) => ({
  id: 1001, order_number: 1459, name: '#1459', source_name: 'web', payment_gateway_names: ['Cash on Delivery (COD)'], financial_status: 'pending',
  created_at: new Date().toISOString(), total_price: '8350.0', shipping_address: { first_name: 'Ayesha', phone: '0300 1234567', city: 'Karachi' },
  line_items: [{ title: 'Pearl Ring', quantity: 1, price: '8350' }], ...o,
});
const PHONE = '923001234567';
const flow = (id = '1001') => fake.col('shopify_whatsapp')[id] as Record<string, any>;
const mark = (coll: string, id: string) => (fake.col(coll)[id] as Record<string, any> | undefined)?.whatsappOrder?.state;

beforeEach(() => {
  fake.reset();
  polls = 0;
  sendMessage.mockReset(); sendMessage.mockImplementation(async () => 'true_1@c.us_MSG1');
  sendPoll.mockClear(); push.mockClear(); shopify.mockClear();
  fake.col('orders')['SHOPIFY-1459'] = { status: 'Pending', items: [] };
});

describe('the flow as it always ran', () => {
  it('cash on delivery: asked, then 1 confirms once, 2 on another order declines; the ERP order mirrors each state', async () => {
    expect(await startOrderFlow(order())).toMatchObject({ started: true, kind: 'cod', state: 'awaiting-confirmation' });
    expect(sendPoll).toHaveBeenCalledTimes(1);
    expect(mark('orders', 'SHOPIFY-1459')).toBe('awaiting-confirmation');
    expect(await handleInbound({ phone: PHONE, text: ' 1 ', media: false }, creds)).toBe('confirmed');
    expect(flow()).toMatchObject({ state: 'confirmed' });
    expect(mark('orders', 'SHOPIFY-1459')).toBe('confirmed');
    expect(shopify).toHaveBeenCalled();
    // Answered once: the same reply again finds nothing open.
    expect(await handleInbound({ phone: PHONE, text: '1', media: false }, creds)).toBe('no-open-order');
    // A second order, declined by poll tap.
    fake.col('orders')['SHOPIFY-1460'] = { status: 'Pending', items: [] };
    await startOrderFlow(order({ id: 1002, order_number: 1460, name: '#1460' }));
    expect(await handlePollVote('true_1@c.us_POLL2', ['❌ Cancel order'], creds)).toBe('declined');
    expect(mark('orders', 'SHOPIFY-1460')).toBe('declined');
    // The order itself is not touched: only a person cancels it.
    expect((fake.col('orders')['SHOPIFY-1460'] as { status: string }).status).toBe('Pending');
  });

  it('bank transfer: a screenshot moves it once; paid in Shopify thanks once; the invoice carries the state when there is no order', async () => {
    delete fake.col('orders')['SHOPIFY-1459'];
    fake.col('invoices')['SHOPIFY-1459'] = { status: 'Unpaid' };
    await startOrderFlow(order({ payment_gateway_names: ['Bank Deposit'] }));
    expect(flow().state).toBe('awaiting-payment');
    expect(await handleInbound({ phone: PHONE, text: '', media: true }, creds)).toBe('slip-received');
    expect(mark('invoices', 'SHOPIFY-1459')).toBe('slip-received');
    expect(await followUpPaidOrder(order({ financial_status: 'paid' }) as never)).toBe(true);
    expect(await followUpPaidOrder(order({ financial_status: 'paid' }) as never)).toBe(false);
    expect(flow().state).toBe('paid');
    expect(mark('invoices', 'SHOPIFY-1459')).toBe('paid');
  });

  it('a question is left for a person; a number not on WhatsApp is final and tells the shop', async () => {
    await startOrderFlow(order());
    expect(await handleInbound({ phone: PHONE, text: 'when will it arrive?', media: false }, creds)).toBe('not-an-answer');
    expect(flow().state).toBe('awaiting-confirmation');
    const { whatsAppNumberExists } = await import('@/lib/whatsapp');
    vi.mocked(whatsAppNumberExists).mockResolvedValueOnce(false);
    fake.col('orders')['SHOPIFY-1470'] = { status: 'Pending', items: [] };
    expect(await startOrderFlow(order({ id: 7, order_number: 1470, name: '#1470', shipping_address: { phone: '0311 7654321' } }))).toMatchObject({ started: false, state: 'no-whatsapp' });
    expect(flow('7').state).toBe('no-whatsapp');
    expect(push).toHaveBeenCalledTimes(1);
    expect(await handleInbound({ phone: '923117654321', text: '1', media: false }, creds)).toBe('no-open-order');
  });
});

describe('a failed send is not the end', () => {
  it('a COD send that threw (but arrived): the customer\'s 1 confirms it, and the shop was told of the failure first', async () => {
    sendMessage.mockRejectedValueOnce(new Error('timeout'));
    expect(await startOrderFlow(order())).toMatchObject({ started: false, state: 'failed' });
    expect(flow()).toMatchObject({ state: 'failed', error: 'timeout' });
    expect(mark('orders', 'SHOPIFY-1459')).toBe('failed');
    expect(push).toHaveBeenCalledTimes(1);
    expect(await handleInbound({ phone: PHONE, text: '1', media: false }, creds)).toBe('confirmed');
    expect(flow().state).toBe('confirmed');
    expect(mark('orders', 'SHOPIFY-1459')).toBe('confirmed');
  });

  it('and a 2 declines it; a poll tap works too', async () => {
    sendMessage.mockRejectedValueOnce(new Error('timeout'));
    await startOrderFlow(order());
    expect(await handleInbound({ phone: PHONE, text: '2', media: false }, creds)).toBe('declined');
    fake.col('shopify_whatsapp')['1001'] = { ...flow(), state: 'failed', pollKey: 'POLLX' };
    expect(await handlePollVote('POLLX', ['✅ Confirm order'], creds)).toBe('confirmed');
  });

  it('a bank send that failed takes the screenshot', async () => {
    sendMessage.mockRejectedValueOnce(new Error('timeout'));
    await startOrderFlow(order({ payment_gateway_names: ['Bank Deposit'] }));
    expect(flow().state).toBe('failed');
    expect(await handleInbound({ phone: PHONE, text: 'ok', media: false }, creds)).toBe('not-an-answer');
    expect(await handleInbound({ phone: PHONE, text: '', media: true }, creds)).toBe('slip-received');
  });

  it('only the reply moves it: a failed transfer is not thanked as paid, and a failed paid-order thank-you has nothing to answer', async () => {
    sendMessage.mockRejectedValueOnce(new Error('timeout'));
    await startOrderFlow(order({ payment_gateway_names: ['Bank Deposit'] }));
    expect(await followUpPaidOrder(order({ financial_status: 'paid' }) as never)).toBe(false);
    expect(flow().state).toBe('failed');
    fake.col('orders')['SHOPIFY-1500'] = { status: 'Pending', items: [] };
    sendMessage.mockRejectedValueOnce(new Error('timeout'));
    await startOrderFlow(order({ id: 5, order_number: 1500, name: '#1500', financial_status: 'paid', payment_gateway_names: ['Safepay Checkout Onsite'], shipping_address: { phone: '0322 1111111' } }));
    expect(flow('5')).toMatchObject({ kind: 'paid', state: 'failed' });
    expect(await handleInbound({ phone: '923221111111', text: '1', media: false }, creds)).toBe('no-open-order');
  });

  it('a reply for an older order waiting is never taken by a newer one that failed', async () => {
    await startOrderFlow(order());
    fake.col('orders')['SHOPIFY-1460'] = { status: 'Pending', items: [] };
    sendMessage.mockRejectedValueOnce(new Error('timeout'));
    await startOrderFlow(order({ id: 1002, order_number: 1460, name: '#1460', created_at: new Date(Date.now() + 60_000).toISOString() }));
    fake.col('shopify_whatsapp')['1002'] = { ...flow('1002'), createdAt: new Date(Date.now() + 60_000).toISOString() };
    expect(flow('1002').state).toBe('failed');
    expect(await handleInbound({ phone: PHONE, text: '1', media: false }, creds)).toBe('confirmed');
    expect(flow('1001').state).toBe('confirmed');
    expect(flow('1002').state).toBe('failed');
  });

  it('a send that threw after the customer had already answered does not undo their answer, nor alarm the shop', async () => {
    sendMessage.mockImplementationOnce(async () => {
      await handleInbound({ phone: PHONE, text: '1', media: false }, creds);
      throw new Error('timeout');
    });
    await startOrderFlow(order());
    expect(flow().state).toBe('confirmed');
    expect(mark('orders', 'SHOPIFY-1459')).toBe('confirmed');
    const titles = (push.mock.calls as unknown as { title: string }[][]).map(c => c[0].title);
    expect(titles).toEqual(['COD order confirmed on WhatsApp']);
  });
});
