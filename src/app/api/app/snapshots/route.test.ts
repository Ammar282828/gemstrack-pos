import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let email: string | null = 'owner@example.com';
const add = vi.fn();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: (c: string) => ({ add: (d: unknown) => add(c, d) }) } }));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async () => email }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string) => (e.startsWith('owner') ? 'owner' : e.startsWith('staff') ? 'staff' : null) }));

import { POST } from './route';

const call = (body: unknown) => POST(new NextRequest('http://localhost/api/app/snapshots', { method: 'POST', body: JSON.stringify(body) }));
const good = { run: '2026-10-25T20-00-00', n: 3, path: '/orders?list=late', title: 'Late', build: '2.2 (110)', width: 1320.4, height: 860, image: '/9j/4AAQSkZJRg==' };

describe('/api/app/snapshots', () => {
  beforeEach(() => { email = 'owner@example.com'; add.mockClear(); });

  it('takes pictures from owners only', async () => {
    email = null;
    expect((await call(good)).status).toBe(401);
    email = 'staff@example.com';
    expect((await call(good)).status).toBe(403);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses what is not a picture, or one too big for a document', async () => {
    expect((await call({ ...good, image: '' })).status).toBe(400);
    expect((await call({ ...good, run: '' })).status).toBe(400);
    expect((await call({ ...good, image: '<html>' })).status).toBe(400);
    expect((await call({ ...good, image: 'A'.repeat(950_001) })).status).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('keeps one picture per document, with where it was taken', async () => {
    expect((await call(good)).status).toBe(200);
    const [col, doc] = add.mock.calls[0];
    expect(col).toBe('app_snapshots');
    expect(doc).toMatchObject({ email: 'owner@example.com', run: good.run, n: 3, path: '/orders?list=late', title: 'Late', width: 1320, height: 860, image: good.image });
  });
});
