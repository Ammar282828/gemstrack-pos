import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The phone's Restore from a backup. All data made up.
const data: Record<string, Record<string, Record<string, unknown>>> = {};
const col = (c: string) => (data[c] ??= {});
const codeChecks: string[] = [];

vi.mock('@/lib/firebase-admin', () => {
  const ref = (c: string, id: string) => ({ c, id, get: async () => ({ exists: !!col(c)[id], data: () => col(c)[id] }) });
  return {
    adminDb: {
      collection: (c: string) => ({
        doc: (id: string) => ref(c, id),
        add: async (d: Record<string, unknown>) => { col(c)[`log${Object.keys(col(c)).length}`] = d; },
      }),
      batch: () => {
        const writes: (() => void)[] = [];
        return {
          set: (r: { c: string; id: string }, d: Record<string, unknown>, o?: { merge?: boolean }) => {
            writes.push(() => { col(r.c)[r.id] = o?.merge ? { ...col(r.c)[r.id], ...d } : { ...d }; });
          },
          commit: async () => writes.forEach((w) => w()),
        };
      },
    },
  };
});
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : 'staff') }));
vi.mock('@/lib/people', () => ({ personFor: () => 'Demo Owner' }));
vi.mock('@/lib/delete-code-gate', () => ({
  passDeleteCode: async (_e: string, code: unknown, what: string) => {
    codeChecks.push(what);
    return code === '4321' ? { ok: true } : { ok: false, status: 403, error: 'Wrong code.' };
  },
}));

const { POST } = await import('./route');

const req = (who: string | null, body: unknown) => new NextRequest('https://erp.example.com/api/app/backup/restore', {
  method: 'POST',
  headers: { ...(who ? { 'x-test-email': who } : {}), 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const OWNER = 'owner@example.com';

beforeEach(() => {
  for (const k of Object.keys(data)) delete data[k];
  codeChecks.length = 0;
});

describe('/api/app/backup/restore', () => {
  it('owners only, with the delete code', async () => {
    const body = { collection: 'customers', docs: { c1: { name: 'Demo' } }, deleteCode: '4321' };
    expect((await POST(req(null, body))).status).toBe(401);
    expect((await POST(req('staff@example.com', body))).status).toBe(403);
    expect((await POST(req(OWNER, { ...body, deleteCode: '1' }))).status).toBe(403);
    expect(data.customers).toBeUndefined();
  });

  it('refuses what a backup does not restore, before the code is asked', async () => {
    for (const body of [
      { collection: 'app_settings', docs: { global: {} } },
      { collection: 'customers', docs: {} },
      { collection: 'customers', docs: { 'a/b': {} } },
      { collection: 'customers', docs: { c1: 'x' } },
      { collection: 'customers', docs: Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`c${i}`, {}])) },
    ]) expect((await POST(req(OWNER, { ...body, deleteCode: '4321' }))).status).toBe(400);
    expect(codeChecks).toEqual([]);
  });

  it('holds to the owner\'s lock', async () => {
    col('app_settings').global = { databaseLocked: true };
    expect((await POST(req(OWNER, { collection: 'customers', docs: { c1: {} }, deleteCode: '4321' }))).status).toBe(423);
  });

  it('merges the slice into the live records and logs it', async () => {
    col('customers').c1 = { name: 'Demo Old', phone: '+923000000001' };
    const res = await POST(req(OWNER, { collection: 'customers', docs: { c1: { name: 'Demo One' }, c2: { name: 'Demo Two' } }, deleteCode: '4321', exportedAt: '2026-10-01T10:00:00.000Z', part: 1, parts: 2 }));
    expect(await res.json()).toEqual({ ok: true, collection: 'customers', written: 2 });
    expect(col('customers').c1).toEqual({ name: 'Demo One', phone: '+923000000001' });
    expect(col('customers').c2).toEqual({ name: 'Demo Two' });
    expect(codeChecks).toEqual(['Restore 2 Customers from a backup']);
    const log = Object.values(col('activity_log'))[0];
    expect(log).toMatchObject({ action: 'backup.restore', title: 'Restored 2 Customers from a backup', relatedId: 'customers' });
    expect(log.detail).toBe('Backup of 2026-10-01T10:00:00.000Z · part 1 of 2 · by Demo Owner');
  });
});
