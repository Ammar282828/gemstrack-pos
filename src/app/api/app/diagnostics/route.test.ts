import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let email: string | null = 'owner@example.com';
const add = vi.fn();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: (c: string) => ({ add: (d: unknown) => add(c, d) }) } }));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async () => email }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string) => (e.startsWith('owner') ? 'owner' : e.startsWith('staff') ? 'staff' : null) }));

import { POST } from './route';

const call = (body: unknown) => POST(new NextRequest('http://localhost/api/app/diagnostics', { method: 'POST', body: JSON.stringify(body) }));
const good = { business: 'taheri', build: '2.2 (7)', reports: [{ kind: 'hang', appVersion: '7', osVersion: 'iOS 26.0', device: 'iPhone16,1', durationMs: 2500.4, frames: ['ERP+1234', 'UIKitCore+99'] }] };

describe('/api/app/diagnostics', () => {
  beforeEach(() => { email = 'owner@example.com'; add.mockClear(); });

  it('turns away the signed-out and strangers, writing nothing', async () => {
    email = null;
    expect((await call(good)).status).toBe(401);
    email = 'stranger@example.com';
    expect((await call(good)).status).toBe(403);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses a body without a known report', async () => {
    expect((await call({ reports: [] })).status).toBe(400);
    expect((await call({ reports: [{ kind: 'other' }] })).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('saves clipped, signature-only reports for staff', async () => {
    email = 'staff@example.com';
    const reports = Array.from({ length: 30 }, () => ({ kind: 'crash', signal: 11, frames: Array.from({ length: 40 }, () => 'x'.repeat(300)), terminationReason: 'r'.repeat(999), name: 'Customer Name' }));
    expect((await call({ ...good, reports })).status).toBe(200);
    const [col, doc] = add.mock.calls[0];
    expect(col).toBe('app_diagnostics');
    expect(doc.email).toBe('staff@example.com');
    expect(doc.reports).toHaveLength(20);
    expect(doc.reports[0].frames).toHaveLength(16);
    expect(doc.reports[0].frames[0]).toHaveLength(120);
    expect(doc.reports[0].terminationReason).toHaveLength(200);
    expect(doc.reports[0].signal).toBe(11);
    expect(doc.reports[0]).not.toHaveProperty('name');
  });

  it('rounds a duration', async () => {
    await call(good);
    expect(add.mock.calls[0][1].reports[0].durationMs).toBe(2500);
  });
});
