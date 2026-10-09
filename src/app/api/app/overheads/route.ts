/**
 * GET: the overhead sheet's plans for the iPhone app's Overheads screen (src/app/overheads/page.tsx),
 * resolved as the page resolves them: the saved plans, else the first-shape list, else the ERP's
 * starting sheet (lib/overheads.ts DEFAULT_OVERHEADS). The starting sheet lives in the ERP alone, so the
 * phone asks here rather than keeping a copy of it; the month-by-month score it works out itself from
 * the books it already has, with the same rules (ERPCore Overheads, ported from lib/overheads.ts).
 *
 * Owners only, as the page is.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { BENCHMARK_START } from '@/lib/overheads';
import { overheadPlansFrom } from '@/lib/writes/overheads';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') return NextResponse.json({ error: 'Not yours to see.' }, { status: 403 });
  const snap = await adminDb.collection('app_settings').doc('global').get();
  const data = snap.exists ? (snap.data() as Record<string, unknown>) : null;
  const saved = Array.isArray(data?.overheadPlans) && (data?.overheadPlans as unknown[]).length > 0;
  return NextResponse.json({ start: BENCHMARK_START, plans: overheadPlansFrom(data), saved });
}
