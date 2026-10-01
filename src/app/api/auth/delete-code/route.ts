/**
 * POST { code } → whether the house's delete code is right (lib/delete-code-server.ts).
 *
 * Signed-in owners and staff only. Eight wrong tries in fifteen minutes per account, then a wait: a
 * four-digit code is ten thousand guesses, and this is the only place a guess can be made. Each try
 * is counted before it is checked (so a burst can't outrun the count) and a right one is given back,
 * so a morning of deletes never locks the owner out. Every wrong try is logged with who made it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { rateLimit, refundRateLimit } from '@/lib/website/ratelimit';
import { checkDeleteCode } from '@/lib/delete-code-server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });

  const limit = await rateLimit('delete-code', email, 8, 900);
  if (!limit.ok) {
    const mins = Math.max(1, Math.ceil(limit.retryAfter / 60));
    return NextResponse.json({ error: `Too many tries. Wait ${mins} minute${mins === 1 ? '' : 's'}.` }, { status: 429 });
  }
  const body = await req.json().catch(() => ({})) as { code?: unknown; what?: unknown };
  const what = String(body.what ?? '').replace(/[^\w @.#:/()-]/g, '').slice(0, 80);
  const result = await checkDeleteCode(String(body.code ?? ''));
  if (result === 'unset') return NextResponse.json({ error: 'No delete code is set for this shop yet.' }, { status: 503 });
  if (result === 'wrong') {
    console.warn(`[delete-code] wrong code by ${email} for "${what}"`);
    return NextResponse.json({ error: 'Wrong code.' }, { status: 403 });
  }
  await refundRateLimit('delete-code', email);
  console.log(`[delete-code] accepted for ${email}: "${what}"`);
  return NextResponse.json({ ok: true });
}
