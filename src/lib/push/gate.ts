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

export type PushPlatform = 'ios' | 'android';
export const isPushPlatform = (p: unknown): p is PushPlatform => p === 'ios' || p === 'android';

/**
 * A device token. iOS: an APNs token, 64 hex characters today, longer allowed. Android: an FCM
 * registration token, printable with no whitespace, 100 to 4096 characters. With no platform
 * named (reading or forgetting a device), either kind.
 */
export function isDeviceToken(t: unknown, platform?: PushPlatform): t is string {
  if (typeof t !== 'string') return false;
  const apns = /^[0-9a-f]{64,200}$/i.test(t);
  const fcm = /^[\x21-\x7e]{100,4096}$/.test(t);
  return platform === 'ios' ? apns : platform === 'android' ? fcm : apns || fcm;
}
export const isBundleId = (b: unknown): b is string => typeof b === 'string' && /^[a-z0-9-]+(\.[a-z0-9-]+){2,}$/i.test(b);
