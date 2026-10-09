import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbPort, TxCtx } from '@/lib/db-port';
import type { OpContext } from './op-context';

// One in-memory database behind both the Admin SDK and the port. All names, numbers and amounts made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const put = (c: string, id: string, d: Record<string, unknown>, merge?: boolean) => { col(c)[id] = merge ? { ...col(c)[id], ...d } : { ...d }; };
let commits = 0;

vi.mock('@/lib/firebase-admin', () => {
  const docsOf = (c: string) => Object.entries(col(c)).map(([id, d]) => ({ id, data: () => d }));
  return {
    adminDb: {
      collection: (c: string) => ({
        get: async () => ({ docs: docsOf(c) }),
        select: () => ({ get: async () => ({ docs: docsOf(c) }) }),
      }),
    },
  };
});

const port: DbPort = {
  async runTransaction(fn) {
    const writes: (() => void)[] = [];
    const tx: TxCtx = {
      async get(c, id) { const d = col(c)[id]; return d ? ({ ...structuredClone(d), id } as never) : null; },
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    return out;
  },
  async queryEquals() { return []; },
  async get(c, id) { const d = col(c)[id]; return d ? ({ ...d, id } as never) : null; },
  async add() { return 'x'; },
  async update(c, id, d) { put(c, id, d, true); },
  batch() {
    const writes: (() => void)[] = [];
    return {
      set(c, id, d, merge) { writes.push(() => put(c, id, d, merge)); },
      update(c, id, d) { writes.push(() => put(c, id, d, true)); },
      delete(c, id) { writes.push(() => { delete col(c)[id]; }); },
      async commit() { commits++; writes.forEach((w) => w()); },
    };
  },
  newId: () => 'n1',
  timestamp: (d) => d.toISOString(),
  serverTime: () => 'now',
};

// The house's delete code is "4321" here.
const codeChecks: string[] = [];
vi.mock('@/lib/db-admin-port', () => ({ adminPort: port }));
vi.mock('@/lib/people', () => ({ personFor: () => 'Demo Owner' }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_email: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { SETTINGS2_OPS, runSettings2Op } = await import('./ops-settings2');
const { planImport, toExistingRows } = await import('@/lib/contacts/triage');
const { planFingerprint } = await import('@/lib/contacts/import-run');

let logged: string[][] = [];
const ctx = (): OpContext => ({
  email: 'owner@example.com',
  log: async (a, t, d, ref) => { logged.push([a, t, d, ref ?? '']); },
  alert: () => undefined,
  followUps: [],
});

const run = async (op: string, body: Record<string, unknown>) => {
  const res = await runSettings2Op(op, { op, ...body }, ctx());
  return res ? { status: res.status, body: await res.json() as Record<string, unknown> } : null;
};

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  logged = [];
  commits = 0;
  codeChecks.length = 0;
});

describe('who may run the settings operations', () => {
  it('owners only, as the pages are', () => {
    expect(SETTINGS2_OPS).toEqual({
      forgetVoiceAlias: ['owner'], saveLabelLayout: ['owner'], reAddSoldProduct: ['owner'],
      deleteLatestProducts: ['owner'], importContacts: ['owner'], importHisaab: ['owner'],
    });
  });

  it('leaves an operation that is not its own to the next group', async () => {
    expect(await runSettings2Op('addExpense', {}, ctx())).toBeNull();
  });
});

describe('forgetVoiceAlias', () => {
  it('deletes the name and says what it was, with no code and no log', async () => {
    put('voice_aliases', 'va1', { heard: 'demo khan', refName: 'Demo Khan', kind: 'customer', refId: 'cust-1', uses: 2 });
    const r = await run('forgetVoiceAlias', { aliasId: 'va1' });
    expect(r).toEqual({ status: 200, body: { ok: true, id: 'va1', heard: 'demo khan', refName: 'Demo Khan', followUps: [] } });
    expect(col('voice_aliases').va1).toBeUndefined();
    expect(codeChecks).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('says so when it was already forgotten, and asks which name for none', async () => {
    expect((await run('forgetVoiceAlias', { aliasId: 'gone' }))?.status).toBe(409);
    expect((await run('forgetVoiceAlias', { aliasId: 'a/b' }))?.status).toBe(400);
  });
});

describe('saveLabelLayout', () => {
  const layout = {
    id: 'zebra-2000t-jewellery', name: 'Demo tag', widthDots: 664, heightDots: 296,
    fields: [{ id: 'sku-left', type: 'text', x: 100, y: 150, data: 'SKU: {sku}', fontSize: 20, rotation: 90 }],
  };

  it('merges the checked layout into the settings and logs who', async () => {
    put('app_settings', 'global', { shopName: 'Demo Shop' });
    const r = await run('saveLabelLayout', { layout });
    expect(r?.status).toBe(200);
    expect(col('app_settings').global).toEqual({ shopName: 'Demo Shop', labelLayout: layout });
    expect(logged).toEqual([['settings.update', 'Label layout saved', 'Demo tag · 1 field(s) · by Demo Owner', '']]);
  });

  it('refuses a layout of the wrong shape and writes nothing', async () => {
    expect((await run('saveLabelLayout', { layout: { ...layout, fields: [{ ...layout.fields[0], rotation: 45 }] } }))?.status).toBe(400);
    expect(data.app_settings).toBeUndefined();
  });
});

describe('reAddSoldProduct', () => {
  it('makes a new piece from the sold one, numbered after the stock, and keeps the sold record', async () => {
    put('products', 'RIN-000004', { sku: 'RIN-000004', name: 'In stock', categoryId: 'cat001' });
    put('sold_products', 'RIN-000002', {
      sku: 'RIN-000002', name: 'Demo ring', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 3,
      imageUrl: 'https://example.com/r.jpg', qrCodeDataUrl: 'data:image/png;base64,AAAA',
    });
    const r = await run('reAddSoldProduct', { sku: 'RIN-000002' });
    expect(r?.status).toBe(200);
    expect((r?.body.product as { sku: string }).sku).toBe('RIN-000005');
    expect(col('products')['RIN-000005']).toEqual({
      sku: 'RIN-000005', name: 'Demo ring', categoryId: 'cat001', metalType: 'gold', karat: '21k', metalWeightG: 3, imageUrl: 'https://example.com/r.jpg',
      // addProduct's own rule: no diamonds, no diamond charge.
      diamondCharges: 0,
    });
    expect(col('sold_products')['RIN-000002']).toBeDefined();
    expect(logged[0][0]).toBe('product.create');
  });

  it('refuses a piece that was never sold', async () => {
    expect((await run('reAddSoldProduct', { sku: 'RIN-000099' }))?.status).toBe(409);
  });
});

describe('deleteLatestProducts', () => {
  beforeEach(() => {
    for (const sku of ['RIN-000001', 'RIN-000002', 'TOP-000001', 'BNG-000003']) put('products', sku, { sku, name: `Demo ${sku}` });
  });

  it('deletes the highest SKUs by their text, behind the delete code in the store\'s words', async () => {
    const r = await run('deleteLatestProducts', { count: 2, deleteCode: '4321' });
    expect(r?.body).toEqual({ ok: true, deleted: 2, followUps: [] });
    expect(Object.keys(col('products')).sort()).toEqual(['BNG-000003', 'RIN-000001']);
    expect(codeChecks).toEqual(['Delete the latest 2 products']);
    expect(logged.map((l) => l[1])).toEqual(['Deleted product: Demo TOP-000001', 'Deleted product: Demo RIN-000002']);
  });

  it('deletes nothing on a wrong code, and refuses a count that is not a positive whole number', async () => {
    expect((await run('deleteLatestProducts', { count: 2, deleteCode: '1111' }))?.status).toBe(403);
    expect(Object.keys(col('products'))).toHaveLength(4);
    for (const count of [0, -1, 1.5, '2', undefined]) expect((await run('deleteLatestProducts', { count, deleteCode: '4321' }))?.status).toBe(400);
  });
});

describe('importContacts', () => {
  const vcf = [
    'BEGIN:VCARD', 'FN:Demo Fresh TJ', 'TEL:0300 1110001', 'END:VCARD',
    'BEGIN:VCARD', 'FN:Demo Same HOM', 'TEL:0300 1110002', 'END:VCARD',
    'BEGIN:VCARD', 'FN:Ustad New Karigar', 'TEL:0300 1110005', 'END:VCARD',
  ].join('\n');

  beforeEach(() => {
    put('customers', 'cust-1', { id: 'cust-1', name: 'Demo Same', phone: '+923009990002' });
    put('customers', 'cust-2', { id: 'cust-2', name: 'Demo Fresh', phone: '+923001110001', deletedAt: '2026-10-01T00:00:00.000Z' });
  });

  // The plan the phone was shown: the book's live people, as /api/app/imports reads them.
  const shown = () => planImport(vcf, toExistingRows(
    Object.values(col('customers')).filter((c) => !c.deletedAt) as never, Object.values(col('karigars')) as never,
  ));

  it('runs the shown plan as answered, in one batch, and logs each change', async () => {
    const plan = shown();
    expect(plan.fresh.map((f) => f.name)).toEqual(['Demo Fresh', 'Ustad New']);
    const r = await run('importContacts', {
      vcf, fingerprint: planFingerprint(plan), dropped: [plan.fresh[1].id], choices: { [plan.conflicts[0].id]: 'add_phone' },
    });
    expect(r?.body).toEqual({ ok: true, added: 1, updated: 1, settled: 0, followUps: [] });
    expect(commits).toBe(1);
    const made = Object.entries(col('customers')).filter(([id]) => !['cust-1', 'cust-2'].includes(id));
    expect(made).toHaveLength(1);
    expect(made[0][1]).toMatchObject({ name: 'Demo Fresh', phone: '+923001110001', email: '', address: '' });
    expect(col('customers')['cust-1'].altPhone).toBe('0300 1110002');
    expect(col('karigars')).toEqual({});
    expect(logged.map((l) => l[0])).toEqual(['customer.create', 'customer.update']);
  });

  it('refuses when the book has moved since the plan was shown, and writes nothing', async () => {
    const fingerprint = planFingerprint(shown());
    put('customers', 'cust-3', { id: 'cust-3', name: 'Ustad New', phone: '+923001110005' });
    const r = await run('importContacts', { vcf, fingerprint, choices: {} });
    expect(r?.status).toBe(409);
    expect(commits).toBe(0);
  });

  it('refuses a file that is not contacts, an answer a half-match does not offer, and nothing to do', async () => {
    expect((await run('importContacts', { vcf: 'name,phone' }))?.status).toBe(400);
    const plan = shown();
    const fingerprint = planFingerprint(plan);
    expect((await run('importContacts', { vcf, fingerprint, choices: { [plan.conflicts[0].id]: 'adopt_name' } }))?.status).toBe(400);
    expect((await run('importContacts', { vcf, fingerprint, dropped: plan.fresh.map((f) => f.id), choices: { [plan.conflicts[0].id]: 'skip' } }))?.body.error)
      .toBe('Nothing to add or resolve.');
    expect(commits).toBe(0);
  });
});

describe('importHisaab', () => {
  const csv = ['Date,Details,Cash IN,Cash OUT', '01/10/2026,Old advance,"10,000",', '02/10/2026,Old payment,,2500'].join('\n');

  beforeEach(() => {
    put('customers', 'cust-1', { id: 'cust-1', name: 'Demo Customer' });
    put('karigars', 'k-gone', { id: 'k-gone', name: 'Old Karigar', deletedAt: '2026-10-01T00:00:00.000Z' });
  });

  it('writes the rows for the person as the page does, and the same file again writes over its own rows', async () => {
    const r = await run('importHisaab', { csv, entityId: 'cust-1', entityType: 'customer' });
    expect(r?.body).toEqual({ ok: true, imported: 2, name: 'Demo Customer', followUps: [] });
    const rows = Object.entries(col('hisaab'));
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toMatch(/^import-[0-9a-f]{20}-0000$/);
    expect(rows[0][1]).toEqual({
      entityId: 'cust-1', entityType: 'customer', entityName: 'Demo Customer', date: '2026-09-30T19:00:00.000Z',
      description: 'Old advance', cashCredit: 10_000, cashDebit: 0, goldCreditGrams: 0, goldDebitGrams: 0,
    });
    expect(logged).toEqual([['hisaab.import', 'Imported hisaab for Demo Customer', '2 transaction(s) from a CSV · by Demo Owner', 'cust-1']]);

    await run('importHisaab', { csv, entityId: 'cust-1', entityType: 'customer' });
    expect(Object.keys(col('hisaab'))).toHaveLength(2);
  });

  it('writes nothing while any row is wrong, and refuses a person not on file', async () => {
    const wrong = await run('importHisaab', { csv: `${csv}\nsoon,Bad date,5,`, entityId: 'cust-1', entityType: 'customer' });
    expect(wrong?.body.error).toBe('There are 1 rows with invalid dates or zero amounts. Please correct the file and re-upload.');
    expect((await run('importHisaab', { csv, entityId: 'k-gone', entityType: 'karigar' }))?.status).toBe(409);
    expect((await run('importHisaab', { csv, entityId: 'cust-1', entityType: 'shop' }))?.status).toBe(400);
    expect((await run('importHisaab', { csv: 'Date,Details\n01/10/2026,x', entityId: 'cust-1', entityType: 'customer' }))?.body.error)
      .toBe('Missing required columns in CSV: Cash IN, Cash OUT. Please ensure your file has the correct headers.');
    expect(data.hisaab).toBeUndefined();
  });
});
