/**
 * GET /api/website/analytics?range=today|yesterday|7d|30d|90d|all|custom[&from=YYYY-MM-DD&to=YYYY-MM-DD]
 * — the house's website over a period and the period before it (lib/website/site-analytics.ts): sessions,
 * visitors, pages, time, bounce, the funnel, sources, places, devices, pages in and out, searches, 404s.
 * Owners, staff and marketing, like Interest (/api/website/interest keeps the per-piece rankings).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { karachiDay } from '@/lib/website/piece-interest';
import { addDays, daysBetween, period, series, SITE_DAYS, SITE_VISITORS, summarize, type DayDoc } from '@/lib/website/site-analytics';

export const dynamic = 'force-dynamic';

async function readDays(from: string, to: string): Promise<DayDoc[]> {
  const snap = await adminDb.collection(SITE_DAYS).where('day', '>=', from).where('day', '<=', to).get();
  return snap.docs.map(d => d.data() as DayDoc);
}

/**
 * Unique visitors over a period, from the random ids' days: exact for a period ending today (seen since `from`)
 * or of up to 30 days (any of its days); longer past periods add up each day's visitors and say so.
 */
async function uniqueVisitors(from: string, to: string, today: string, days: DayDoc[]): Promise<{ n: number; exact: boolean }> {
  const col = adminDb.collection(SITE_VISITORS);
  try {
    if (to >= today) return { n: (await col.where('last', '>=', from).count().get()).data().count, exact: true };
    if (daysBetween(from, to) <= 30) {
      const list: string[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) list.push(d);
      return { n: (await col.where('days', 'array-contains-any', list).count().get()).data().count, exact: true };
    }
  } catch (e) { console.warn('[analytics] visitor count:', e instanceof Error ? e.message : e); }
  return { n: days.reduce((a, d) => a + (d.visitors || 0), 0), exact: false };
}

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff' && role !== 'marketing') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const q = req.nextUrl.searchParams;
  const today = karachiDay();
  const first = await adminDb.collection(SITE_DAYS).orderBy('day').limit(1).get();
  const since = first.empty ? null : (first.docs[0].data().day as string);
  const p = period({ range: q.get('range'), from: q.get('from'), to: q.get('to') }, today, since);
  if (p.days > 800) return NextResponse.json({ error: 'Pick a period of two years or less.' }, { status: 400 });

  const [nowDays, beforeDays] = await Promise.all([readDays(p.from, p.to), readDays(p.previous.from, p.previous.to)]);
  const now = summarize(nowDays), before = summarize(beforeDays);
  const [vNow, vBefore] = await Promise.all([uniqueVisitors(p.from, p.to, today, nowDays), uniqueVisitors(p.previous.from, p.previous.to, today, beforeDays)]);
  now.visitors = vNow.n; before.visitors = vBefore.n;

  // One day: its sessions by the hour, as Shopify's Today does.
  const hours = p.days === 1 ? Array.from({ length: 24 }, (_, h) => {
    const k = String(h).padStart(2, '0');
    return { hour: h, sessions: nowDays[0]?.hours?.[k] ?? 0, before: beforeDays[0]?.hours?.[k] ?? 0 };
  }) : null;

  return NextResponse.json({
    ...p, today, since, visitorsExact: vNow.exact,
    now, before, series: series(nowDays, p.from, p.to), hours,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
