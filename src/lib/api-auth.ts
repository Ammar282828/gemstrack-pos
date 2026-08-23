import type { NextRequest } from 'next/server';

/**
 * Shared secret check for the notification endpoints.
 *
 * Cloud Scheduler cannot carry a user session, so these routes are public and
 * gated on CRON_SECRET instead — passed either as `Authorization: Bearer
 * <secret>` or `?key=<secret>`. Requests from localhost are always allowed so
 * the local dev scheduler works without one.
 *
 * `strict` closes the dev-convenience hole: with no CRON_SECRET configured the
 * lenient mode returns true, which is fine for a read-only report trigger but
 * not for an endpoint that can send a WhatsApp to any number on earth.
 */
export function isCronAuthorized(req: NextRequest, opts: { strict?: boolean } = {}): boolean {
  const secret = process.env.CRON_SECRET;

  const host = req.headers.get('host') || '';
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
  if (isLocal) return true;

  // Deployed with no secret set: refuse outright in strict mode rather than
  // falling open.
  if (!secret) return !opts.strict;

  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get('key') === secret) return true;
  return false;
}
