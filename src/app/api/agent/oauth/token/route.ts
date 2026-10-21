/**
 * POST grant_type=authorization_code, code, code_verifier, redirect_uri, client_id → an access token for an AI
 * connector: a token of the key the owner pasted (lib/agent/keys.ts addToken), stopped when that key is revoked.
 */

import { NextRequest, NextResponse } from 'next/server';
import { addToken } from '@/lib/agent/keys';
import { pkceOk, takeCode } from '@/lib/agent/oauth';
import { keysAllowed } from '@/lib/agent/rules-guard';

export const dynamic = 'force-dynamic';

const refuse = (error: string, error_description: string, status = 400) =>
  NextResponse.json({ error, error_description }, { status, headers: { 'Cache-Control': 'no-store' } });

async function fields(req: NextRequest): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const b = await req.json().catch(() => ({}));
    return Object.fromEntries(Object.entries(b ?? {}).map(([k, v]) => [k, String(v ?? '')]));
  }
  const f = await req.formData().catch(() => null);
  return f ? Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)])) : {};
}

export async function POST(req: NextRequest) {
  const f = await fields(req);
  // A client may name itself in Basic auth instead of the body.
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.get('authorization') || '')?.[1];
  const clientId = f.client_id || (basic ? Buffer.from(basic, 'base64').toString().split(':')[0] : '');
  if (f.grant_type !== 'authorization_code') return refuse('unsupported_grant_type', 'Only authorization_code.');
  // No token while the database's rules are open (rules-guard.ts): a forged code would mint one.
  const rules = await keysAllowed();
  if (!rules.ok) return refuse('temporarily_unavailable', rules.message, 503);
  const grant = await takeCode(f.code || '');
  if (!grant) return refuse('invalid_grant', 'That code is unknown, used or expired. Connect again.');
  if (clientId && clientId !== grant.clientId) return refuse('invalid_grant', 'That code is another client’s.');
  if (f.redirect_uri && f.redirect_uri !== grant.redirectUri) return refuse('invalid_grant', 'The redirect address does not match.');
  if (!pkceOk(f.code_verifier || '', grant.challenge)) return refuse('invalid_grant', 'The PKCE verifier does not match.');
  try {
    const token = await addToken(grant.keyId);
    return NextResponse.json({ access_token: token, token_type: 'Bearer', scope: 'erp' }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch (e) {
    return refuse('invalid_grant', e instanceof Error ? e.message : 'That key has been revoked.');
  }
}
