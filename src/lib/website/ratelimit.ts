/**
 * A fixed-window counter in Firestore, per caller, per route. The public
 * checkout has no login in front of it, so this is what stands between it and
 * a script placing a thousand orders. Written only by the Admin SDK; the rules
 * deny it to everyone, like unlock_attempts.
 *
 * Fixed windows are coarse — a burst at the boundary can get nearly double the
 * allowance — and that is fine here: the point is to make abuse boring, not to
 * meter it precisely.
 */

import { adminDb } from '@/lib/firebase-admin';

const COLLECTION = 'website_ratelimit';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets; only meaningful when !ok. */
  retryAfter: number;
}

export async function rateLimit(scope: string, caller: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const id = `${scope}__${caller.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 120)}`;
  const ref = adminDb.collection(COLLECTION).doc(id);

  return adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as { count: number; windowStart: number }) : null;
    const fresh = !data || now - data.windowStart >= windowMs;
    const count = fresh ? 1 : data.count + 1;
    const windowStart = fresh ? now : data.windowStart;
    tx.set(ref, { count, windowStart, updatedAt: now });
    const remaining = Math.max(0, max - count);
    const retryAfter = Math.ceil((windowStart + windowMs - now) / 1000);
    return { ok: count <= max, remaining, retryAfter };
  });
}

/** The caller's address as the App Hosting proxy reports it. */
export function callerKey(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || headers.get('x-real-ip') || 'unknown';
}
