/** GET → which authorization server signs in the ERP's MCP endpoint (RFC 9728; lib/agent/oauth.ts). */

import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/social/gate';
import { resourceMetadata } from '@/lib/agent/oauth';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return NextResponse.json(resourceMetadata(publicOrigin(req)), { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
