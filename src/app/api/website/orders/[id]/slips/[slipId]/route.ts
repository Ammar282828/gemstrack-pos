/** GET → a transfer slip the customer sent, for the shop to check against the bank. Owners and staff. */

import { NextRequest, NextResponse } from 'next/server';
import { readSlip } from '@/lib/website/slips';
import { staffFail, staffGate } from '@/lib/website/staff-gate';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; slipId: string }> }) {
  const who = await staffGate(req);
  if (who instanceof NextResponse) return who;
  const { id, slipId } = await params;
  try {
    const f = await readSlip(id, slipId);
    if (!f) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(new Uint8Array(f.bytes), { headers: { 'Content-Type': f.contentType, 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': `inline; filename="${id}-slip"` } });
  } catch (e) { return staffFail(e, 'website slip'); }
}
