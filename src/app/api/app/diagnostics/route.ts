/**
 * The iPhone app's crash and hang reports, and its daily speed summary (kind "metrics": first draw, resume, hang,
 * scroll hitch, peak memory) (apps/iphone/App/Support/Diagnostics.swift, from MetricKit): code
 * signatures and numbers only, no personal data. One document per upload in Firestore `app_diagnostics`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate } from '@/lib/push/gate';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const MAX_REPORTS = 20;
const KINDS = new Set(['crash', 'hang', 'cpu', 'disk', 'launch', 'metrics']);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);

// The daily MetricKit summary ("metrics"): a handful of numbers and two short bucket lists, nothing else is kept.
const METRIC_KEYS = [
  'firstDrawP50Ms', 'firstDrawP90Ms', 'resumeP50Ms', 'resumeP90Ms', 'hangP50Ms', 'hangP90Ms', 'peakMemoryMb',
] as const;
function metricsOf(v: unknown): Record<string, unknown> {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of METRIC_KEYS) {
    const n = int(o[k]);
    if (n !== undefined) out[k] = n;
  }
  if (typeof o.scrollHitchRatio === 'number' && Number.isFinite(o.scrollHitchRatio)) {
    out.scrollHitchRatio = Math.round(o.scrollHitchRatio * 100) / 100;
  }
  for (const k of ['firstDrawBuckets', 'hangBuckets']) {
    const list = o[k];
    if (!Array.isArray(list)) continue;
    out[k] = list.slice(0, 12).map((b) => (Array.isArray(b) ? b.slice(0, 3).map((n) => int(n) ?? 0) : [])).filter((b) => b.length === 3);
  }
  return out;
}

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
      ...(kind === 'metrics' ? { metrics: metricsOf(o.metrics), periodHours: int(o.periodHours) ?? null } : {}),
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
