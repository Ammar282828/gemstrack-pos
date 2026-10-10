import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Made-up accounts and site only.
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({
  roleForEmail: (e: string | null) => (e === 'staff@example.com' ? 'staff' : e === 'karigar@example.com' ? 'none' : 'owner'),
}));
vi.mock('@/lib/store-config', () => ({
  STORE_LINKS: { website: 'https://www.example.shop/' },
  STORE_WEBSITE_FEATURED: false,
  STORE_WEBSITE_WEIGHTS: true,
  STORE_SITE_EDIT: true,
  STORE_INVESTMENTS: false,
  STORE_POST_METAL: 'Silver', STORE_POST_TAGLINE: 'A sample house', STORE_POST_FOOTER: 'Made for you', STORE_WHATSAPP_NUMBERS: ['123456789'],
}));

const { GET } = await import('./route');

const call = async (email: string | null) => {
  const res = await GET(new NextRequest('https://erp.example.com/api/app/website', { headers: email ? { 'x-test-email': email } : {} }));
  return { status: res.status, json: await res.json() };
};

describe('/api/app/website', () => {
  it('the house’s website and which of its screens it has', async () => {
    expect(await call('staff@example.com')).toEqual({
      status: 200,
      json: { site: 'https://www.example.shop', siteName: 'example.shop', posting: { metal: 'Silver', tagline: 'A sample house', footer: 'Made for you', whatsappNumbers: ['123456789'], links: { website: 'https://www.example.shop/' } }, featured: false, weights: true, edit: true, investments: false },
    });
  });

  it('shop accounts only', async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call('karigar@example.com')).status).toBe(403);
  });
});
