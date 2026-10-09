import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Made-up accounts only.
vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async (req: NextRequest) => req.headers.get('x-test-email') }));
vi.mock('@/lib/roles', () => ({
  roleForEmail: (e: string | null) => (e === 'owner@example.com' ? 'owner' : e === 'marketing@example.com' ? 'marketing' : 'none'),
}));

const { GET, POST } = await import('./route');

const get = async (folder: string, email: string | null = 'owner@example.com') => {
  const res = await GET(new NextRequest(`https://erp.example.com/api/website/photos/names?folder=${encodeURIComponent(folder)}`,
    { headers: email ? { 'x-test-email': email } : {} }));
  return { status: res.status, json: await res.json() };
};
const post = async (body: unknown, email: string | null = 'owner@example.com') => {
  const res = await POST(new NextRequest('https://erp.example.com/api/website/photos/names', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(email ? { 'x-test-email': email } : {}) },
  }));
  return { status: res.status, json: await res.json() };
};

describe('/api/website/photos/names', () => {
  it('says which collection names its photos by house, with the houses', async () => {
    const m = await get('Wristwear/The Maisons');
    expect(m.status).toBe(200);
    expect(m.json.maison).toBe(true);
    expect(m.json.houses).toContain('Cartier');
    expect((await get('Rings & Bands/Rings')).json.maison).toBe(false);
  });

  it('names a Maisons tray in order, numbering a second photo of a piece', async () => {
    const r = await post({ folder: 'Wristwear/The Maisons', items: [
      { house: 'Cartier', model: 'LOVE Bracelet', ext: 'heic' },
      { house: 'Cartier', model: 'LOVE Bracelet', ext: 'jpg' },
    ] }, 'marketing@example.com');
    expect(r).toEqual({ status: 200, json: { maison: true, names: ['Cartier — LOVE Bracelet.heic', 'Cartier — LOVE Bracelet 2.jpg'] } });
  });

  it('another collection keeps the photographs’ own names', async () => {
    expect(await post({ folder: 'Wristwear/Karay', items: [{ house: '', model: '' }] })).toEqual({ status: 200, json: { maison: false, names: null } });
  });

  it('refuses a Maisons photo with no house or name, and a tray with no collection', async () => {
    const r = await post({ folder: 'Wristwear/The Maisons', items: [{ house: 'Cartier', model: '' }] });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/still needs a house/);
    expect((await post({ items: [] })).status).toBe(400);
  });

  it('owner, staff and marketing accounts only', async () => {
    expect((await get('Wristwear/The Maisons', null)).status).toBe(401);
    expect((await get('Wristwear/The Maisons', 'someone@example.com')).status).toBe(403);
    expect((await post({ folder: 'Wristwear/The Maisons', items: [] }, 'someone@example.com')).status).toBe(403);
  });
});
