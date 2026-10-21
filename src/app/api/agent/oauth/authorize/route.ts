/**
 * The page an AI connector sends the owner to (lib/agent/oauth.ts): GET shows who is asking and a box for an AI
 * key; POST checks the key and sends the connector a one-use code. The key travels only in the form's body.
 */

import { NextRequest, NextResponse } from 'next/server';
import { STORE_CONFIG } from '@/lib/store-config';
import { checkKey } from '@/lib/agent/keys';
import { authorizePage, getClient, issueCode } from '@/lib/agent/oauth';
import { callerKey, rateLimit } from '@/lib/website/ratelimit';

export const dynamic = 'force-dynamic';

const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const;
type Params = Partial<Record<(typeof PARAMS)[number], string>>;

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' } });
const plain = (msg: string, status = 400) => new NextResponse(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** The request's own parameters, checked; the client and where its answer goes. */
async function read(p: Params) {
  if (p.response_type !== 'code') return { error: 'Only response_type=code is supported.' };
  if (!p.code_challenge || p.code_challenge_method !== 'S256') return { error: 'PKCE (S256) is required.' };
  const client = await getClient(p.client_id ?? '');
  if (!client) return { error: 'This connector is not registered with the ERP. Remove it and add it again.' };
  if (!p.redirect_uri || !client.redirectUris.includes(p.redirect_uri)) return { error: 'That redirect address is not the connector’s.' };
  return { client, redirect: new URL(p.redirect_uri) };
}

const hiddenOf = (p: Params) => Object.fromEntries(PARAMS.filter(k => p[k]).map(k => [k, p[k]!])) as Record<string, string>;

export async function GET(req: NextRequest) {
  const p = Object.fromEntries(PARAMS.map(k => [k, req.nextUrl.searchParams.get(k) ?? undefined])) as Params;
  const r = await read(p);
  if ('error' in r) return plain(r.error!);
  return html(authorizePage({ house: STORE_CONFIG.name, client: r.client.name, redirectHost: r.redirect.host, hidden: hiddenOf(p) }));
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const p = Object.fromEntries(PARAMS.map(k => [k, String(form?.get(k) ?? '') || undefined])) as Params;
  const r = await read(p);
  if ('error' in r) return plain(r.error!);
  const page = (error: string, status: number) => html(authorizePage({ house: STORE_CONFIG.name, client: r.client.name, redirectHost: r.redirect.host, hidden: hiddenOf(p), error }), status);
  const limit = await rateLimit('ai-oauth-authorize', callerKey(req.headers), 20, 900);
  if (!limit.ok) return page('Too many tries. Wait a few minutes.', 429);
  const check = await checkKey(String(form?.get('key') ?? ''));
  if (!check.ok) return page(check.message, 401);
  const code = await issueCode({ keyId: check.key.id, clientId: r.client.id, redirectUri: p.redirect_uri!, challenge: p.code_challenge! });
  r.redirect.searchParams.set('code', code);
  if (p.state) r.redirect.searchParams.set('state', p.state);
  return NextResponse.redirect(r.redirect.toString(), 302);
}
