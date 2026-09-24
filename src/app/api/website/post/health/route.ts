/**
 * Post a Piece — is everything working, and if not, what to do.
 *
 *   GET  [?fresh=1]  → every check (see src/lib/social/health.ts), the last
 *                      day's recorded failures, and the context the page needs
 *                      to word its own error messages the same way. fresh=1
 *                      re-runs the AI check instead of using the ten-minute copy.
 *   POST { where, message, status? } → record a failure the page saw itself
 *                      (website uploads go through the shared Add Photos route,
 *                      which does not log for us).
 */

import { NextRequest, NextResponse } from 'next/server';
import { postGate } from '@/lib/social/gate';
import { runChecks } from '@/lib/social/health';
import { diagnoseContext, recordError } from '@/lib/social/errors';
import type { Where } from '@/lib/social/diagnose';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WHERES: Where[] = ['website', 'featured', 'whatsapp', 'instagram', 'instagram-connect', 'ai', 'caption', 'network', 'page'];

export async function GET(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const report = await runChecks({ freshAi: req.nextUrl.searchParams.get('fresh') === '1' });
  return NextResponse.json({ ...report, context: diagnoseContext() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const b = await req.json().catch(() => null) as { where?: string; message?: string; status?: number } | null;
  if (!b?.message || !WHERES.includes(b.where as Where)) return NextResponse.json({ error: 'Send { where, message }.' }, { status: 400 });
  const err = Object.assign(new Error(String(b.message).slice(0, 500)), typeof b.status === 'number' ? { status: b.status } : {});
  await recordError(b.where as Where, err, { by: who, reportedBy: 'page' });
  return NextResponse.json({ ok: true });
}
