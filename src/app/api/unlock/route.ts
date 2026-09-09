/**
 * Check the counter passcode and set the cookie the middleware looks for.
 *
 * The code is compared here, on the server, and never sent to the browser — the cookie
 * carries a peppered hash. See src/lib/unlock.ts for what this does and does not
 * protect.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { PASSCODE, UNLOCK_COOKIE, UNLOCK_MAX_AGE, unlockToken } from '@/lib/unlock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ten wrong codes an hour, per caller.
 *
 * A four-digit code is ten thousand combinations. An earlier version of this file
 * answered that with a one-second sleep and a comment claiming it bought three hours —
 * which is only true of an attacker who waits their turn. A hundred requests in
 * parallel ignore the sleep entirely and finish in about two minutes, so the delay was
 * buying almost nothing while reading as though it were buying safety.
 *
 * A count is the thing that actually bounds this, because it does not care how many
 * requests arrive at once. Ten an hour turns the full space into something on the
 * order of a century, and locks the shop out for at most an hour if somebody fat-
 * fingers it repeatedly.
 */
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60 * 60 * 1000;

/**
 * Cloud Run sits behind a proxy, so the socket address is the proxy's. The first entry
 * in x-forwarded-for is the client as the load balancer saw it. It is spoofable, and
 * that is tolerable here: a forged value spreads one attacker's attempts across many
 * buckets, but they still have to make ten thousand requests to a route that writes a
 * counter for each one, and the shop's own traffic is unaffected either way.
 */
function callerKey(req: NextRequest): string {
  const fwd = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const ip = fwd || req.headers.get('x-real-ip') || 'unknown';
  // Firestore document ids cannot contain '/', and IPv6 is full of ':'.
  return ip.replace(/[^a-zA-Z0-9.:-]/g, '').replace(/[:.]/g, '_').slice(0, 120) || 'unknown';
}

/** Returns the attempts left, or null when this caller is locked out. */
async function spendAttempt(key: string): Promise<number | null> {
  const ref = adminDb.collection('unlock_attempts').doc(key);
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const data = snap.exists ? snap.data() : undefined;
      const started = Number(data?.windowStart) || 0;
      const fresh = now - started > WINDOW_MS;
      const count = fresh ? 0 : Number(data?.count) || 0;
      if (count >= MAX_ATTEMPTS) return null;
      tx.set(ref, { count: count + 1, windowStart: fresh ? now : started }, { merge: true });
      return MAX_ATTEMPTS - (count + 1);
    });
  } catch (e) {
    // A counter that cannot be read must not become a lockout of the whole shop; the
    // passcode check below still has to pass either way.
    console.error('[/api/unlock] attempt counter unavailable', e);
    return MAX_ATTEMPTS;
  }
}

async function clearAttempts(key: string): Promise<void> {
  try {
    await adminDb.collection('unlock_attempts').doc(key).delete();
  } catch { /* best effort — a stale counter expires on its own within the hour */ }
}

/** Length-independent compare, so the answer does not describe the code. */
function matches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  let code = '';
  try {
    ({ code } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  const key = callerKey(req);
  const left = await spendAttempt(key);
  if (left === null) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(WINDOW_MS / 1000) } },
    );
  }

  if (!matches(String(code).trim(), PASSCODE)) {
    return NextResponse.json({ error: 'Wrong code.' }, { status: 401 });
  }

  await clearAttempts(key);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, await unlockToken(PASSCODE), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: UNLOCK_MAX_AGE,
  });
  return res;
}
