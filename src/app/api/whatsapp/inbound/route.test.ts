import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleInbound = vi.fn(async () => 'confirmed');
vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
vi.mock('@/app/api/shopify/_lib', () => ({ getShopifyCredentials: vi.fn() }));
vi.mock('@/lib/shopify-whatsapp-server', () => ({ handleInbound, shopifyOrderWhatsAppOn: () => true }));

vi.stubEnv('WAHA_API_KEY', 'test-key');
vi.stubEnv('WAHA_SESSION', 'mina');
const { POST } = await import('./route');
const { inboundHmacKey } = await import('@/lib/whatsapp-inbound-key');

const call = (body: unknown, sign: string | null = inboundHmacKey('test-key')) => {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sign) headers['x-webhook-hmac'] = crypto.createHmac('sha512', sign).update(raw).digest('hex');
  return POST(new Request('http://x/api/whatsapp/inbound', { method: 'POST', headers, body: raw }) as never);
};
const msg = (p: Record<string, unknown> = {}, session = 'mina') => ({ event: 'message', session, payload: { from: '1@lid', body: '1', hasMedia: false, _data: { Info: { SenderAlt: '923001234567@s.whatsapp.net' } }, ...p } });

describe('WhatsApp inbound', () => {
  beforeEach(() => handleInbound.mockClear());
  it('refuses a call not signed with the key derived from WAHA_API_KEY', async () => {
    expect((await call(msg(), null)).status).toBe(401);
    expect((await call(msg(), 'some-other-key')).status).toBe(401);
    expect(handleInbound).not.toHaveBeenCalled();
  });
  it("passes a customer's reply on, with their number", async () => {
    const r = await call(msg());
    expect(r.status).toBe(200);
    expect(handleInbound).toHaveBeenCalledWith({ phone: '923001234567', text: '1', media: false }, expect.any(Function));
  });
  it('a picture counts as a screenshot', async () => {
    await call(msg({ body: '', hasMedia: true, media: { mimetype: 'image/jpeg' } }));
    expect(handleInbound).toHaveBeenCalledWith(expect.objectContaining({ media: true }), expect.any(Function));
  });
  it("ignores the line's own messages, groups and the other house's line", async () => {
    await call(msg({ fromMe: true }));
    await call(msg({ from: '1203@g.us' }));
    await call(msg({}, 'default'));
    expect(handleInbound).not.toHaveBeenCalled();
  });
});
