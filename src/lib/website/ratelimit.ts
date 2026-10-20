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

/** Give one counted try back (a right delete code is not a guess). Never below zero. */
export async function refundRateLimit(scope: string, caller: string): Promise<void> {
  const id = `${scope}__${caller.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 120)}`;
  const ref = adminDb.collection(COLLECTION).doc(id);
  await adminDb.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const count = (snap.data() as { count?: number } | undefined)?.count ?? 0;
    if (count > 0) tx.update(ref, { count: count - 1 });
  }).catch(() => {});
}

/**
 * Addresses that are our own plumbing, not a caller: private ranges and Google's load-balancer / health-check
 * ranges (35.191.0.0/16, 130.211.0.0/22), which a front end can append after the client's address.
 */
function plumbing(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return /^(::1|f[cd]|fe[89ab])/i.test(ip);
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    || (a === 35 && b === 191) || (a === 130 && b === 211 && c <= 3);
}

/**
 * The caller's address. X-Forwarded-For is "whatever the caller sent, then each hop appends the address it saw":
 * Google's front end (Cloud Run behind App Hosting) adds the real client address at the RIGHT, so the left-most
 * entry is the caller's own claim and anyone can forge it (one fresh value per request defeats every per-IP
 * limit). We therefore read from the right and take the first entry that is not our own plumbing (private
 * ranges, Google's load balancer). If every entry is plumbing, fall back to x-real-ip, then 'unknown'.
 * (Not verifiable from this repo: if a deploy ever shows all callers sharing one key, check which hop is last.)
 */
export function callerKey(headers: Headers): string {
  const hops = (headers.get('x-forwarded-for') || '').split(',').map(h => h.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!plumbing(hops[i])) return hops[i];
  }
  return headers.get('x-real-ip') || 'unknown';
}
