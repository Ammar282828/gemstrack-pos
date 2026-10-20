/** Android and iPhone side by side: tokens, and each platform sent by its own service (lib/push/send.ts). */
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendApns } from './apns';
import { pushToShop } from './send';
import { isDeviceToken } from './gate';
import * as store from './store';
import { sendFcm } from './fcm';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: { collection: () => ({ doc: () => ({ create: async () => undefined }) }) } }));
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string) => (e.startsWith('owner') ? 'owner' : 'staff') }));
vi.mock('./store', async (orig) => ({ ...(await orig<typeof import('./store')>()), allDevices: vi.fn(), forgetDevices: vi.fn(async () => undefined), loadApnsKey: vi.fn() }));
vi.mock('./apns', async (orig) => ({ ...(await orig<typeof import('./apns')>()), sendApns: vi.fn() }));
vi.mock('./fcm', () => ({ sendFcm: vi.fn() }));

const pem = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const FCM = 'f' + 'Abc_123:APA91b'.repeat(12); // 169 printable characters
const APNS = 'ab12'.repeat(16);
const dev = (token: string, platform?: 'android' | 'ios', extra = {}) =>
  ({ token, platform, bundleId: 'shop.taheri.erp', email: 'owner@x.com', off: [], label: '', createdAt: '', updatedAt: '', ...extra });
const key = { p8: pem, keyId: 'ABCDE12345', teamId: 'TND272ULB5' };

describe('device tokens', () => {
  it('keeps the APNs hex check for iOS', () => {
    expect(isDeviceToken(APNS, 'ios')).toBe(true);
    expect(isDeviceToken(FCM, 'ios')).toBe(false);
    expect(isDeviceToken('zz'.repeat(40), 'ios')).toBe(false);
  });
  it('takes an FCM token for Android: printable, no spaces, 100 to 4096', () => {
    expect(isDeviceToken(FCM, 'android')).toBe(true);
    expect(isDeviceToken('a'.repeat(99), 'android')).toBe(false);
    expect(isDeviceToken('a'.repeat(4097), 'android')).toBe(false);
    expect(isDeviceToken(`${FCM} x`, 'android')).toBe(false);
    expect(isDeviceToken(APNS, 'android')).toBe(false);
    expect(isDeviceToken(42, 'android')).toBe(false);
  });
  it('takes either kind when no platform is named', () => {
    expect(isDeviceToken(APNS)).toBe(true);
    expect(isDeviceToken(FCM)).toBe(true);
    expect(isDeviceToken('nope')).toBe(false);
  });
});

describe('who a notification goes to', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.mocked(sendApns).mockResolvedValue({ sent: 1, gone: [], failed: [] });
    vi.mocked(sendFcm).mockResolvedValue({ sent: 1, gone: [], failed: [] });
  });
  const m = { kind: 'sales' as const, title: 'Sale', body: 'INV-1', url: '/invoices/INV-1' };

  it('sends each platform by its own service, and an absent platform is iOS', async () => {
    vi.mocked(store.loadApnsKey).mockResolvedValue(key);
    vi.mocked(store.allDevices).mockResolvedValue([dev(APNS), dev(FCM, 'android', { bundleId: 'store.houseofmina.erp' })]);
    const r = await pushToShop(m);
    expect(r).toMatchObject({ status: 'sent', sent: 2, phones: 2 });
    expect(vi.mocked(sendApns).mock.calls[0][1]).toEqual([{ token: APNS, bundleId: 'shop.taheri.erp' }]);
    expect(vi.mocked(sendFcm).mock.calls[0]).toEqual([[FCM], expect.objectContaining({ title: 'Sale', body: 'INV-1', url: '/invoices/INV-1', kind: 'sales', business: 'taheri' })]);
  });
  it('still sends to Android when no Apple key is set', async () => {
    vi.mocked(store.loadApnsKey).mockResolvedValue(null);
    vi.mocked(store.allDevices).mockResolvedValue([dev(FCM, 'android')]);
    expect(await pushToShop(m)).toMatchObject({ status: 'sent', sent: 1 });
    expect(sendApns).not.toHaveBeenCalled();
  });
  it('says no-key only when there are iPhones, no Android phones and no key', async () => {
    vi.mocked(store.loadApnsKey).mockResolvedValue(null);
    vi.mocked(store.allDevices).mockResolvedValue([dev(APNS)]);
    expect(await pushToShop(m)).toEqual({ status: 'no-key' });
    vi.mocked(store.allDevices).mockResolvedValue([dev(APNS), dev(FCM, 'android')]);
    expect(await pushToShop(m)).toMatchObject({ status: 'sent', sent: 1 });
    expect(sendApns).not.toHaveBeenCalled();
  });
  it('keeps to owners and kinds switched on, for both platforms', async () => {
    vi.mocked(store.loadApnsKey).mockResolvedValue(key);
    vi.mocked(store.allDevices).mockResolvedValue([
      dev(FCM, 'android', { email: 'staff@x.com' }), dev(FCM + '2', 'android', { off: ['sales'] }),
    ]);
    expect(await pushToShop(m)).toEqual({ status: 'none', phones: 0 });
    expect(sendFcm).not.toHaveBeenCalled();
  });
  it('forgets the tokens either service says are gone', async () => {
    vi.mocked(store.loadApnsKey).mockResolvedValue(key);
    vi.mocked(store.allDevices).mockResolvedValue([dev(APNS), dev(FCM, 'android')]);
    vi.mocked(sendApns).mockResolvedValue({ sent: 0, gone: [APNS], failed: [] });
    vi.mocked(sendFcm).mockResolvedValue({ sent: 0, gone: [FCM], failed: [] });
    const r = await pushToShop(m);
    expect(store.forgetDevices).toHaveBeenCalledWith([APNS, FCM]);
    expect(r.status).toBe('failed');
  });
  it('sends a test to an Android token alone', async () => {
    vi.mocked(store.loadApnsKey).mockResolvedValue(null);
    vi.mocked(store.allDevices).mockResolvedValue([dev(APNS), dev(FCM, 'android')]);
    await pushToShop(m, { token: FCM });
    expect(vi.mocked(sendFcm).mock.calls[0][0]).toEqual([FCM]);
    expect(sendApns).not.toHaveBeenCalled();
  });
  it('never throws', async () => {
    vi.mocked(store.loadApnsKey).mockResolvedValue(key);
    vi.mocked(store.allDevices).mockResolvedValue([dev(FCM, 'android')]);
    vi.mocked(sendFcm).mockRejectedValue(new Error('boom'));
    expect(await pushToShop(m)).toEqual({ status: 'failed', error: 'boom' });
  });
});
