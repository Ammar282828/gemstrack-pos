import { beforeEach, describe, expect, it, vi } from 'vitest';

// The code's check and the try counter, stood in for: the house's code here is "4321" (made up).
const tries: Record<string, number> = {};
let unset = false;
vi.mock('@/lib/delete-code-server', () => ({
  checkDeleteCode: async (code: string) => (unset ? 'unset' : code.trim() === '4321' ? 'ok' : 'wrong'),
}));
vi.mock('@/lib/website/ratelimit', () => ({
  rateLimit: async (scope: string, caller: string, max: number, windowSeconds: number) => {
    const k = `${scope}:${caller}:${max}:${windowSeconds}`;
    tries[k] = (tries[k] ?? 0) + 1;
    return { ok: tries[k] <= max, remaining: Math.max(0, max - tries[k]), retryAfter: 61 };
  },
  refundRateLimit: async (scope: string, caller: string) => {
    const k = `${scope}:${caller}:8:900`;
    if (tries[k] > 0) tries[k] -= 1;
  },
}));

const { passDeleteCode } = await import('./delete-code-gate');

beforeEach(() => {
  for (const k of Object.keys(tries)) delete tries[k];
  unset = false;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('the delete code on the server', () => {
  it('lets a right code through and gives its try back', async () => {
    expect(await passDeleteCode('owner@example.com', ' 4321 ', 'Delete this')).toEqual({ ok: true });
    expect(tries['delete-code:owner@example.com:8:900']).toBe(0);
  });

  it('refuses a wrong one, counted against the account, as /api/auth/delete-code does', async () => {
    expect(await passDeleteCode('owner@example.com', '1111', 'Delete this')).toEqual({ ok: false, status: 403, error: 'Wrong code.' });
    expect(tries['delete-code:owner@example.com:8:900']).toBe(1);
  });

  it('nothing typed is refused without spending a try', async () => {
    expect(await passDeleteCode('owner@example.com', undefined, 'Delete this')).toEqual({ ok: false, status: 400, error: 'Enter the delete code.' });
    expect(await passDeleteCode('owner@example.com', '  ', 'Delete this')).toMatchObject({ status: 400 });
    expect(await passDeleteCode('owner@example.com', 4321, 'Delete this')).toMatchObject({ status: 400 });
    expect(tries['delete-code:owner@example.com:8:900']).toBeUndefined();
  });

  it('after eight wrong tries, even the right code waits', async () => {
    for (let i = 0; i < 8; i++) await passDeleteCode('owner@example.com', '0000', 'Delete this');
    expect(await passDeleteCode('owner@example.com', '4321', 'Delete this')).toEqual({ ok: false, status: 429, error: 'Too many tries. Wait 2 minutes.' });
  });

  it('a shop with no code set says so', async () => {
    unset = true;
    expect(await passDeleteCode('owner@example.com', '4321', 'Delete this')).toEqual({ ok: false, status: 503, error: 'No delete code is set for this shop yet.' });
  });
});
