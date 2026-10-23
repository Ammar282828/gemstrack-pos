/**
 * GET /api/website/analytics/live — who is on the house's website now (seen in the last five minutes), where,
 * on which page, from where; and today's running totals. The screen asks every 15 seconds.
 * Sessions quiet for over an hour are deleted here as well, in case the TTL policy on `expireAt` isn't set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { karachiDay } from '@/lib/website/piece-interest';
import { LIVE_MS, liveSummary, SITE_DAYS, SITE_LIVE, summarize, type DayDoc, type LiveDoc } from '@/lib/website/site-analytics';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff' && role !== 'marketing') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const now = Date.now();
  const live = adminDb.collection(SITE_LIVE);
  const [on, today, stale] = await Promise.all([
    live.where('at', '>=', now - LIVE_MS).orderBy('at', 'desc').limit(500).get(),
    adminDb.collection(SITE_DAYS).doc(karachiDay()).get(),
    live.where('at', '<', now - 3600_000).limit(200).get(),
  ]);
  if (!stale.empty) {
    const b = adminDb.batch();
    stale.docs.forEach(d => b.delete(d.ref));
    b.commit().catch(() => {});
  }
  const t = summarize(today.exists ? [today.data() as DayDoc] : []);
  return NextResponse.json({
    at: now,
    ...liveSummary(on.docs.map(d => d.data() as LiveDoc), now),
    today: {
      sessions: t.sessions, visitors: t.visitors, pageviews: t.pageviews, enquiries: t.funnel.enquire,
      saves: t.funnel.save, pieces: t.funnel.piece, conversion: t.conversion, bounceRate: t.bounceRate, avgSessionMs: t.avgSessionMs,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
