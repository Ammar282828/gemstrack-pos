import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { machinesJson } from '@/lib/machines/export';

vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
const { GET } = await import('./route');

describe('GET /api/app/machines', () => {
  it('needs a sign-in', async () => {
    expect((await GET(new NextRequest('https://x.example/api/app/machines'))).status).toBe(401);
  });
  it('answers the machines as the export has them', async () => {
    const res = await GET(new NextRequest('https://x.example/api/app/machines', { headers: { 'x-test-email': 'a@b.c' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(machinesJson());
  });
});
