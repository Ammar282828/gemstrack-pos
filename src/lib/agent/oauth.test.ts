import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeFirestore } from './fake-firestore';

const fake = fakeFirestore();
vi.mock('@/lib/firebase-admin', () => ({ adminDb: fake.db }));

const { pkceOk, redirectOk, authorizePage, registerClient, getClient, issueCode, takeCode, serverMetadata, resourceMetadata } = await import('./oauth');

beforeEach(() => fake.reset());

describe('signing a connector in', () => {
  it('checks PKCE S256', () => {
    const verifier = 'a'.repeat(50);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(pkceOk(verifier, challenge)).toBe(true);
    expect(pkceOk('b'.repeat(50), challenge)).toBe(false);
    expect(pkceOk('short', challenge)).toBe(false);
  });

  it('sends codes only to https or a loopback', () => {
    expect(redirectOk('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectOk('http://localhost:6274/cb')).toBe(true);
    expect(redirectOk('http://evil.example/cb')).toBe(false);
    expect(redirectOk('javascript:alert(1)')).toBe(false);
  });

  it('registers a client, and a code is good once', async () => {
    const c = await registerClient({ client_name: 'Claude', redirect_uris: ['https://claude.ai/cb', 'http://evil.example/x'] });
    expect(c.redirectUris).toEqual(['https://claude.ai/cb']);
    expect(await getClient(c.id)).toMatchObject({ name: 'Claude' });
    await expect(registerClient({ redirect_uris: ['ftp://x'] })).rejects.toThrow(/redirect_uris/);
    const code = await issueCode({ keyId: 'k', clientId: c.id, redirectUri: 'https://claude.ai/cb', challenge: 'x' });
    expect(await takeCode(code)).toMatchObject({ keyId: 'k' });
    expect(await takeCode(code)).toBeNull();
  });

  it('describes itself, and escapes what it shows', () => {
    expect(serverMetadata('https://erp.example')).toMatchObject({ token_endpoint: 'https://erp.example/api/agent/oauth/token', code_challenge_methods_supported: ['S256'] });
    expect(resourceMetadata('https://erp.example')).toMatchObject({ resource: 'https://erp.example/api/agent/mcp', authorization_servers: ['https://erp.example'] });
    const html = authorizePage({ house: 'TAHERI', client: '<script>x</script>', redirectHost: 'claude.ai', hidden: { state: '"><b>' } });
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('value="&quot;&gt;&lt;b&gt;"');
  });
});
