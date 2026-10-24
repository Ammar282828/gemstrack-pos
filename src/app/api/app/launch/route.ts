/**
 * The apps' cold-start report: each step of a launch in milliseconds from the moment the OS started the
 * process (iPhone: App/Device/LaunchClock.swift; Android: device/LaunchClock.kt), sent once per launch, so a slow start
 * says where its seconds went.
 * Read in Firestore `app_launches`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate } from '@/lib/push/gate';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const MAX_MARKS = 80;
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');

export async function POST(req: NextRequest) {
  const email = await pushGate(req, 'owner-or-staff');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => null) as { marks?: unknown; business?: unknown; build?: unknown; device?: unknown; platform?: unknown } | null;
  if (!body || !Array.isArray(body.marks) || body.marks.length === 0) {
    return NextResponse.json({ error: 'Not a report.' }, { status: 400 });
  }
  const marks = body.marks.slice(0, MAX_MARKS).flatMap((m) => {
    const o = (m && typeof m === 'object' ? m : {}) as { step?: unknown; ms?: unknown; detail?: unknown };
    const step = str(o.step, 60);
    if (!step || typeof o.ms !== 'number' || !Number.isFinite(o.ms)) return [];
    return [{ step, ms: Math.min(Math.max(Math.round(o.ms), 0), 3_600_000), detail: str(o.detail, 120) }];
  });
  if (marks.length === 0) return NextResponse.json({ error: 'Not a report.' }, { status: 400 });
  await adminDb.collection('app_launches').add({
    email,
    at: new Date().toISOString(),
    business: str(body.business, 60),
    build: str(body.build, 40),
    device: str(body.device, 40),
    // The iPhone sends none; the Android app says so.
    platform: str(body.platform, 20) === 'android' ? 'android' : 'ios',
    marks,
    totalMs: marks[marks.length - 1].ms,
  });
  return NextResponse.json({ ok: true });
}
