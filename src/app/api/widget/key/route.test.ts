import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'node:crypto';

let email: string | null = 'owner@example.com';
let stored: { email: string } | null = { email: 'owner@example.com' };
const del = vi.fn();
const docId = vi.fn();
vi.mock('@/lib/firebase-admin', () => ({
  adminDb: { collection: () => ({ doc: (id: string) => { docId(id); return { get: async () => ({ exists: !!stored, data: () => stored }), delete: () => del(id) }; } }) },
}));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async () => email }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string) => (e.startsWith('owner') ? 'owner' : e.startsWith('staff') ? 'staff' : null) }));
vi.mock('@/lib/widget/server', () => ({ newWidgetKey: async () => 'k' }));

import { DELETE } from './route';

const key = 'a'.repeat(43);
const call = (body: unknown) => DELETE(new NextRequest('http://localhost/api/widget/key', { method: 'DELETE', body: JSON.stringify(body) }));

describe('DELETE /api/widget/key', () => {
  beforeEach(() => { email = 'owner@example.com'; stored = { email: 'owner@example.com' }; del.mockClear(); });

  it('refuses the signed-out and staff', async () => {
    email = null;
    expect((await call({ key })).status).toBe(401);
    email = 'staff@example.com';
    expect((await call({ key })).status).toBe(403);
    expect(del).not.toHaveBeenCalled();
  });

  it('refuses something that is not a key', async () => {
    expect((await call({ key: 'short' })).status).toBe(400);
    expect((await call({})).status).toBe(400);
  });

  it('deletes the owner\'s own key by its hash', async () => {
    expect((await call({ key })).status).toBe(200);
    expect(del).toHaveBeenCalledWith(crypto.createHash('sha256').update(key).digest('hex'));
  });

  it('will not delete another account\'s key, and an unknown key is fine', async () => {
    stored = { email: 'owner2@example.com' };
    expect((await call({ key })).status).toBe(403);
    stored = null;
    expect((await call({ key })).status).toBe(200);
    expect(del).not.toHaveBeenCalled();
  });
});
