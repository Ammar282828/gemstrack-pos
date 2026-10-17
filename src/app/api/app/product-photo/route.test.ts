import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import sharp from 'sharp';

// The phone's photo of a piece. All data made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const saved: { path: string; bytes: number; options: Record<string, unknown> }[] = [];
const logs: Record<string, unknown>[] = [];

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (id: string) => ({ get: async () => ({ exists: !!col(c)[id], data: () => col(c)[id] }) }),
      add: async (d: Record<string, unknown>) => { logs.push(d); return { id: 'log1' }; },
    }),
  },
  adminBucket: () => ({
    name: 'demo-bucket.firebasestorage.app',
    file: (path: string) => ({
      save: async (buf: Buffer, options: Record<string, unknown>) => { saved.push({ path, bytes: buf.length, options }); },
    }),
  }),
}));
vi.mock('@/lib/db-admin-port', () => ({
  adminPort: {
    get: async (c: string, id: string) => (col(c)[id] ? { ...col(c)[id], id } : null),
    batch: () => {
      const writes: (() => void)[] = [];
      return {
        set: (c: string, id: string, d: Record<string, unknown>) => writes.push(() => { col(c)[id] = { ...col(c)[id], ...d }; }),
        commit: async () => writes.forEach((w) => w()),
      };
    },
  },
}));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : 'staff') }));

const { POST } = await import('./route');
const OWNER = 'owner@example.com';

const req = (who: string | null, fields: Record<string, string | File>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new NextRequest('https://erp.example.com/api/app/product-photo', {
    method: 'POST', headers: who ? { 'x-test-email': who } : {}, body: form,
  });
};

const photo = async (w: number, h: number, name = 'Demo Ring.png') => {
  const png = await sharp({ create: { width: w, height: h, channels: 3, background: '#c08040' } }).png().toBuffer();
  return new File([new Uint8Array(png)], name, { type: 'image/png' });
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  saved.length = 0;
  logs.length = 0;
  col('products')['RIN-000005'] = { name: 'Demo ring', imageUrl: 'https://example.com/old.jpg', metalWeightG: 4.2 };
});

describe('/api/app/product-photo', () => {
  it('owners only', async () => {
    expect((await POST(req(null, { sku: 'RIN-000005', remove: '1' }))).status).toBe(401);
    expect((await POST(req('staff@example.com', { sku: 'RIN-000005', remove: '1' }))).status).toBe(403);
  });

  it('stores the photo as the web does and saves its download address on the piece', async () => {
    const res = await POST(req(OWNER, { sku: 'RIN-000005', file: await photo(3000, 1500) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(saved).toHaveLength(1);
    expect(saved[0].path).toMatch(/^product_images\/\d+-Demo-Ring\.jpg$/);
    const token = (saved[0].options.metadata as { metadata: { firebaseStorageDownloadTokens: string } }).metadata.firebaseStorageDownloadTokens;
    expect(body.imageUrl).toBe(`https://firebasestorage.googleapis.com/v0/b/demo-bucket.firebasestorage.app/o/${encodeURIComponent(saved[0].path)}?alt=media&token=${token}`);
    expect(col('products')['RIN-000005']).toMatchObject({ imageUrl: body.imageUrl, metalWeightG: 4.2 });
    expect(logs[0]).toMatchObject({ action: 'product.update', title: 'Changed the photo of Demo ring', by: OWNER, via: 'iphone-app' });
  });

  it('takes a photo off without uploading anything', async () => {
    const res = await POST(req(OWNER, { sku: 'RIN-000005', remove: '1' }));
    expect(res.status).toBe(200);
    expect(saved).toHaveLength(0);
    expect(col('products')['RIN-000005'].imageUrl).toBe('');
  });

  it('refuses a sold piece before storing anything, and a locked database', async () => {
    col('sold_products')['RIN-000009'] = { name: 'Demo sold ring' };
    const sold = await POST(req(OWNER, { sku: 'RIN-000009', file: await photo(10, 10) }));
    expect(sold.status).toBe(409);
    expect((await sold.json()).error).toMatch(/sold/);
    expect(saved).toHaveLength(0);
    col('app_settings').global = { databaseLocked: true };
    expect((await POST(req(OWNER, { sku: 'RIN-000005', remove: '1' }))).status).toBe(423);
  });

  it('refuses what is not a photograph', async () => {
    const res = await POST(req(OWNER, { sku: 'RIN-000005', file: new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }) }));
    expect(res.status).toBe(415);
    expect((await POST(req(OWNER, { sku: 'RIN-000005' }))).status).toBe(400);
  });
});
