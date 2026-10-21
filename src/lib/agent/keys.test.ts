import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from './fake-firestore';

const fake = fakeFirestore();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: fake.db }));
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { increment: (n: number) => ({ __inc: n }) } }));
const roles: Record<string, string> = { 'owner@example.com': 'owner', 'mkt@example.com': 'marketing', 'staff@example.com': 'staff' };
vi.mock('@/lib/roles', () => ({ roleForEmail: (e: string) => roles[e] ?? 'none' }));

const { createKey, checkKey, listKeys, revokeKey, noteUse, addToken, parseKey, sameHash, scopesFor } = await import('./keys');

beforeEach(() => fake.reset());

const make = (o: Partial<Parameters<typeof createKey>[0]> = {}) => createKey({ label: 'ChatGPT', scopes: ['posts:draft', 'read'], by: 'owner@example.com', ...o });

describe('AI keys', () => {
  it('is shown once, kept only as a hash, and checks', async () => {
    const { key, info } = await make();
    expect(key).toMatch(/^tk_taheri_[a-f0-9]{16}_[A-Za-z0-9_-]{40}$/);
    const stored = JSON.stringify(fake.data.app_private);
    expect(stored).not.toContain(parseKey(key)!.secret);
    expect(info).not.toHaveProperty('hash');
    const c = await checkKey(key);
    expect(c).toMatchObject({ ok: true, key: { label: 'ChatGPT', scopes: ['posts:draft', 'read'], email: 'owner@example.com', role: 'owner' } });
    expect((await listKeys()).map(k => k.label)).toEqual(['ChatGPT']);
  });

  it('refuses a wrong secret, a malformed key, another house’s key and nothing', async () => {
    const { key } = await make();
    const wrong = key.slice(0, -4) + (key.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(await checkKey(wrong)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(await checkKey('tstudio_abc')).toMatchObject({ ok: false, reason: 'malformed' });
    expect(await checkKey(key.replace('tk_taheri_', 'tk_mina_'))).toMatchObject({ ok: false, reason: 'house' });
    expect(await checkKey('')).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('a revoked key stops at once, with the connectors’ tokens for it', async () => {
    const { key, info } = await make();
    const token = await addToken(info.id);
    expect((await checkKey(token)).ok).toBe(true);
    expect(await revokeKey(info.id)).toBe(true);
    expect(await checkKey(key)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(await checkKey(token)).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('an expired key stops', async () => {
    const { key } = await make({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await checkKey(key)).ok).toBe(true);
    expect(await checkKey(key, new Date(Date.now() + 2 * 86_400_000))).toMatchObject({ ok: false, reason: 'expired' });
    await expect(make({ expiresAt: '2020-01-01' })).rejects.toThrow(/future/);
  });

  it('stops when its maker loses the role, and a marketing key keeps only the Studio', async () => {
    const { key } = await make({ by: 'staff@example.com' });
    expect(await checkKey(key)).toMatchObject({ ok: false, reason: 'orphaned' });
    const m = await make({ by: 'mkt@example.com', scopes: ['studio', 'read'] });
    expect(await checkKey(m.key)).toMatchObject({ ok: true, key: { scopes: ['studio'] } });
    expect(scopesFor('owner', ['read', 'write:money'])).toEqual(['read', 'write:money']);
    expect(scopesFor('none', ['read'])).toEqual([]);
  });

  it('takes only known scopes, and needs one', async () => {
    const { info } = await make({ scopes: ['read', 'nonsense', 'read', 'write:money'] });
    expect(info.scopes).toEqual(['read', 'write:money']);
    await expect(make({ scopes: [] })).rejects.toThrow(/at least one/);
  });

  it('counts its calls and notes when it was last used', async () => {
    const { info } = await make();
    await noteUse(info.id);
    await noteUse(info.id);
    const [k] = await listKeys();
    expect(k.calls).toBe(2);
    expect(k.lastUsedAt).toBeTruthy();
  });

  it('parses and compares in constant time', () => {
    expect(parseKey('tk_mina_0123456789abcdef_' + 'x'.repeat(40))).toMatchObject({ house: 'mina', id: '0123456789abcdef' });
    expect(parseKey('tk_mina_short_x')).toBeNull();
    expect(sameHash('ab'.repeat(32), 'ab'.repeat(32))).toBe(true);
    expect(sameHash('ab'.repeat(32), 'ac'.repeat(32))).toBe(false);
    expect(sameHash('ab', 'ab'.repeat(32))).toBe(false);
  });
});
