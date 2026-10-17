/**
 * Insights from Meta for this house: its Instagram account and Facebook Page (organic), and its
 * ads by platform (paid) — through the Ads connection, whose login already holds read_insights,
 * instagram_manage_insights and pages_read_engagement.
 *
 * Meta retires metrics without notice (page_impressions, page_fans, Instagram's impressions and
 * plays all went in 2025). Every group of metrics is asked for in one call and, if Meta refuses
 * it, one metric at a time, so a retired metric loses its own number and nothing else; what Meta
 * refused is listed in `missing`.
 *
 * Server-only.
 */

import { adminDb } from '@/lib/firebase-admin';
import { graph, graphAll, MetaAdsError, actId } from '@/lib/ads/meta';
import { insights } from '@/lib/ads/insights';
import { metricsOf, type Metrics } from '@/lib/ads/shape';
import {
  followsOf, kindOf, mediaValues, nonFollowerShare, onlineHours, partsOf, previousWindow, rateOf, seriesOf, splitBySurface,
  totalsOf, unixWindow, type Part, type PostRow, type Split, type Window,
} from './shape';

type Body = { data?: { name?: string; total_value?: { value?: number; breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[] }; values?: { value?: unknown; end_time?: string }[] }[] };

export interface Missing { what: string; why: string }

/** Ask; on a refusal, record it and answer null. */
async function soft<T>(what: string, missing: Missing[], run: () => Promise<T>): Promise<T | null> {
  try { return await run(); } catch (e) {
    missing.push({ what, why: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** Several metrics in one call; if Meta refuses the call, each alone, keeping the ones it answers. */
async function metricsCall(path: string, metrics: string[], params: Record<string, string | number>, missing: Missing[], token?: string): Promise<Body> {
  try {
    return await graph<Body>(path, { params: { ...params, metric: metrics.join(',') }, token });
  } catch (e) {
    if (!(e instanceof MetaAdsError) || metrics.length === 1) { missing.push({ what: metrics.join(', '), why: e instanceof Error ? e.message : String(e) }); return { data: [] }; }
    const parts = await Promise.all(metrics.map(m => graph<Body>(path, { params: { ...params, metric: m }, token })
      .catch(err => { missing.push({ what: m, why: err instanceof Error ? err.message : String(err) }); return { data: [] } as Body; })));
    return { data: parts.flatMap(p => p.data ?? []) };
  }
}

/** Run `fn` over `items`, `n` at a time — Meta rations calls, and a page of 50 posts is 50 calls. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// ── Instagram ─────────────────────────────────────────────────────────────

const IG_TOTALS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'replies', 'reposts', 'profile_views', 'website_clicks', 'profile_links_taps'];
const IG_COMPARE = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_views', 'website_clicks'];

export interface InstagramOverview {
  account: { id: string; username: string; name: string | null; picture: string | null; followers: number; posts: number };
  totals: Record<string, number>;
  previous: Record<string, number>;
  reach: Split | null; views: Split | null; interactions: Split | null;
  nonFollowerReach: number | null; nonFollowerViews: number | null;
  follows: { follows: number; unfollows: number; net: number } | null;
  previousFollows: { follows: number; unfollows: number; net: number } | null;
  contactTaps: Part[];
  daily: { date: string; reach: number; newFollowers: number }[];
}

export async function instagramOverview(ig: string, w: Window, now: number, missing: Missing[]): Promise<InstagramOverview> {
  const u = unixWindow(w, now), pu = unixWindow(previousWindow(w), now);
  const tv = { period: 'day', metric_type: 'total_value' };
  const br = (metric: string, breakdown: string) => soft(`${metric} by ${breakdown}`, missing, () =>
    graph<Body>(`${ig}/insights`, { params: { ...tv, metric, breakdown, since: u.since, until: u.until } }));
  const [acct, totals, prev, reachS, viewsS, interS, reachF, viewsF, follows, prevFollows, taps, daily] = await Promise.all([
    graph<{ id: string; username: string; name?: string; profile_picture_url?: string; followers_count?: number; media_count?: number }>(ig, { params: { fields: 'id,username,name,profile_picture_url,followers_count,media_count' } }),
    metricsCall(`${ig}/insights`, IG_TOTALS, { ...tv, since: u.since, until: u.until }, missing),
    metricsCall(`${ig}/insights`, IG_COMPARE, { ...tv, since: pu.since, until: pu.until }, missing),
    br('reach', 'media_product_type'), br('views', 'media_product_type'), br('total_interactions', 'media_product_type'),
    br('reach', 'follow_type'), br('views', 'follow_type'),
    br('follows_and_unfollows', 'follow_type'),
    soft('follows before', missing, () => graph<Body>(`${ig}/insights`, { params: { ...tv, metric: 'follows_and_unfollows', breakdown: 'follow_type', since: pu.since, until: pu.until } })),
    br('profile_links_taps', 'contact_button_type'),
    metricsCall(`${ig}/insights`, ['reach', 'follower_count'], { period: 'day', since: u.since, until: u.until }, missing),
  ]);
  const reachDays = seriesOf(daily, 'reach'), followerDays = seriesOf(daily, 'follower_count');
  const byDate = new Map<string, { date: string; reach: number; newFollowers: number }>();
  for (const d of reachDays) byDate.set(d.date, { date: d.date, reach: d.value, newFollowers: 0 });
  for (const d of followerDays) byDate.set(d.date, { ...(byDate.get(d.date) ?? { date: d.date, reach: 0, newFollowers: 0 }), newFollowers: d.value });
  return {
    account: { id: acct.id, username: acct.username, name: acct.name ?? null, picture: acct.profile_picture_url ?? null, followers: acct.followers_count ?? 0, posts: acct.media_count ?? 0 },
    totals: totalsOf(totals),
    previous: totalsOf(prev),
    reach: reachS ? splitBySurface(partsOf(reachS)) : null,
    views: viewsS ? splitBySurface(partsOf(viewsS)) : null,
    interactions: interS ? splitBySurface(partsOf(interS)) : null,
    nonFollowerReach: reachF ? nonFollowerShare(partsOf(reachF)) : null,
    nonFollowerViews: viewsF ? nonFollowerShare(partsOf(viewsF)) : null,
    follows: follows ? followsOf(partsOf(follows)) : null,
    previousFollows: prevFollows ? followsOf(partsOf(prevFollows)) : null,
    contactTaps: taps ? partsOf(taps) : [],
    daily: [...byDate.values()].filter(d => d.date >= w.since && d.date <= w.until).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export interface Audience {
  followers: Record<'age' | 'gender' | 'city' | 'country', Part[]>;
  reached: Record<'age' | 'gender' | 'city' | 'country', Part[]>;
  engaged: Record<'age' | 'gender' | 'city' | 'country', Part[]>;
  /** Followers online per hour of the day, Karachi time; null when Meta shares none (small accounts). */
  online: number[] | null;
}

const DIMS = ['age', 'gender', 'city', 'country'] as const;

export async function instagramAudience(ig: string, missing: Missing[]): Promise<Audience> {
  const one = (metric: string, breakdown: string) => soft(`${metric} by ${breakdown}`, missing, () =>
    graph<Body>(`${ig}/insights`, { params: { metric, breakdown, period: 'lifetime', metric_type: 'total_value', ...(metric === 'follower_demographics' ? {} : { timeframe: 'this_month' }) } }))
    .then(b => (b ? partsOf(b) : []));
  const group = async (metric: string) => Object.fromEntries(await Promise.all(DIMS.map(async d => [d, await one(metric, d)] as const))) as Record<typeof DIMS[number], Part[]>;
  const now = Math.floor(Date.now() / 1000);
  const [followers, reached, engaged, online] = await Promise.all([
    group('follower_demographics'), group('reached_audience_demographics'), group('engaged_audience_demographics'),
    soft('online followers', missing, () => graph<Body>(`${ig}/insights`, { params: { metric: 'online_followers', period: 'lifetime', since: now - 86_400, until: now } })),
  ]);
  const v = online?.data?.[0]?.values?.[0];
  return { followers, reached, engaged, online: onlineHours((v?.value ?? null) as Record<string, number> | null, v?.end_time) };
}

const FEED_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'profile_visits', 'follows'];
const REEL_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions', 'ig_reels_avg_watch_time', 'facebook_views'];
export const STORY_METRICS = ['reach', 'views', 'replies', 'shares', 'total_interactions', 'follows', 'profile_visits', 'navigation'];

interface IgMedia { id: string; caption?: string; media_type?: string; media_product_type?: string; timestamp?: string; permalink?: string; thumbnail_url?: string; media_url?: string; like_count?: number; comments_count?: number }

export function igRow(m: IgMedia, v: Record<string, number>): PostRow {
  const n = (k: string) => (k in v ? v[k] : null);
  const kind = kindOf(m.media_product_type, m.media_type);
  const interactions = n('total_interactions');
  return {
    id: m.id, platform: 'instagram', kind, at: m.timestamp ?? '', caption: (m.caption ?? '').slice(0, 140),
    thumb: m.thumbnail_url ?? (m.media_type === 'VIDEO' ? null : m.media_url ?? null), link: m.permalink ?? null,
    reach: n('reach'), views: n('views'), likes: n('likes') ?? m.like_count ?? null, comments: n('comments') ?? m.comments_count ?? null,
    shares: n('shares'), saves: n('saved'), interactions,
    profileVisits: n('profile_visits'), follows: n('follows'), avgWatchMs: n('ig_reels_avg_watch_time'), facebookViews: n('facebook_views'),
    clicks: null, replies: n('replies'), rate: rateOf(interactions, n('reach')),
  };
}

/**
 * Instagram's latest 50 posts and reels with their lifetime numbers — the range's own and the
 * older ones still being watched (a reel can carry a month it wasn't posted in) — and the stories
 * up now. `older` marks a post from before the range.
 */
export async function instagramPosts(ig: string, w: Window, missing: Missing[]): Promise<{ posts: PostRow[]; liveStories: PostRow[]; lastPostAt: string | null }> {
  const fields = 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count';
  const since = `${w.since}T00:00:00+05:00`;
  const [media, stories] = await Promise.all([
    soft('Instagram posts', missing, () => graphAll<IgMedia>(`${ig}/media`, { fields, limit: 50 }, 50)),
    soft('Instagram stories', missing, () => graphAll<IgMedia>(`${ig}/stories`, { fields }, 50)),
  ]);
  const quiet: Missing[] = []; // a single post's missing metric isn't worth a line on the page
  const rows = await pool(media ?? [], 6, async m => {
    const list = m.media_product_type === 'REELS' ? REEL_METRICS : FEED_METRICS;
    const row = igRow(m, mediaValues(await metricsCall(`${m.id}/insights`, list, {}, quiet)));
    return (m.timestamp ?? '') < since.slice(0, 10) ? { ...row, older: true } : row;
  });
  const live = await pool(stories ?? [], 6, async m => igRow(m, mediaValues(await metricsCall(`${m.id}/insights`, STORY_METRICS, {}, quiet))));
  return { posts: rows, liveStories: live, lastPostAt: media?.[0]?.timestamp ?? null };
}

// ── Facebook Page ─────────────────────────────────────────────────────────

const PAGE_DAILY = ['page_media_view', 'page_total_media_view_unique', 'page_post_engagements', 'page_views_total', 'page_daily_follows_unique', 'page_daily_unfollows_unique', 'page_video_views'];

export interface FacebookOverview {
  page: { id: string; name: string; followers: number; picture: string | null };
  totals: Record<string, number>;
  previous: Record<string, number>;
  daily: { date: string; views: number; viewers: number; engagement: number; follows: number; unfollows: number }[];
}

let pageTokens = new Map<string, { token: string; at: number }>();
/** Page insights need the Page's own token, which the user's token hands out. */
async function pageToken(page: string): Promise<string> {
  const hit = pageTokens.get(page);
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.token;
  const r = await graph<{ access_token?: string }>(page, { params: { fields: 'access_token' } });
  if (!r.access_token) throw new MetaAdsError('Meta gave no Page token: the Facebook login must manage this Page.', 403);
  pageTokens = new Map(pageTokens).set(page, { token: r.access_token, at: Date.now() });
  return r.access_token;
}

const sumSeries = (body: Body, name: string) => seriesOf(body, name).reduce((s, d) => s + d.value, 0);

export async function facebookOverview(page: string, w: Window, now: number, missing: Missing[]): Promise<FacebookOverview> {
  const token = await pageToken(page);
  const u = unixWindow(w, now), pu = unixWindow(previousWindow(w), now);
  const [info, cur, prev] = await Promise.all([
    graph<{ id: string; name: string; followers_count?: number; fan_count?: number; picture?: { data?: { url?: string } } }>(page, { params: { fields: 'id,name,followers_count,fan_count,picture{url}' }, token }),
    metricsCall(`${page}/insights`, PAGE_DAILY, { period: 'day', since: u.since, until: u.until }, missing, token),
    metricsCall(`${page}/insights`, PAGE_DAILY, { period: 'day', since: pu.since, until: pu.until }, missing, token),
  ]);
  const totals = Object.fromEntries(PAGE_DAILY.map(m => [m, sumSeries(cur, m)]));
  const previous = Object.fromEntries(PAGE_DAILY.map(m => [m, sumSeries(prev, m)]));
  const days = new Map<string, FacebookOverview['daily'][number]>();
  const put = (m: string, k: keyof Omit<FacebookOverview['daily'][number], 'date'>) => {
    for (const d of seriesOf(cur, m)) days.set(d.date, { ...(days.get(d.date) ?? { date: d.date, views: 0, viewers: 0, engagement: 0, follows: 0, unfollows: 0 }), [k]: d.value });
  };
  put('page_media_view', 'views'); put('page_total_media_view_unique', 'viewers'); put('page_post_engagements', 'engagement');
  put('page_daily_follows_unique', 'follows'); put('page_daily_unfollows_unique', 'unfollows');
  return {
    page: { id: info.id, name: info.name, followers: info.followers_count ?? info.fan_count ?? 0, picture: info.picture?.data?.url ?? null },
    totals, previous,
    daily: [...days.values()].filter(d => d.date >= w.since && d.date <= w.until).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

interface FbPost { id: string; created_time?: string; message?: string; permalink_url?: string; full_picture?: string; shares?: { count?: number }; comments?: { summary?: { total_count?: number } }; reactions?: { summary?: { total_count?: number } } }

export async function facebookPosts(page: string, w: Window, missing: Missing[]): Promise<PostRow[]> {
  const token = await pageToken(page);
  const posts = await soft('Facebook posts', missing, async () => {
    const first = await graph<{ data?: FbPost[] }>(`${page}/posts`, { token, params: { fields: 'id,created_time,message,permalink_url,full_picture,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)', since: `${w.since}T00:00:00+05:00`, limit: 50 } });
    return first.data ?? [];
  });
  const quiet: Missing[] = [];
  return pool(posts ?? [], 6, async p => {
    const v = mediaValues(await metricsCall(`${p.id}/insights`, ['post_media_view', 'post_total_media_view_unique', 'post_clicks'], {}, quiet, token));
    const reactions = p.reactions?.summary?.total_count ?? 0, comments = p.comments?.summary?.total_count ?? 0, shares = p.shares?.count ?? 0;
    const reach = v.post_total_media_view_unique ?? null;
    const interactions = reactions + comments + shares;
    return {
      id: p.id, platform: 'facebook' as const, kind: 'fb' as const, at: p.created_time ?? '', caption: (p.message ?? '').slice(0, 140),
      thumb: p.full_picture ?? null, link: p.permalink_url ?? null,
      reach, views: v.post_media_view ?? null, likes: reactions, comments, shares, saves: null, interactions,
      profileVisits: null, follows: null, avgWatchMs: null, facebookViews: null, clicks: v.post_clicks ?? null, replies: null,
      rate: rateOf(interactions, reach),
    };
  });
}

// ── Paid, by platform ─────────────────────────────────────────────────────

export interface PlatformSpend { platform: string; metrics: Metrics }

/** The ad account's spend and results over the window, split Facebook / Instagram / the rest. */
export async function paidByPlatform(adAccount: string, w: Window): Promise<{ now: PlatformSpend[]; before: PlatformSpend[] }> {
  const fields = ['spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'actions', 'action_values'];
  const prev = previousWindow(w);
  const run = async (win: Window) => (await insights(actId(adAccount), fields, { time_range: { since: win.since, until: win.until }, breakdowns: 'publisher_platform' }, 20))
    .map(r => ({ platform: String(r.publisher_platform ?? 'other'), metrics: metricsOf(r) }));
  const [now, before] = await Promise.all([run(w), run(prev).catch(() => [])]);
  return { now, before };
}

// ── Kept by the snapshot (snapshot.ts) ────────────────────────────────────

export interface DailySnapshot { date: string; igFollowers: number | null; fbFollowers: number | null; at: string }

export async function savedDays(w: Window): Promise<DailySnapshot[]> {
  const snap = await adminDb.collection('social_daily').where('date', '>=', w.since).where('date', '<=', w.until).get();
  return snap.docs.map(d => d.data() as DailySnapshot).sort((a, b) => a.date.localeCompare(b.date));
}

/** Stories that ran in the window, with the last numbers the snapshot read while each was up. */
export async function savedStories(w: Window): Promise<PostRow[]> {
  const snap = await adminDb.collection('social_stories').where('at', '>=', `${w.since}T00:00:00`).orderBy('at', 'desc').limit(200).get();
  return snap.docs.map(d => d.data() as PostRow);
}
