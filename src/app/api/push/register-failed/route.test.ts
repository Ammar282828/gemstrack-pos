import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let email: string | null = 'owner@example.com';
const set = vi.fn();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: (c: string) => ({ doc: (id: string) => ({ set: (d: unknown, o: unknown) => set(c, id, d, o) }) }) } }));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async () => email }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string) => (e.startsWith('owner') ? 'owner' : e.startsWith('staff') ? 'staff' : null) }));

import { POST } from './route';

const call = (body: unknown) => POST(new NextRequest('http://localhost/api/push/register-failed', { method: 'POST', body: JSON.stringify(body) }));
const good = { bundleId: 'shop.taheri.erp', label: 'iPhone', error: 'no aps-environment entitlement' };

describe('/api/push/register-failed', () => {
  beforeEach(() => { email = 'owner@example.com'; set.mockClear(); });

  it('turns away the signed-out and strangers, writing nothing', async () => {
    email = null;
    expect((await call(good)).status).toBe(401);
    email = 'stranger@example.com';
    expect((await call(good)).status).toBe(403);
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses a report without a bundle ID or an error', async () => {
    expect((await call({ ...good, bundleId: 'nope' })).status).toBe(400);
    expect((await call({ ...good, error: '  ' })).status).toBe(400);
    expect((await call({ ...good, error: 5 })).status).toBe(400);
    expect(set).not.toHaveBeenCalled();
  });

  it('keeps the last error per person and app, trimmed, without an address in the document name', async () => {
    email = 'staff@example.com';
    expect((await call({ ...good, error: 'x'.repeat(500) })).status).toBe(200);
    const [col, id, doc, opts] = set.mock.calls[0];
    expect(col).toBe('push_devices_failed');
    expect(id).toMatch(/_shop\.taheri\.erp$/);
    expect(id).not.toContain('staff');
    expect(doc.error).toHaveLength(300);
    expect(opts).toEqual({ merge: true });
  });
});
