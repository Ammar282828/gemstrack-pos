/** GET → the ERP's own small authorization server for AI connectors (RFC 8414; lib/agent/oauth.ts). */

import { NextRequest, NextResponse } from 'next/server';
import { publicOrigin } from '@/lib/social/gate';
import { serverMetadata } from '@/lib/agent/oauth';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return NextResponse.json(serverMetadata(publicOrigin(req)), { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
