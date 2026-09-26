import { describe, it, expect, vi, afterEach } from 'vitest';

const load = async (env: Record<string, string | undefined>) => {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return import('./notify-label');
};

afterEach(() => { delete process.env.NEXT_PUBLIC_STORE_NOTIFY_LABEL; delete process.env.NEXT_PUBLIC_STORE_NAME; });

describe('fromThisPos', () => {
  it("names Taheri's POS by default, at the front of the first line", async () => {
    const { fromThisPos } = await load({ NEXT_PUBLIC_STORE_NAME: undefined, NEXT_PUBLIC_STORE_NOTIFY_LABEL: undefined });
    expect(fromThisPos('🧾 *New Sale* INV-000123\nCustomer: Walk-in')).toBe('*Taheri POS* · 🧾 *New Sale* INV-000123\nCustomer: Walk-in');
  });
  it("uses the house's own label when set", async () => {
    const { fromThisPos } = await load({ NEXT_PUBLIC_STORE_NAME: 'MINA', NEXT_PUBLIC_STORE_NOTIFY_LABEL: 'House of Mina POS' });
    expect(fromThisPos('💰 *Payment Received*')).toBe('*House of Mina POS* · 💰 *Payment Received*');
  });
  it('does not label a message twice', async () => {
    const { fromThisPos } = await load({});
    expect(fromThisPos(fromThisPos('x'))).toBe(fromThisPos('x'));
  });
});
