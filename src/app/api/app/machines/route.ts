/**
 * GET: the shop's state machines (lib/machines) as JSON: every status, its words and tone, and every move it allows with the
 * event and the condition. For the iPhone and Android apps and for agents; what the server refuses with 409 is exactly this.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { machinesJson } from '@/lib/machines/export';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  return NextResponse.json(machinesJson());
}
