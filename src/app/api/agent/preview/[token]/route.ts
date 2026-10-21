/** GET → a picture a REST answer pointed at (lib/agent/previews.ts), for an hour; then 404. */

import { NextRequest, NextResponse } from 'next/server';
import { readPreview } from '@/lib/agent/previews';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await readPreview(token).catch(() => null);
  if (!p) return NextResponse.json({ error: 'That picture has gone (they are kept for an hour).' }, { status: 404 });
  return new NextResponse(new Uint8Array(p.data), { headers: { 'Content-Type': p.mimeType, 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex' } });
}
