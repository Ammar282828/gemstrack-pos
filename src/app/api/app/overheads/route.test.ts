import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { DEFAULT_OVERHEADS } from '@/lib/overheads';

// The settings document behind the Admin SDK. All names and amounts made up.
let settings: Record<string, unknown> | null = null;

vi.mock('@/lib/firebase-admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: c === 'app_settings' && id === 'global' && settings !== null, data: () => settings }),
      }),
    }),
  },
}));
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : e === 'staff@example.com' ? 'staff' : 'none') }));

const { GET } = await import('./route');

const call = async (email: string | null = 'owner@example.com') => {
  const res = await GET(new NextRequest('https://erp.example.com/api/app/overheads', { headers: email ? { 'x-test-email': email } : {} }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

beforeEach(() => { settings = null; });

describe('/api/app/overheads', () => {
  it('the saved plans, as the page reads them', async () => {
    const plans = [{ from: '2026-09', items: [{ id: 'rent', label: 'Rent', amount: 10_000 }] }];
    settings = { overheadPlans: plans, shopName: 'Demo Shop' };
    expect(await call()).toEqual({ status: 200, json: { start: '2026-09', plans, saved: true } });
  });

  it('the first-shape list from the start month, and the starting sheet when nothing is saved', async () => {
    settings = { monthlyOverheads: [{ id: 'a', label: 'Old line', amount: 5 }] };
    expect((await call()).json).toEqual({ start: '2026-09', plans: [{ from: '2026-09', items: [{ id: 'a', label: 'Old line', amount: 5 }] }], saved: false });
    settings = null;
    expect((await call()).json).toEqual({ start: '2026-09', plans: [{ from: '2026-09', items: DEFAULT_OVERHEADS }], saved: false });
  });

  it('owners only', async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call('staff@example.com')).status).toBe(403);
    expect((await call('someone@example.com')).status).toBe(403);
  });
});
