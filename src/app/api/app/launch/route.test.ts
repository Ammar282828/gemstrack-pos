import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let email: string | null = 'owner@example.com';
const add = vi.fn();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: (c: string) => ({ add: (d: unknown) => add(c, d) }) } }));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async () => email }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string) => (e.startsWith('owner') ? 'owner' : e.startsWith('staff') ? 'staff' : null) }));

import { POST } from './route';

const call = (body: unknown) => POST(new NextRequest('http://localhost/api/app/launch', { method: 'POST', body: JSON.stringify(body) }));
const good = { marks: [{ step: 'main', ms: 300, detail: '' }, { step: 'ready:home', ms: 1800, detail: 'x' }], business: 'taheri', build: '1.0 (5)', device: 'iPhone16,1' };

describe('/api/app/launch', () => {
  beforeEach(() => { email = 'owner@example.com'; add.mockClear(); });

  it('turns away the signed-out and strangers, writing nothing', async () => {
    email = null;
    expect((await call(good)).status).toBe(401);
    email = 'stranger@example.com';
    expect((await call(good)).status).toBe(403);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses a body without marks', async () => {
    expect((await call({ ...good, marks: [] })).status).toBe(400);
    expect((await call({ ...good, marks: [{ step: 5 }] })).status).toBe(400);
    expect((await call({ business: 'x' })).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('saves the launch with its total, clamped', async () => {
    email = 'staff@example.com';
    const marks = Array.from({ length: 120 }, (_, i) => ({ step: 's'.repeat(100), ms: i === 79 ? 9e12 : i, detail: 'd'.repeat(500) }));
    expect((await call({ ...good, marks, device: 'd'.repeat(99) })).status).toBe(200);
    const [col, doc] = add.mock.calls[0];
    expect(col).toBe('app_launches');
    expect(doc.email).toBe('staff@example.com');
    expect(doc.marks).toHaveLength(80);
    expect(doc.marks[0].step).toHaveLength(60);
    expect(doc.marks[0].detail).toHaveLength(120);
    expect(doc.totalMs).toBe(3_600_000);
    expect(doc.device).toHaveLength(40);
  });
});
