/**
 * Whether the shop can talk to the book at all.
 *
 * The key is server-side, so the page cannot tell on its own. Answers with a verdict and
 * nothing else — never the key, never its length, never a prefix.
 *
 * A key that is merely PRESENT is not the question. An expired or mistyped one sits in the
 * environment looking exactly like a working one, and reporting that as ready puts a live
 * microphone in front of the counter that fails on the first sentence somebody speaks. So
 * the key is actually offered to Google — against models.list, which costs nothing and
 * generates nothing — and the answer is cached, because this is asked on every page load
 * and the answer changes about once a year.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; ready: boolean; reason: string | null } | null = null;

export async function GET(req: NextRequest) {
  // Cheap, but it still probes Google on a cache miss — and it is a fact about the
  // shop's configuration. Same gate as the routes it reports on.
  const email = await verifyRequestEmail(req);
  if (!email || roleForEmail(email) !== 'owner') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const key = process.env.GOOGLE_GENAI_API_KEY;
  if (!key) {
    return NextResponse.json({ ready: false, reason: 'no_key' });
  }

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json({ ready: cached.ready, reason: cached.reason });
  }

  let ready = false;
  let reason: string | null = null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=1`,
      { signal: AbortSignal.timeout(6000) },
    );
    ready = res.ok;
    // A rejected key and an unreachable Google are different problems with different fixes,
    // and the settings page says which.
    reason = res.ok ? null : res.status === 400 || res.status === 403 ? 'bad_key' : 'unreachable';
  } catch {
    reason = 'unreachable';
  }

  cached = { at: Date.now(), ready, reason };
  return NextResponse.json({ ready, reason });
}
