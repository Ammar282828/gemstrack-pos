/**
 * A phone saying it could not register for notifications (iOS refused, or the app is not allowed
 * to): the one place the server can see why a phone never appears in `push_devices`. Last error
 * only, no token. Read in Firestore `push_devices_failed`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate, isBundleId } from '@/lib/push/gate';
import { saveFailure } from '@/lib/push/store';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const email = await pushGate(req, 'owner-or-staff');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => null) as { bundleId?: unknown; label?: unknown; error?: unknown } | null;
  if (!body || !isBundleId(body.bundleId) || typeof body.error !== 'string' || !body.error.trim()) {
    return NextResponse.json({ error: 'Not a report.' }, { status: 400 });
  }
  await saveFailure({
    bundleId: body.bundleId,
    label: typeof body.label === 'string' ? body.label.slice(0, 60) : 'iPhone',
    error: body.error.slice(0, 300),
    email,
    at: new Date().toISOString(),
  });
  return NextResponse.json({ ok: true });
}
