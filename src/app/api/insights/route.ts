/**
 * GET ?part=overview|posts|audience&range=last_28d → Insights: this house's Instagram account and
 * Facebook Page, organic and paid (lib/social-insights). Owners and the marketing account, like Ads.
 *
 * - overview: Instagram's totals against the period before, split ads / own posts, reels and
 *   stories, and followers / new people; Facebook Page's day by day; the ads' spend and results by
 *   platform; the follower history the hourly snapshot keeps.
 * - posts: every post, reel and Facebook post of the range with its numbers, and the stories
 *   (live now, and the ones the snapshot kept).
 * - audience: followers, the people reached and the people who engaged — age, gender, city,
 *   country — and the hours followers are online.
 *
 * - findings: what the three say, in words (shape.ts findingsFor) — the web and the iPhone app read the same.
 *
 * Kept five minutes per part and range (Meta rations Instagram insight calls per account);
 * `fresh=1` asks again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { accountSummary, loadAdsSettings } from '@/lib/ads/settings';
import { findingsFor, isInsightRange, previousWindow, windowFor, type InsightRange } from '@/lib/social-insights/shape';
import {
  facebookOverview, facebookPosts, instagramAudience, instagramOverview, instagramPosts, paidByPlatform, savedDays, savedStories,
  type Missing,
} from '@/lib/social-insights/fetch';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const cache = new Map<string, { at: number; body: unknown }>();
const TTL = 5 * 60_000;

type Part = 'overview' | 'posts' | 'audience' | 'findings';
type Settings = Awaited<ReturnType<typeof loadAdsSettings>>;

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  const asked = q.get('part');
  const part: Part = asked === 'posts' || asked === 'audience' || asked === 'findings' ? asked : 'overview';
  const range: InsightRange = isInsightRange(q.get('range')) ? (q.get('range') as InsightRange) : 'last_28d';
  try {
    const s = await loadAdsSettings();
    if (!s.instagramUserId && !s.pageId) {
      return NextResponse.json({ error: 'Choose this shop’s Instagram account and Facebook Page on Ads → Setup first.' }, { status: 409 });
    }
    const fresh = q.get('fresh') === '1';
    if (part !== 'findings') return NextResponse.json(await cached(part, range, s, fresh), { headers: noStore });
    // The findings read all three parts (kept five minutes, so the tabs after this open at once).
    const [o, p, a] = await Promise.all([cached('overview', range, s, fresh), cached('posts', range, s, fresh), cached('audience', range, s, fresh)]);
    const out = { findings: findingsFor(o as never, p as never, a as never, Date.now()), part, range, at: new Date().toISOString() };
    return NextResponse.json(out, { headers: noStore });
  } catch (e) {
    return adsFail(e, `insights ${part}`);
  }
}

/** One part for a range, kept five minutes; two callers at once share one trip to Meta. */
const inflight = new Map<string, Promise<Record<string, unknown>>>();
async function cached(part: Exclude<Part, 'findings'>, range: InsightRange, s: Settings, fresh: boolean): Promise<Record<string, unknown>> {
  const key = `${part}|${range}`;
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < TTL) return hit.body as Record<string, unknown>;
  const running = inflight.get(key);
  if (running) return running;
  const job = build(part, range, s).then(out => { cache.set(key, { at: Date.now(), body: out }); return out; }).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function build(part: Exclude<Part, 'findings'>, range: InsightRange, s: Settings): Promise<Record<string, unknown>> {
  const now = Date.now();
  const w = windowFor(range, now);
  const missing: Missing[] = [];
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
  let body: Record<string, unknown>;

  if (part === 'overview') {
    const [instagram, facebook, paid, history, account] = await Promise.all([
      s.instagramUserId ? instagramOverview(s.instagramUserId, w, now, missing).catch(e => { missing.push({ what: 'Instagram', why: why(e) }); return null; }) : null,
      s.pageId ? facebookOverview(s.pageId, w, now, missing).catch(e => { missing.push({ what: 'Facebook Page', why: why(e) }); return null; }) : null,
      s.adAccountId ? paidByPlatform(s.adAccountId, w).catch(e => { missing.push({ what: 'Ads by platform', why: why(e) }); return null; }) : null,
      savedDays({ ...w, since: previousWindow(w).since }).catch(() => []),
      s.adAccountId ? accountSummary(s.adAccountId).catch(() => null) : null,
    ]);
    body = { instagram, facebook, paid, history, currency: account?.currency ?? 'PKR' };
  } else if (part === 'posts') {
    const none = { posts: [], liveStories: [], lastPostAt: null };
    const [ig, fb, kept] = await Promise.all([
      s.instagramUserId ? instagramPosts(s.instagramUserId, w, missing).catch(e => { missing.push({ what: 'Instagram posts', why: why(e) }); return none; }) : none,
      s.pageId ? facebookPosts(s.pageId, w, missing).catch(e => { missing.push({ what: 'Facebook posts', why: why(e) }); return []; }) : [],
      savedStories(w).catch(() => []),
    ]);
    // A live story's fresh numbers win over the copy the snapshot kept an hour ago.
    const live = new Set(ig.liveStories.map(r => r.id));
    const stories = [...ig.liveStories, ...kept.filter(r => !live.has(r.id))].sort((a, b) => b.at.localeCompare(a.at));
    body = { posts: [...ig.posts, ...fb].sort((a, b) => b.at.localeCompare(a.at)), stories, liveStories: [...live], lastPostAt: ig.lastPostAt };
  } else {
    body = { audience: s.instagramUserId ? await instagramAudience(s.instagramUserId, missing) : null };
  }

  return {
    ...body, part, range, since: w.since, until: w.until, days: w.days, previous: previousWindow(w),
    instagram_username: s.instagramUsername, page_name: s.pageName,
    missing: missing.map(m => ({ what: m.what, why: m.why.slice(0, 200) })),
    at: new Date(now).toISOString(),
  };
}
