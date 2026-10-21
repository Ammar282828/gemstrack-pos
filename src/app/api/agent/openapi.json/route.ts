/**
 * GET → the OpenAPI 3.1 description of the REST twin (/api/agent/v1/*), for a ChatGPT custom GPT: Configure →
 * Actions → Import from URL, authentication API key, Bearer. `?scopes=read,posts:draft` gives one key's tools
 * only (Settings → Connect an AI links it so; a GPT takes 30 actions at most). Public, and reveals nothing
 * secret: the server is this house's own ERP address (NEXT_PUBLIC_APP_URL).
 */

import { NextRequest, NextResponse } from 'next/server';
import { STORE_CONFIG } from '@/lib/store-config';
import { publicOrigin } from '@/lib/social/gate';
import { buildOpenApi } from '@/lib/agent/openapi';
import { isScope } from '@/lib/agent/scopes';
import { ALL_TOOLS } from '@/lib/agent/tools';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const asked = req.nextUrl.searchParams.get('scopes');
  const scopes = asked ? asked.split(',').map(s => s.trim()).filter(isScope) : undefined;
  const doc = buildOpenApi(ALL_TOOLS, { serverUrl: publicOrigin(req), house: STORE_CONFIG.name, scopes });
  return NextResponse.json(doc, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
