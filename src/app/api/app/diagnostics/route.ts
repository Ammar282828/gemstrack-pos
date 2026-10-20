/**
 * The iPhone app's crash and hang reports (apps/iphone/App/Support/Diagnostics.swift, from MetricKit): code
 * signatures only, no personal data. One document per upload in Firestore `app_diagnostics`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate } from '@/lib/push/gate';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const MAX_REPORTS = 20;
const KINDS = new Set(['crash', 'hang', 'cpu', 'disk', 'launch']);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);

export async function POST(req: NextRequest) {
  const email = await pushGate(req, 'owner-or-staff');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => null) as { reports?: unknown; business?: unknown; build?: unknown } | null;
  if (!body || !Array.isArray(body.reports) || body.reports.length === 0) {
    return NextResponse.json({ error: 'Not a report.' }, { status: 400 });
  }
  const reports = body.reports.slice(0, MAX_REPORTS).flatMap((r) => {
    const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
    const kind = str(o.kind, 20);
    if (!KINDS.has(kind)) return [];
    const frames = Array.isArray(o.frames) ? o.frames.slice(0, 16).map((f) => str(f, 120)).filter(Boolean) : [];
    return [{
      kind,
      appVersion: str(o.appVersion, 40),
      osVersion: str(o.osVersion, 60),
      device: str(o.device, 40),
      terminationReason: str(o.terminationReason, 200),
      exceptionType: int(o.exceptionType) ?? null,
      exceptionCode: int(o.exceptionCode) ?? null,
      signal: int(o.signal) ?? null,
      durationMs: int(o.durationMs) ?? null,
      frames,
    }];
  });
  if (reports.length === 0) return NextResponse.json({ error: 'Not a report.' }, { status: 400 });
  await adminDb.collection('app_diagnostics').add({
    email,
    at: new Date().toISOString(),
    business: str(body.business, 60),
    build: str(body.build, 40),
    reports,
  });
  return NextResponse.json({ ok: true });
}
