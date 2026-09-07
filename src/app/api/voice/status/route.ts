/**
 * Whether the shop can talk to the book at all.
 *
 * The question changed when voice moved to Vertex AI: there is no API key any more, so
 * "is a key present" tells nobody anything. What matters is whether this deployment's
 * own service account can actually reach the model — and the two ways that fails have
 * different fixes, so they are reported apart. A depleted account is the shop's to top
 * up; a missing permission is mine to grant.
 *
 * Cached, because it is asked on every page load and the answer changes about as often
 * as a billing cycle.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { generateJson, geminiConfigured, GeminiError } from '@/lib/voice/gemini';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; ready: boolean; reason: string | null } | null = null;

export async function GET(req: NextRequest) {
  // See the note in voice/listen: with the app open there is no token to check, and
  // refusing here made a sign-in problem look like a Google outage.
  if (process.env.NEXT_PUBLIC_OPEN_ACCESS !== '1') {
    const email = await verifyRequestEmail(req);
    if (!email || roleForEmail(email) !== 'owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!geminiConfigured()) return NextResponse.json({ ready: false, reason: 'not_configured' });
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json({ ready: cached.ready, reason: cached.reason });
  }

  let ready = false;
  let reason: string | null = null;
  try {
    // The smallest real call there is. A reachability check that does not actually call
    // the model would have said "ready" all through the period the account was empty.
    await generateJson<{ ok?: string }>({
      system: 'Reply with {"ok":"yes"} and nothing else.',
      parts: [{ text: 'ping' }],
      schema: { type: 'OBJECT', properties: { ok: { type: 'STRING' } } },
    });
    ready = true;
  } catch (err) {
    reason = err instanceof GeminiError
      ? (err.status === 429 ? 'no_credit' : err.status === 403 ? 'no_permission' : 'unreachable')
      : 'unreachable';
  }

  cached = { at: Date.now(), ready, reason };
  return NextResponse.json({ ready, reason });
}
