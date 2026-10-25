/**
 * Signing a connector in with an AI key (docs/features/ai-keys.md). claude.ai's custom connectors and
 * ChatGPT's connectors can't send a header of their own: they speak OAuth 2.1 (the MCP authorization spec).
 * So the ERP is its own small authorization server, with no new secret:
 *
 *   /.well-known/oauth-protected-resource      which server signs the MCP endpoint in (this one)
 *   /.well-known/oauth-authorization-server    where to register, authorize and get a token
 *   POST /api/agent/oauth/register             dynamic client registration (RFC 7591): a client id
 *   GET  /api/agent/oauth/authorize            a page: "<client> wants to use the ERP — paste an AI key"
 *   POST /api/agent/oauth/authorize            the key checked → a one-use code (5 minutes) → the client
 *   POST /api/agent/oauth/token                the code + its PKCE verifier → an access token
 *
 * The token is a key of its own for the same record (keys.ts addToken): the same label, scopes, rate limit
 * and log; revoking the key in Settings stops every connector signed in with it. Codes and clients live in
 * `app_private` (the Admin SDK's alone). Server-only, apart from the pure helpers.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { publicOrigin } from '@/lib/social/gate';

const COL = 'app_private';
const CODE_MS = 5 * 60_000;

export const mcpResource = (origin: string) => `${origin}/api/agent/mcp`;

export function resourceMetadata(origin: string) {
  return { resource: mcpResource(origin), authorization_servers: [origin], bearer_methods_supported: ['header'], resource_name: 'ERP for an AI' };
}

export function serverMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/agent/oauth/authorize`,
    token_endpoint: `${origin}/api/agent/oauth/token`,
    registration_endpoint: `${origin}/api/agent/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['erp'],
  };
}

/** The 401's WWW-Authenticate: a bearer key, and where a connector learns to sign in. */
export const challenge = (req: NextRequest) =>
  `Bearer realm="erp", resource_metadata="${publicOrigin(req)}/.well-known/oauth-protected-resource"`;

/** PKCE S256: base64url(sha256(verifier)) is the challenge. */
export const pkceOk = (verifier: string, challengeValue: string) =>
  /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && createHash('sha256').update(verifier).digest('base64url') === challengeValue;

/** An address a code may be sent back to: https anywhere (registered), or a loopback for a desktop client. */
export function redirectOk(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]');
  } catch { return false; }
}

export interface OAuthClient { kind: 'oauth_client'; id: string; name: string; redirectUris: string[]; at: string }

export async function registerClient(body: unknown): Promise<OAuthClient> {
  const b = (body && typeof body === 'object' ? body : {}) as { client_name?: unknown; redirect_uris?: unknown };
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === 'string' && u.length <= 500 && redirectOk(u)).slice(0, 10) : [];
  if (!uris.length) throw Object.assign(new Error('redirect_uris must list https addresses (or a loopback).'), { status: 400, code: 'invalid_redirect_uri' });
  const client: OAuthClient = { kind: 'oauth_client', id: `c_${randomBytes(12).toString('hex')}`, name: String(b.client_name ?? 'An AI').slice(0, 80) || 'An AI', redirectUris: uris, at: new Date().toISOString() };
  await adminDb.collection(COL).doc(`oauth_client__${client.id}`).set(client);
  return client;
}

export async function getClient(id: string): Promise<OAuthClient | null> {
  if (!/^c_[a-f0-9]{24}$/.test(id)) return null;
  const s = await adminDb.collection(COL).doc(`oauth_client__${id}`).get();
  return s.exists ? (s.data() as OAuthClient) : null;
}

export interface CodeGrant { kind: 'oauth_code'; keyId: string; clientId: string; redirectUri: string; challenge: string; until: number }

export async function issueCode(g: Omit<CodeGrant, 'kind' | 'until'>): Promise<string> {
  const code = randomBytes(24).toString('base64url');
  await adminDb.collection(COL).doc(`oauth_code__${code}`).set({ kind: 'oauth_code', ...g, until: Date.now() + CODE_MS } satisfies CodeGrant);
  return code;
}

/** The code's grant, once: it is deleted as it is read. */
export async function takeCode(code: string): Promise<CodeGrant | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(code)) return null;
  const ref = adminDb.collection(COL).doc(`oauth_code__${code}`);
  return adminDb.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    tx.delete(ref);
    const g = s.data() as CodeGrant;
    return g.until >= Date.now() ? g : null;
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The page a connector opens: who is asking, where the answer goes, a box for the key. Plain HTML, no script. */
export function authorizePage(o: { house: string; client: string; redirectHost: string; hidden: Record<string, string>; error?: string }): string {
  const fields = Object.entries(o.hidden).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Connect an AI · ${esc(o.house)}</title>
<style>
:root{color-scheme:light dark;--ground:#ECE8E1;--card:#fff;--ink:#111;--quiet:#6b6b70;--accent:#8A6B42;--late:#b3261e}
@media(prefers-color-scheme:dark){:root{--ground:#000;--card:#1c1c1e;--ink:#fff;--quiet:#98989f;--accent:#C9A45A}}
body{margin:0;background:var(--ground);color:var(--ink);font:16px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:440px;margin:0 auto;padding:48px 16px}
.card{background:var(--card);border-radius:22px;padding:24px}
h1{font-size:22px;font-weight:600;margin:0 0 8px}p{margin:0 0 14px;color:var(--quiet)}b{color:var(--ink)}
input[type=password]{box-sizing:border-box;width:100%;font:15px ui-monospace,monospace;padding:12px 14px;border-radius:12px;border:1px solid var(--quiet);background:transparent;color:var(--ink)}
button{margin-top:14px;width:100%;padding:12px;border:0;border-radius:999px;background:var(--accent);color:#fff;font:600 16px system-ui}
.err{color:var(--late);font-weight:600}
</style></head><body><main><div class="card">
<h1>Connect an AI to ${esc(o.house)}</h1>
<p><b>${esc(o.client)}</b> wants to use the ERP. Its answer goes to <b>${esc(o.redirectHost)}</b>.</p>
<p>Paste an AI key from <b>Settings → Connect an AI</b>. It gets what that key may do, and stops when you revoke the key there.</p>
${o.error ? `<p class="err">${esc(o.error)}</p>` : ''}
<form method="post" autocomplete="off">${fields}
<input type="password" name="key" placeholder="tk_…" required autofocus spellcheck="false">
<button type="submit">Connect</button></form>
</div></main></body></html>`;
}
