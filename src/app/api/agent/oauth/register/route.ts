/** POST { client_name, redirect_uris } → a client id for an AI connector (RFC 7591; lib/agent/oauth.ts). */

import { NextRequest, NextResponse } from 'next/server';
import { registerClient } from '@/lib/agent/oauth';
import { callerKey, rateLimit } from '@/lib/website/ratelimit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const limit = await rateLimit('ai-oauth-register', callerKey(req.headers), 30, 3_600);
  if (!limit.ok) return NextResponse.json({ error: 'slow_down' }, { status: 429 });
  try {
    const c = await registerClient(await req.json().catch(() => null));
    return NextResponse.json({
      client_id: c.id, client_name: c.name, redirect_uris: c.redirectUris, client_id_issued_at: Math.floor(Date.parse(c.at) / 1000),
      grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none',
    }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const err = e as Error & { code?: string; status?: number };
    return NextResponse.json({ error: err.code ?? 'invalid_client_metadata', error_description: err.message }, { status: err.status ?? 400 });
  }
}
