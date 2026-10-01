/**
 * A sign-in that went wrong, reported by the sign-in screen (lib/sign-in-trouble.ts).
 *
 * Google's sign-in fails on the phone, before the ERP hears anything — a karigar who could not
 * get in left no trace for a month (2026-10-01). The screen now posts what happened here and it
 * goes to the server log, one line, nothing stored:
 *   gcloud logging read 'textPayload:"[sign-in]"' --project <project>
 * Open to anyone (nobody is signed in yet), so every field is cut short and kept to plain
 * characters, and 30 reports an hour from one address are logged; the rest are dropped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, callerKey } from '@/lib/website/ratelimit';

export const dynamic = 'force-dynamic';

const STAGES = ['start', 'failed', 'refused', 'check-failed'] as const;
const plain = (v: unknown, max: number) => String(v ?? '').replace(/[^\w@.+:/ ()-]/g, '').slice(0, max);

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const stage = (STAGES as readonly string[]).includes(String(b.stage)) ? String(b.stage) : 'failed';
  const limit = await rateLimit('signin-trouble', callerKey(req.headers), 30, 3600).catch(() => ({ ok: true }));
  if (!limit.ok) return new NextResponse(null, { status: 204 });
  console.warn(`[sign-in] ${stage}`
    + ` code=${plain(b.code, 60) || '-'} email=${plain(b.email, 80) || '-'} status=${plain(b.status, 6) || '-'}`
    + ` inApp=${plain(b.inApp, 20) || 'no'} standalone=${b.standalone ? 'yes' : 'no'} host=${plain(b.host, 60) || '-'}`
    + ` ua=${plain(req.headers.get('user-agent'), 160) || '-'}`);
  return new NextResponse(null, { status: 204 });
}
