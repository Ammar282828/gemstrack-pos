import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEach = vi.fn();
vi.mock('firebase-admin/app', () => ({ getApp: () => ({}) }));
vi.mock('firebase-admin/messaging', () => ({ getMessaging: () => ({ sendEach }) }));
vi.mock('@/lib/firebase-admin', () => ({}));

import { sendFcm } from './fcm';

describe('what goes to FCM', () => {
  beforeEach(() => sendEach.mockReset());

  it('builds a high-priority message per token, the kind as channel', async () => {
    sendEach.mockResolvedValue({ responses: [{ success: true }] });
    const out = await sendFcm(['t1'], { title: 'Sale', body: 'INV-1', url: '/invoices/INV-1', kind: 'sales' });
    expect(out).toEqual({ sent: 1, gone: [], failed: [] });
    expect(sendEach).toHaveBeenCalledWith([{
      token: 't1',
      notification: { title: 'Sale', body: 'INV-1' },
      data: { url: '/invoices/INV-1', kind: 'sales' },
      android: { priority: 'high', notification: { channelId: 'sales' } },
    }]);
  });
  it('maps dead tokens to gone and the rest to failed', async () => {
    sendEach.mockResolvedValue({ responses: [
      { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      { success: false, error: { code: 'messaging/invalid-registration-token' } },
      { success: false, error: { code: 'messaging/internal-error' } },
      { success: true },
    ] });
    const out = await sendFcm(['a', 'b', 'c', 'd'], { title: 't', body: 'b', kind: 'orders' });
    expect(out).toEqual({ sent: 1, gone: ['a', 'b'], failed: [{ token: 'c', status: 0, reason: 'messaging/internal-error' }] });
  });
  it('sends nothing for no tokens', async () => {
    expect(await sendFcm([], { title: 't', body: 'b', kind: 'orders' })).toEqual({ sent: 0, gone: [], failed: [] });
    expect(sendEach).not.toHaveBeenCalled();
  });
});
