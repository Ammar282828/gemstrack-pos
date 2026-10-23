import { describe, expect, it, vi } from 'vitest';
import { remembered } from './swr';

describe('remembered', () => {
  it('answers from memory, shares one trip, and serves the old answer while asking again', async () => {
    vi.useFakeTimers();
    let n = 0;
    const build = vi.fn(async () => ++n);
    const opts = { ttl: 1000, stale: 5000 };
    const [a, b] = await Promise.all([remembered('k1', build, opts), remembered('k1', build, opts)]);
    expect([a, b, build.mock.calls.length]).toEqual([1, 1, 1]);
    expect(await remembered('k1', build, opts)).toBe(1);

    vi.advanceTimersByTime(2000); // past ttl, within stale: the old answer now, a new one behind it
    expect(await remembered('k1', build, opts)).toBe(1);
    await Promise.resolve(); await Promise.resolve();
    expect(await remembered('k1', build, opts)).toBe(2);

    expect(await remembered('k1', build, { ...opts, fresh: true })).toBe(3);
    vi.advanceTimersByTime(10_000); // past stale: asked now
    expect(await remembered('k1', build, opts)).toBe(4);
    vi.useRealTimers();
  });

  it('keeps no failure', async () => {
    const bad = vi.fn(async () => { throw new Error('no'); });
    await expect(remembered('k2', bad, { ttl: 1000, stale: 0 })).rejects.toThrow('no');
    expect(await remembered('k2', async () => 7, { ttl: 1000, stale: 0 })).toBe(7);
  });
});
