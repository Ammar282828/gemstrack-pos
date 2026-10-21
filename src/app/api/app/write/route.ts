/**
 * POST { op, … }: the native iPhone app's writes (apps/iphone, CONVENTIONS.md rule 1).
 *
 * Each operation runs the same shared write the browser runs (lib/writes/*), on the Admin SDK, for
 * whoever the browser lets do it: an owner, or staff where the shop floor may (as /api/staff/write).
 * The operations themselves are in run-op.ts, which an AI key's write tools run too (lib/agent), so a
 * sale or a payment an AI takes is the app's own.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { runWriteOp } from './run-op';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  let body: { op?: string } & Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  return runWriteOp({ email, role: roleForEmail(email), via: 'iphone-app' }, body);
}
