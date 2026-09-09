/**
 * Check the counter passcode and set the cookie the middleware looks for.
 *
 * The code is compared here, on the server, and never sent to the browser — the
 * cookie carries a hash of it. See src/lib/unlock.ts for what this does and does not
 * protect.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PASSCODE, UNLOCK_COOKIE, UNLOCK_MAX_AGE, unlockToken } from '@/lib/unlock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let code = '';
  try {
    ({ code } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  }

  if (String(code).trim() !== PASSCODE) {
    // Deliberately slow. Four digits is ten thousand guesses, which is nothing to a
    // script; a second each makes it three hours, which is enough to be noticed.
    await new Promise((r) => setTimeout(r, 1000));
    return NextResponse.json({ error: 'Wrong code.' }, { status: 401 });
  }

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
