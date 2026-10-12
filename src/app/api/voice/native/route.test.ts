import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The route's gates and its book cache; the book, the listener and the planner are stand-ins. All data made up.
let email: string | null = 'owner@example.com';
let role = 'owner';
const reads = vi.fn();

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: () => ({
      get: async () => { reads(); return { docs: [] }; },
      doc: () => ({ get: async () => ({ data: () => ({ shopName: 'Test shop' }) }) }),
    }),
  },
}));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async () => email }));
vi.mock('@/lib/roles', () => ({ roleForEmail: () => role }));
vi.mock('@/lib/nav', () => ({ paletteFor: () => [] }));
vi.mock('@/lib/voice/documents', () => ({ documentsFor: () => [] }));
vi.mock('@/lib/voice/native-plan', () => ({ nativeVoicePlan: async () => ({ ops: [] }) }));
vi.mock('../listen/route', () => ({ POST: async () => Response.json({ ok: true }) }));

import { POST } from './route';

const call = (body: unknown) => POST(new NextRequest('http://localhost/api/voice/native', { method: 'POST', body: JSON.stringify(body) }));

describe('/api/voice/native', () => {
  beforeEach(() => { email = 'owner@example.com'; role = 'owner'; reads.mockClear(); });

  it('turns away the signed-out and anyone who is not an owner, before reading anything', async () => {
    email = null;
    expect((await call({ text: 'hello' })).status).toBe(401);
    email = 'staff@example.com'; role = 'staff';
    expect((await call({ text: 'hello' })).status).toBe(403);
    expect(reads).not.toHaveBeenCalled();
  });

  it('refuses an empty or oversized sentence', async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ text: 'x'.repeat(4001) })).status).toBe(400);
    expect((await call({ audio: 'x'.repeat(12_000_001) })).status).toBe(400);
    expect(reads).not.toHaveBeenCalled();
  });

  it('reads the book once for requests within the cache window', async () => {
    expect((await call({ text: 'first' })).status).toBe(200);
    const afterFirst = reads.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    expect((await call({ text: 'second' })).status).toBe(200);
    expect(reads.mock.calls.length).toBe(afterFirst);
  });
});
