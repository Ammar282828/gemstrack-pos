import { beforeEach, describe, expect, it, vi } from 'vitest';
import { databaseRules, forgetRulesState, keysAllowed, PAUSED_MESSAGE } from './rules-guard';

const env = { NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-project', NEXT_PUBLIC_FIREBASE_API_KEY: 'web-key' } as unknown as NodeJS.ProcessEnv;
const answer = (status: number) => vi.fn(async () => ({ status }));

beforeEach(() => forgetRulesState());

describe('AI keys wait for locked rules', () => {
  it('asks Firestore anonymously for app_private', async () => {
    const fetcher = answer(403);
    await databaseRules({ env, fetcher });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, { signal: AbortSignal }];
    expect(url).toBe('https://firestore.googleapis.com/v1/projects/demo-project/databases/(default)/documents/app_private?pageSize=1&mask.fieldPaths=__name__&key=web-key');
    expect(init).not.toHaveProperty('headers');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('open (200) → refused with what to do; locked (401/403) → allowed', async () => {
    expect(await keysAllowed({ env, fetcher: answer(200) })).toEqual({ ok: false, state: 'open', message: PAUSED_MESSAGE });
    forgetRulesState();
    expect(await keysAllowed({ env, fetcher: answer(403) })).toEqual({ ok: true });
    forgetRulesState();
    expect(await keysAllowed({ env, fetcher: answer(401) })).toEqual({ ok: true });
  });

  it('fails closed on an error, an odd answer or missing settings, and remembers none of them', async () => {
    const boom = vi.fn(async () => { throw new Error('network'); });
    expect(await keysAllowed({ env, fetcher: boom })).toMatchObject({ ok: false, state: 'unknown' });
    expect(await keysAllowed({ env, fetcher: answer(500) })).toMatchObject({ ok: false, state: 'unknown' });
    expect(await keysAllowed({ env: {} as NodeJS.ProcessEnv, fetcher: answer(403) })).toMatchObject({ ok: false, state: 'unknown' });
    const locked = answer(403);
    expect(await keysAllowed({ env, fetcher: locked })).toEqual({ ok: true });
    expect(locked).toHaveBeenCalledTimes(1);
  });

  it('remembers open for ten minutes and locked for an hour', async () => {
    const t = Date.now();
    const open = answer(200);
    await databaseRules({ env, fetcher: open, now: t });
    expect(await databaseRules({ env, fetcher: answer(403), now: t + 9 * 60_000 })).toBe('open');
    expect(await databaseRules({ env, fetcher: answer(403), now: t + 11 * 60_000 })).toBe('locked');
    expect(await databaseRules({ env, fetcher: answer(200), now: t + 50 * 60_000 })).toBe('locked');
    expect(await databaseRules({ env, fetcher: answer(200), now: t + 72 * 60_000 })).toBe('open');
  });
});
