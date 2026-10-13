import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/karigar-auth', () => ({ verifyRequestEmail: async () => 'owner@x.com' }));
vi.mock('@/lib/roles', () => ({ roleForEmail: () => 'owner' }));
vi.mock('@/lib/push/store', () => ({
  PUSH_KINDS: ['sales', 'payments', 'orders', 'karigar'],
  saveDevice: vi.fn(),
  readDevice: vi.fn(), forgetDevices: vi.fn(),
}));

import { POST } from './route';
import { saveDevice } from '@/lib/push/store';

const FCM = 'f' + 'Abc_123:APA91b'.repeat(12);
const post = (body: unknown) => POST(new NextRequest('http://x/api/push/devices', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/push/devices', () => {
  beforeEach(() => { vi.mocked(saveDevice).mockReset(); vi.mocked(saveDevice).mockResolvedValue({ off: [] } as never); });

  it('registers an Android phone with its platform', async () => {
    const res = await post({ token: FCM, platform: 'android', bundleId: 'shop.taheri.erp', label: 'Pixel' });
    expect(res.status).toBe(200);
    expect(saveDevice).toHaveBeenCalledWith(expect.objectContaining({ token: FCM, platform: 'android', bundleId: 'shop.taheri.erp', email: 'owner@x.com' }));
  });
  it('treats a body without platform as iOS, which needs an APNs token', async () => {
    expect((await post({ token: 'ab12'.repeat(16), bundleId: 'shop.taheri.erp' })).status).toBe(200);
    expect(saveDevice).toHaveBeenCalledWith(expect.objectContaining({ platform: 'ios' }));
    expect((await post({ token: FCM, bundleId: 'shop.taheri.erp' })).status).toBe(400);
  });
  it('refuses an unknown platform or a short Android token', async () => {
    expect((await post({ token: FCM, platform: 'windows', bundleId: 'shop.taheri.erp' })).status).toBe(400);
    expect((await post({ token: 'short', platform: 'android', bundleId: 'shop.taheri.erp' })).status).toBe(400);
  });
});
