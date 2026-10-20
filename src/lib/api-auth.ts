import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

/**
 * Shared secret check for the notification endpoints.
 *
 * Cloud Scheduler cannot carry a user session, so these routes are public and
 * gated on CRON_SECRET instead — passed either as `Authorization: Bearer
 * <secret>`. Every Scheduler job sends the Bearer header (scripts/setup-cloud-scheduler.sh, docs/features), so
 * the old `?key=` form (secret in the URL, logged by proxies) is gone. Requests from localhost are allowed only
 * outside production, so the local dev scheduler works without a secret.
 *
 * `strict` closes the dev-convenience hole: with no CRON_SECRET configured the
 * lenient mode returns true, which is fine for a read-only report trigger but
 * not for an endpoint that can send a WhatsApp to any number on earth.
 */
export function isCronAuthorized(req: NextRequest, opts: { strict?: boolean } = {}): boolean {
  const secret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV !== 'production') {
    const host = req.headers.get('host') || '';
    if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return true;
  }

  // Deployed with no secret set: refuse outright in strict mode rather than
  // falling open.
  if (!secret) return !opts.strict;

  const auth = req.headers.get('authorization') || '';
  return sameSecret(auth, `Bearer ${secret}`);
}

/** Constant-time compare; unequal lengths fail at once (the length of the secret is not the secret). */
function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
