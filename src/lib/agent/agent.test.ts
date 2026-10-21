import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';
import type { DbPort, TxCtx } from '@/lib/db-port';
import { fakeFirestore } from './fake-firestore';

// One in-memory database behind the Admin SDK and the shared writes' port. All data made up.
const fake = fakeFirestore();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: fake.db, adminAuth: {} }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => ({ __inc: n }), delete: () => undefined } }));
const roles: Record<string, string> = { 'owner@example.com': 'owner' };
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string) => roles[e] ?? 'none' }));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
const limit = { ok: true };
vi.mock('@/lib/website/ratelimit', () => ({
  rateLimit: vi.fn(async () => ({ ok: limit.ok, remaining: limit.ok ? 100 : 0, retryAfter: 600 })),
  callerKey: () => 'test',
}));

const port: DbPort = {
  async runTransaction(fn) {
    const writes: (() => void)[] = [];
    const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { fake.col(c)[id] = merge ? { ...fake.col(c)[id], ...d } : { ...d }; };
    const tx: TxCtx = {
      async get(c, id) { const d = fake.col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete fake.col(c)[id]; }); },
    };
    const out = await fn(tx);
    writes.forEach(w => w());
    return out;
  },
  async queryEquals(c, field, value) { return Object.entries(fake.col(c)).filter(([, d]) => d[field] === value).map(([id, d]) => ({ ...d, id }) as never); },
  async get(c, id) { const d = fake.col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add(c, d) { const r = await fake.db.collection(c).add(d); return r.id; },
  async update(c, id, d) { fake.col(c)[id] = { ...fake.col(c)[id], ...d }; },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => { fake.col(c)[id] = merge ? { ...fake.col(c)[id], ...d } : { ...d }; }); },
      update(c, id, d) { writes.push(() => { fake.col(c)[id] = { ...fake.col(c)[id], ...d }; }); },
      delete(c, id) { writes.push(() => { delete fake.col(c)[id]; }); },
      async commit() { writes.forEach(w => w()); },
    };
  },
  newId: () => `id${Math.random().toString(36).slice(2, 10)}`,
  timestamp: d => ({ ts: d.toISOString() }),
  serverTime: () => 'server-time',
};
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));

// Nothing leaves: the library, the drawing, WhatsApp, Instagram, alerts.
const ASSET = { id: 'site:rings/emerald-ring.jpg', source: 'site', key: 'rings/emerald-ring.jpg', name: 'Emerald Ring', collection: 'Rings', thumb: '', page: 'https://taheri.example/rings/emerald-ring', added: 1, specs: '21K Yellow Gold · Emerald · 4.2g', original: null };
let square: Buffer, tall: Buffer;
vi.mock('@/lib/ads/studio/assets', () => ({
  listAssets: vi.fn(async () => ({ assets: [ASSET], drive: { ok: true } })),
  loadAssessments: vi.fn(async () => new Map()),
  assetJpeg: vi.fn(async () => square),
  assetImage: vi.fn(async () => ({ data: square, type: 'image/jpeg' })),
}));
vi.mock('@/lib/ads/studio/server-draw', () => ({
  assetsOf: vi.fn(async () => ({ photos: {}, marks: {}, fonts: {} })),
  layOut: vi.fn((f: { format: string }) => ({ bg: { photoId: 'photo' }, layers: [], frame: f.format === 'story' ? { w: 1080, h: 1920 } : { w: 1080, h: 1080 } })),
  drawJpeg: vi.fn((doc: { frame: { h: number } }) => (doc.frame.h > 1080 ? tall : square)),
  settleBoard: vi.fn(async () => []),
}));
vi.mock('@/lib/website/site-pieces', () => ({ getSitePiece: vi.fn(async () => null), siteOrigin: () => 'https://taheri.example' }));
const sendWa = vi.fn(async () => 'msg-1');
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppFileToGroup: sendWa, whatsAppProvider: () => 'waha', sendWhatsAppTextToGroup: vi.fn() }));
vi.mock('@/lib/social/instagram', () => ({ instagramConfigured: () => false, loadConnection: async () => null }));
vi.mock('@/lib/social/story-post', () => ({ postStoryImage: vi.fn(async () => 'ig-1') }));
vi.mock('@/lib/website/upload', () => ({ uploadToSite: vi.fn() }));
vi.mock('@/lib/website/featured', () => ({ saveFeatured: vi.fn() }));
const alertSent = vi.fn(async () => ({ status: 'sent' }));
vi.mock('@/lib/notifications/send-alert', () => ({ sendLiveAlert: alertSent }));
vi.mock('@/lib/writes/invoice-payment', async orig => {
  const real = await orig<typeof import('@/lib/writes/invoice-payment')>();
  return { ...real, recordInvoicePayment: vi.fn(real.recordInvoicePayment) };
});
const rules = { ok: true as boolean };
vi.mock('@/lib/agent/rules-guard', () => ({ keysAllowed: async () => (rules.ok ? { ok: true } : { ok: false, state: 'open', message: 'AI keys are paused: publish firestore.rules' }) }));
process.env.WHATSAPP_COMMUNITY_CHAT_ID = '120363000000000001@g.us';

const { createKey, revokeKey } = await import('./keys');
const { ALL_TOOLS } = await import('./tools');
const { runTool, toolsFor, schemaOf } = await import('./registry');
const { buildOpenApi } = await import('./openapi');
const { POST: mcp } = await import('@/app/api/agent/mcp/route');
const { POST: rest } = await import('@/app/api/agent/v1/[tool]/route');
const { POST: appWrite } = await import('@/app/api/app/write/route');
const { POST: queueSend } = await import('@/app/api/website/post/queue/[id]/send/route');
const { PATCH: queuePatch } = await import('@/app/api/website/post/queue/[id]/route');
const { POST: oauthToken } = await import('@/app/api/agent/oauth/token/route');
const { claimItem, changeItem } = await import('@/lib/social/queue');
const { recordInvoicePayment } = await import('@/lib/writes/invoice-payment');
type Scope = import('./scopes').Scope;

beforeAll(async () => {
  square = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#777' } }).jpeg().toBuffer();
  tall = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#555' } }).jpeg().toBuffer();
});
beforeEach(() => {
  fake.reset();
  limit.ok = true;
  rules.ok = true;
  sendWa.mockClear();
  fake.col('invoices')['INV-000001'] = { grandTotal: 100_000, amountPaid: 0, balanceDue: 100_000, customerId: 'c1', customerName: 'Demo One', paymentHistory: [], createdAt: '2026-10-01T10:00:00.000Z' };
});

const keyWith = async (scopes: Scope[], label = 'ChatGPT') => (await createKey({ label, scopes, by: 'owner@example.com' })).key;
const ctxFor = (scopes: Scope[]) => ({
  key: { id: 'k1', label: 'ChatGPT', scopes, email: 'owner@example.com', role: 'owner' as const, expiresAt: null },
  origin: 'https://erp.example', mediaOrigin: 'https://erp.example', via: 'via ChatGPT', imageUrls: false,
  log: async () => undefined,
});

const rpc = async (key: string | null, body: unknown) => {
  const res = await mcp(new NextRequest('https://erp.example/api/agent/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body),
  }));
  return { status: res.status, headers: res.headers, body: res.status === 202 ? null : await res.json() };
};
const call = async (key: string, tool: string, args: unknown = {}) => {
  const res = await rest(new NextRequest(`https://erp.example/api/agent/v1/${tool}`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(args),
  }), { params: Promise.resolve({ tool }) });
  return { status: res.status, body: await res.json() };
};

describe('the one registry', () => {
  it('names every tool once, says what it does, and takes an object', () => {
    const names = ALL_TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of ALL_TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]{2,63}$/);
      expect(t.description.length).toBeGreaterThan(10);
      expect(schemaOf(t).type).toBe('object');
    }
    expect(names).toEqual(expect.arrayContaining(['get_guide', 'find_photos', 'view_photo', 'make_post', 'view_post', 'list_queue', 'queue_post', 'send_post', 'schedule_post', 'whats_owed', 'todays_cash', 'create_invoice', 'record_payment', 'studio_get_board']));
  });

  it('shows a key only its scopes’ tools', () => {
    const read = toolsFor(ALL_TOOLS, ['read']).map(t => t.name);
    expect(read).toEqual(expect.arrayContaining(['get_guide', 'find_orders', 'whats_owed', 'find_photos']));
    expect(read).not.toEqual(expect.arrayContaining(['make_post']));
    for (const n of ['make_post', 'queue_post', 'send_post', 'create_invoice', 'add_customer']) expect(read).not.toContain(n);
  });

  it('refuses publish, money and shop tools without their scope, server-side, saying which', async () => {
    const draft = ctxFor(['posts:draft']);
    const r1 = await runTool(ALL_TOOLS, 'send_post', { queue_id: 'abcdefghij12' }, draft);
    expect(r1).toMatchObject({ ok: false, status: 403 });
    expect(!r1.ok && r1.error).toMatch(/Send posts/);
    const r2 = await runTool(ALL_TOOLS, 'create_invoice', { skus: ['X'] }, draft);
    expect(!r2.ok && r2.error).toMatch(/Take money/);
    const r3 = await runTool(ALL_TOOLS, 'add_repair', { pieces: [{ item: 'Ring' }], advance: 5000 }, ctxFor(['write:shop']));
    expect(r3).toMatchObject({ ok: false, status: 403 });
    expect(!r3.ok && r3.error).toMatch(/write:money/);
  });

  it('checks input with the tool’s schema', async () => {
    const r = await runTool(ALL_TOOLS, 'make_post', { photo: ASSET.id, format: 'poster' }, ctxFor(['posts:draft']));
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(!r.ok && r.error).toMatch(/^format:/);
  });
});

describe('OpenAPI from the registry', () => {
  it('describes every tool as POST /api/agent/v1/<tool>, with a bearer key and the house’s address', () => {
    const doc = buildOpenApi(ALL_TOOLS, { serverUrl: 'https://erp.example/', house: 'TAHERI' });
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://erp.example' }]);
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    const ops = Object.entries(doc.paths).map(([p, v]) => [p, (v as { post: { operationId: string; description: string; requestBody: { content: Record<string, { schema: { type: string } }> } } }).post] as const);
    expect(ops.length).toBe(ALL_TOOLS.length);
    for (const [path, op] of ops) {
      expect(path).toBe(`/api/agent/v1/${op.operationId}`);
      expect(op.description.length).toBeLessThanOrEqual(300);
      expect(op.requestBody.content['application/json'].schema.type).toBe('object');
    }
    expect(JSON.stringify(doc)).not.toMatch(/tk_[a-z]+_[a-f0-9]{16}_/);
  });

  it('narrows to one key’s scopes', () => {
    const doc = buildOpenApi(ALL_TOOLS, { serverUrl: 'https://erp.example', house: 'TAHERI', scopes: ['read'] });
    expect(Object.keys(doc.paths)).toContain('/api/agent/v1/whats_owed');
    expect(Object.keys(doc.paths)).not.toContain('/api/agent/v1/create_invoice');
  });
});

describe('MCP', () => {
  it('needs a key, and says where a connector signs in', async () => {
    const r = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toMatch(/resource_metadata=".*\/\.well-known\/oauth-protected-resource"/);
  });

  it('initializes, lists the key’s tools, and calls one', async () => {
    const key = await keyWith(['posts:draft', 'read']);
    const init = await rpc(key, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: expect.any(String) } });
    expect(init.body.result.instructions).toMatch(/get_guide/);
    expect((await rpc(key, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const list = await rpc(key, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('make_post');
    expect(names).not.toContain('create_invoice');
    expect(list.body.result.tools[0]).toMatchObject({ name: 'get_guide', inputSchema: { type: 'object' } });
    const guide = await rpc(key, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_guide', arguments: {} } });
    expect(guide.body.result.content[0].text).toMatch(/house brief/);
    expect(guide.body.result.content[0].text).toMatch(/Najmi Market/);
    const no = await rpc(key, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_invoice', arguments: { skus: ['X'] } } });
    expect(no.body.result).toMatchObject({ isError: true });
    expect(no.body.result.content[0].text).toMatch(/Take money/);
    // Every call is in the activity log under the key's name; the key never is.
    const log = Object.values(fake.col('activity_log'));
    expect(log.some(l => l.eventType === 'ai.read' && String(l.details).includes('via ChatGPT'))).toBe(true);
    expect(log.some(l => l.eventType === 'ai.refused')).toBe(true);
    expect(JSON.stringify(log)).not.toContain(key.slice(-40));
  });

  it('refuses every key while the database rules are open', async () => {
    const key = await keyWith(['read']);
    rules.ok = false;
    const r = await rpc(key, { jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/paused/);
    const tok = await oauthToken(new NextRequest('https://erp.example/api/agent/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=authorization_code&code=x&code_verifier=y' }));
    expect(tok.status).toBe(503);
    expect(await tok.json()).toMatchObject({ error: 'temporarily_unavailable' });
    rules.ok = true;
    expect((await rpc(key, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200);
  });

  it('turns away a revoked or expired key, and one over its hour', async () => {
    const { key, info } = await createKey({ label: 'Old', scopes: ['read'], by: 'owner@example.com' });
    await revokeKey(info.id);
    expect((await rpc(key, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401);
    const soon = await createKey({ label: 'Soon', scopes: ['read'], by: 'owner@example.com', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const rec = fake.col('app_private')[`ai_key__${soon.info.id}`];
    rec.expiresAt = new Date(Date.now() - 1000).toISOString();
    const r = await rpc(soon.key, { jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/expired/);
    const ok = await keyWith(['read']);
    limit.ok = false;
    expect((await rpc(ok, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(429);
  });
});

describe('a post, made and queued by an AI', () => {
  it('is drawn on the server, kept as a Design, and waits in the queue for the owner', async () => {
    const key = await keyWith(['posts:draft']);
    const made = await call(key, 'make_post', { photo: ASSET.id, headline: 'An emerald for Eid' });
    expect(made.status).toBe(200);
    expect(made.body.images).toHaveLength(2);
    expect(made.body.images[0].url).toMatch(/^https:\/\/erp\.example\/api\/agent\/preview\/[\w-]{32}$/);
    const design = fake.col('designs')[made.body.data.post];
    expect(design).toMatchObject({ kind: 'piece', scope: 'shop', by: 'ChatGPT (AI)', master: 'story', fields: { headline: 'An emerald for Eid', weight: ASSET.specs } });
    expect(Object.keys(design.files as object).sort()).toEqual(['doc:post', 'doc:story', 'image:post', 'image:story', 'photo:photo']);

    const queued = await call(key, 'queue_post', { post: made.body.data.post, whatsapp: ['announcements'] });
    expect(queued.status).toBe(200);
    const id = queued.body.data.queued;
    expect(fake.col('social_queue')[id]).toMatchObject({ status: 'held', proposedBy: 'ChatGPT', design: made.body.data.post, whatsapp: ['announcements'], counts: { wa: 1, story: false } });
    // Nothing sends it without someone's OK: not the tick, not a send with nobody named, not a time.
    expect(await claimItem(id, new Date())).toBeNull();
    expect(await claimItem(id, new Date(), true)).toBeNull();
    await expect(changeItem(id, { action: 'schedule', dueAt: new Date().toISOString() })).rejects.toThrow(/approve it first/);
    expect((await call(key, 'send_post', { queue_id: id })).status).toBe(403);
    expect(sendWa).not.toHaveBeenCalled();

    // A key that may send: its send is the OK, and it goes.
    const pub = await keyWith(['posts:publish'], 'Publisher');
    const sent = await call(pub, 'send_post', { queue_id: id });
    expect(sent.body.data).toMatchObject({ status: 'sent', awaitingApproval: false });
    expect(sendWa).toHaveBeenCalledTimes(1);
    expect(fake.col('social_queue')[id]).toMatchObject({ approvedBy: 'ai:Publisher' });
  });

  it('goes out only on its own approval: never by a person’s Send now, a time, Send all or the tick', async () => {
    const key = await keyWith(['posts:draft']);
    const made = await call(key, 'make_post', { photo: ASSET.id, format: 'square' });
    const id = (await call(key, 'queue_post', { post: made.body.data.post, whatsapp: ['announcements'] })).body.data.queued;
    const asOwner = (method: string, url: string, body?: unknown) => new NextRequest(url, { method, headers: { 'content-type': 'application/json', 'x-test-email': 'owner@example.com' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const params = { params: Promise.resolve({ id }) };
    // A tray's Send all is one Send now per piece: refused for this one.
    const send = await queueSend(asOwner('POST', `https://erp.example/api/website/post/queue/${id}/send`), params);
    expect(send.status).toBe(409);
    expect(await send.json()).toMatchObject({ needsApproval: true, error: expect.stringMatching(/approve it first/) });
    // Spread is one time per piece: refused too.
    expect((await queuePatch(asOwner('PATCH', `https://erp.example/api/website/post/queue/${id}`, { action: 'schedule', dueAt: new Date().toISOString() }), params)).status).toBe(409);
    expect(await claimItem(id, new Date(Date.now() + 86_400_000))).toBeNull();
    expect(sendWa).not.toHaveBeenCalled();
    // Its own Approve, then it goes like any other.
    const ok = await queuePatch(asOwner('PATCH', `https://erp.example/api/website/post/queue/${id}`, { action: 'approve' }), params);
    expect(await ok.json()).toMatchObject({ item: { awaitingApproval: false, approvedBy: 'owner@example.com' } });
    const sent = await queueSend(asOwner('POST', `https://erp.example/api/website/post/queue/${id}/send`), params);
    expect(await sent.json()).toMatchObject({ ok: true, item: { status: 'sent' } });
    expect(sendWa).toHaveBeenCalledTimes(1);
  });

  it('refuses words that break the house rules, with the reason', async () => {
    const key = await keyWith(['posts:draft']);
    const sale = await call(key, 'make_post', { photo: ASSET.id, headline: 'Eid sale on now' });
    expect(sale.status).toBe(422);
    expect(sale.body.error).toMatch(/sale or discount/);
    const place = await call(key, 'make_post', { photo: ASSET.id, caption: 'Come see it at Najmi Market' });
    expect(place.body.error).toMatch(/market or area/);
    const figure = await call(key, 'make_post', { photo: ASSET.id, headline: 'Only 22K, just 3g' });
    expect(figure.body.error).toMatch(/didn't give/);
    expect(Object.keys(fake.col('designs'))).toHaveLength(0);
  });
});

describe('a money write by an AI', () => {
  it('is the app’s own shared write, logged under the key, recorded once', async () => {
    const key = await keyWith(['write:money', 'read']);
    const r = await call(key, 'record_payment', { invoiceId: 'INV-000001', amount: 40_000, method: 'Cash', request_id: 'pay-1' });
    expect(r.status).toBe(200);
    expect(recordInvoicePayment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ invoiceId: 'INV-000001', amount: 40_000, method: 'Cash', requestId: expect.stringMatching(/^ai-[a-f0-9]{16}-pay-1$/) }), expect.anything());
    expect(fake.col('invoices')['INV-000001']).toMatchObject({ amountPaid: 40_000, balanceDue: 60_000 });
    // The same request again is the first answer, not a second payment.
    await call(key, 'record_payment', { invoiceId: 'INV-000001', amount: 40_000, method: 'Cash', request_id: 'pay-1' });
    expect(fake.col('invoices')['INV-000001']).toMatchObject({ amountPaid: 40_000 });
    const log = Object.values(fake.col('activity_log')).filter(l => l.via === 'ai:ChatGPT');
    expect(log.length).toBeGreaterThan(0);
    expect(log.every(l => String(l.details).endsWith('via ChatGPT'))).toBe(true);
    // The payment alert the phone would post is run by the server.
    expect(alertSent).toHaveBeenCalledWith(expect.objectContaining({ event: 'payment', id: 'INV-000001' }), 'ai:ChatGPT');

    // …the same as the iPhone app's /api/app/write takes it.
    const res = await appWrite(new NextRequest('https://erp.example/api/app/write', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-email': 'owner@example.com' },
      body: JSON.stringify({ op: 'recordPayment', invoiceId: 'INV-000001', amount: 10_000, method: 'Cash', requestId: 'req-app-000001' }),
    }));
    expect(res.status).toBe(200);
    expect(fake.col('invoices')['INV-000001']).toMatchObject({ amountPaid: 50_000, balanceDue: 50_000 });
  });

  it('refuses a delete without the delete code', async () => {
    const key = await keyWith(['write:money']);
    const r = await call(key, 'delete_invoice', { invoiceId: 'INV-000001' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/^delete_code/);
  });
});
