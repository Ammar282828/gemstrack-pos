/**
 * Who may touch push and the widget's keys: a signed-in owner (and, for registering a phone,
 * staff too: they get no notifications today, but a phone registered now needs no second step).
 *
 * Server-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';

export async function pushGate(req: NextRequest, who: 'owner' | 'owner-or-staff'): Promise<string | NextResponse> {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  const role = roleForEmail(email);
  const ok = role === 'owner' || (who === 'owner-or-staff' && role === 'staff');
  return ok ? email : NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
}

/** An APNs device token: 64 hex characters today, longer allowed. */
export const isDeviceToken = (t: unknown): t is string => typeof t === 'string' && /^[0-9a-f]{64,200}$/i.test(t);
export const isBundleId = (b: unknown): b is string => typeof b === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(b);
