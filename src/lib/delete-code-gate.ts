/**
 * The delete code checked on the server, for a delete the server itself carries out (the iPhone app's
 * writes, /api/app/write). The browser asks /api/auth/delete-code and then deletes; here the code comes
 * with the delete and is checked first, by the same rules as that route: eight tries in fifteen minutes
 * per account, each counted before it is checked and a right one given back, every wrong one logged
 * with who made it (decision "Delete code"). The code itself is never logged.
 */

import { checkDeleteCode } from '@/lib/delete-code-server';
import { rateLimit, refundRateLimit } from '@/lib/website/ratelimit';

export type DeleteCodeVerdict = { ok: true } | { ok: false; status: number; error: string };

export async function passDeleteCode(email: string, code: unknown, what: string): Promise<DeleteCodeVerdict> {
  // Nothing typed is no guess: refused without spending a try.
  const given = typeof code === 'string' ? code.trim() : '';
  if (!given) return { ok: false, status: 400, error: 'Enter the delete code.' };

  const limit = await rateLimit('delete-code', email, 8, 900);
  if (!limit.ok) {
    const mins = Math.max(1, Math.ceil(limit.retryAfter / 60));
    return { ok: false, status: 429, error: `Too many tries. Wait ${mins} minute${mins === 1 ? '' : 's'}.` };
  }
  const said = what.replace(/[^\w @.#:/()-]/g, '').slice(0, 80);
  const result = await checkDeleteCode(given);
  if (result === 'unset') return { ok: false, status: 503, error: 'No delete code is set for this shop yet.' };
  if (result === 'wrong') {
    console.warn(`[delete-code] wrong code by ${email} for "${said}"`);
    return { ok: false, status: 403, error: 'Wrong code.' };
  }
  await refundRateLimit('delete-code', email);
  console.log(`[delete-code] accepted for ${email}: "${said}"`);
  return { ok: true };
}
