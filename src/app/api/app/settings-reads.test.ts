import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The read routes of the phone's Settings: /api/app/imports, /api/app/labels, /api/app/backup. All data made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
let countFails = '';

vi.mock('@/lib/firebase-admin', () => {
  const docsOf = (c: string) => Object.entries(col(c)).map(([id, d]) => ({ id, data: () => d }));
  return {
    adminDb: {
      collection: (c: string) => ({
        get: async () => ({ docs: docsOf(c), forEach: (f: (d: { id: string; data: () => unknown }) => void) => docsOf(c).forEach(f) }),
        select: () => ({ get: async () => ({ docs: docsOf(c) }) }),
        doc: (id: string) => ({ get: async () => ({ exists: !!col(c)[id], data: () => col(c)[id] }) }),
        count: () => ({ get: async () => { if (c === countFails) throw new Error('no'); return { data: () => ({ count: Object.keys(col(c)).length }) }; } }),
      }),
    },
  };
});
vi.mock('@/lib/db-admin-port', () => ({ adminPort: {} }));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : 'staff') }));
vi.mock('@/lib/people', () => ({ personFor: () => undefined }));
vi.mock('@/lib/delete-code-gate', () => ({ passDeleteCode: async () => ({ ok: false, status: 403, error: 'Wrong code.' }) }));

const imports = await import('./imports/route');
const labels = await import('./labels/route');
const backup = await import('./backup/route');

const req = (url: string, who: string | null, body?: unknown) => new NextRequest(`https://erp.example.com${url}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { ...(who ? { 'x-test-email': who } : {}), 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const OWNER = 'owner@example.com';

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  countFails = '';
});

describe('who may read them', () => {
  it('owners only', async () => {
    expect((await imports.POST(req('/api/app/imports', null, { kind: 'hisaab', csv: 'x' }))).status).toBe(401);
    expect((await imports.POST(req('/api/app/imports', 'staff@example.com', { kind: 'hisaab', csv: 'x' }))).status).toBe(403);
    expect((await labels.GET(req('/api/app/labels', 'staff@example.com'))).status).toBe(403);
    expect((await backup.GET(req('/api/app/backup', 'staff@example.com'))).status).toBe(403);
  });
});

describe('/api/app/imports', () => {
  it('plans a contacts file against the live book, with the page\'s starting answers and the fingerprint', async () => {
    col('customers')['cust-1'] = { name: 'Demo Same', phone: '+923009990002' };
    col('customers')['cust-2'] = { name: 'Demo Gone', phone: '+923001110001', deletedAt: '2026-10-01T00:00:00.000Z' };
    const vcf = ['BEGIN:VCARD', 'FN:Demo Same TJ', 'TEL:0300 1110002', 'END:VCARD', 'BEGIN:VCARD', 'FN:Demo Gone TJ', 'TEL:0300 1110001', 'END:VCARD'].join('\n');
    const res = await imports.POST(req('/api/app/imports', OWNER, { kind: 'contacts', vcf }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.plan.conflicts.map((c: { name: string }) => c.name)).toEqual(['Demo Same']);
    // A removed customer is not in the book the import compares against.
    expect(body.plan.fresh.map((c: { name: string }) => c.name)).toEqual(['Demo Gone']);
    expect(body.defaults).toEqual({ [body.plan.conflicts[0].id]: 'add_phone' });
    expect(body.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(data.app_requests).toBeUndefined();
  });

  it('reads a hisaab file and says what stops it, or refuses one that does not read', async () => {
    const ok = await imports.POST(req('/api/app/imports', OWNER, { kind: 'hisaab', csv: 'Date,Details,Cash IN,Cash OUT\n01/10/2026,x,10,\nsoon,y,0,0' }));
    const body = await ok.json();
    expect(body.rows).toHaveLength(2);
    expect(body.refusal).toBe('There are 1 rows with invalid dates or zero amounts. Please correct the file and re-upload.');
    const wrong = await imports.POST(req('/api/app/imports', OWNER, { kind: 'hisaab', csv: 'Date,Amount\n1,2' }));
    expect(wrong.status).toBe(400);
    expect((await imports.POST(req('/api/app/imports', OWNER, { kind: 'contacts', vcf: 'not one' }))).status).toBe(400);
    expect((await imports.POST(req('/api/app/imports', OWNER, { kind: 'stock' }))).status).toBe(400);
  });
});

describe('/api/app/labels', () => {
  it('gives the standard tag', async () => {
    const body = await (await labels.GET(req('/api/app/labels', OWNER))).json();
    expect(body.standard.id).toBe('zebra-2000t-jewellery');
  });

  it('makes a piece\'s CSV with the byte-order mark and the page\'s file name', async () => {
    col('products')['RIN-000101'] = { name: 'Demo ring', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 2, hasStones: false, stoneWeightG: 0,
      hasDiamonds: false, diamondCharges: 0, makingCharges: 1000, stoneCharges: 0, miscCharges: 0, wastagePercentage: 5 };
    col('app_settings').global = { shopName: 'Demo Shop', goldRatePerGram21k: 26000 };
    const res = await labels.POST(req('/api/app/labels', OWNER, { sku: 'RIN-000101' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(/gemstrack_double_tag_export_.*\.csv/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes).split('\n')[1].startsWith('RIN-000101,Demo ring,cat001,Demo Shop,')).toBe(true);
    expect((await labels.POST(req('/api/app/labels', OWNER, { sku: 'RIN-000999' }))).status).toBe(404);
  });
});

describe('/api/app/backup', () => {
  it('lists what it copies with counts, an unreadable one as -1, and the file name', async () => {
    col('customers').c1 = { name: 'A' };
    col('customers').c2 = { name: 'B' };
    countFails = 'hisaab';
    const body = await (await backup.GET(req('/api/app/backup', OWNER))).json();
    expect(body.collections).toHaveLength(13);
    expect(body.collections.find((c: { id: string }) => c.id === 'customers')).toEqual({ id: 'customers', label: 'Customers', description: 'Customer contact details', count: 2 });
    expect(body.collections.find((c: { id: string }) => c.id === 'hisaab').count).toBe(-1);
    expect(body.fileName).toMatch(/^gemstrack-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  });

  it('gives one collection as the page writes it, and nothing outside the list', async () => {
    col('customers').c1 = { name: 'A', at: { seconds: 1, nanoseconds: 2, toDate: () => new Date(0) } };
    const res = await backup.GET(req('/api/app/backup?collection=customers', OWNER));
    expect(await res.json()).toEqual({ c1: { name: 'A', at: { seconds: 1, nanoseconds: 2 } } });
    expect((await backup.GET(req('/api/app/backup?collection=app_private', OWNER))).status).toBe(400);
  });
});
