/**
 * Insights' vocabulary: what Meta says about this house's Instagram account and Facebook Page,
 * organic and paid, shaped for the page. Shared by the browser and the server, so nothing here
 * touches the network or Firebase.
 *
 * What Meta gives (probed live on both houses, v25/v26, 2026-10-17 — it retires metrics often):
 * - Instagram account, over ≤ 30 days: reach, views, accounts engaged, interactions (likes,
 *   comments, shares, saves, replies, reposts), profile views, website taps, contact taps,
 *   follows and unfollows — each as one total, several split by surface (post / reel / story /
 *   AD) or by follower vs not. Day by day only reach and new followers.
 * - Its audience, as it is now (no history): followers, the people reached and the people who
 *   engaged, by age, gender, city and country; and when followers are online.
 * - Each post / reel / story: reach, views, likes, comments, shares, saves, interactions (posts:
 *   profile visits and follows; reels: watch time and views on Facebook). A story's numbers exist
 *   only while it is up, which is why the hourly snapshot keeps them (snapshot.ts).
 * - The Facebook Page, day by day: views and viewers, engagement, page visits, follows and
 *   unfollows, video views; each post's views, viewers, clicks and reactions. Page impressions and
 *   fan demographics are gone from the API.
 * - Paid: Ads Insights by platform (lib/ads/insights.ts), so Instagram and Facebook ads sit beside
 *   what the account did by itself.
 */

// ── Ranges ─────────────────────────────────────────────────────────────────

/** Instagram answers totals over at most 30 days, so the ranges stop there. */
export const INSIGHT_RANGES = [
  { key: 'last_7d', label: 'Last 7 days', days: 7 },
  { key: 'last_14d', label: 'Last 14 days', days: 14 },
  { key: 'last_28d', label: 'Last 28 days', days: 28 },
  { key: 'this_month', label: 'This month', days: 0 },
] as const;
export type InsightRange = typeof INSIGHT_RANGES[number]['key'];
export const isInsightRange = (v: unknown): v is InsightRange => INSIGHT_RANGES.some(r => r.key === v);

/** Karachi has no daylight saving: UTC+5 all year. */
const PK = 5 * 3600_000;
export const pkDay = (t: number) => new Date(t + PK).toISOString().slice(0, 10);
const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`) - PK;

export interface Window { since: string; until: string; days: number }

/** The range's days in Karachi, today included. "This month" from the 1st, at most 30 days. */
export function windowFor(key: InsightRange, now: number): Window {
  const until = pkDay(now);
  let days: number = INSIGHT_RANGES.find(r => r.key === key)?.days ?? 7;
  if (key === 'this_month') days = Math.min(30, Number(until.slice(8, 10)));
  const since = pkDay(dayStart(until) - (days - 1) * 86_400_000 + 3600_000);
  return { since, until, days };
}

/** The same number of days just before. */
export function previousWindow(w: Window): Window {
  const until = pkDay(dayStart(w.since) - 3600_000);
  const since = pkDay(dayStart(until) - (w.days - 1) * 86_400_000 + 3600_000);
  return { since, until, days: w.days };
}

/** Unix seconds for Meta's since/until: the first day's start, and the last day's end or now. */
export function unixWindow(w: Window, now: number): { since: number; until: number } {
  return { since: Math.floor(dayStart(w.since) / 1000), until: Math.floor(Math.min(now, dayStart(w.until) + 86_400_000) / 1000) };
}

// ── Reading Meta's answers ────────────────────────────────────────────────

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export interface Part { key: string; value: number }
type TotalRow = { name?: string; total_value?: { value?: number; breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[] }; values?: { value?: unknown; end_time?: string }[] };

/** `metric_type=total_value` → { reach: 18556, views: 24830, … }; a metric Meta left out is missing. */
export function totalsOf(body: { data?: TotalRow[] } | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of body?.data ?? []) if (r.name && r.total_value && typeof r.total_value.value === 'number') out[r.name] = r.total_value.value;
  return out;
}

/** One metric's breakdown → its parts, largest first. */
export function partsOf(body: { data?: TotalRow[] } | null | undefined): Part[] {
  const results = body?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
  const m = new Map<string, number>();
  for (const r of results) { const k = (r.dimension_values ?? []).join(' · ') || '—'; m.set(k, (m.get(k) ?? 0) + num(r.value)); }
  return [...m].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
}

/** `period=day` → [{date, value}] in Karachi days (Meta stamps the day's end). */
export function seriesOf(body: { data?: TotalRow[] } | null | undefined, name?: string): { date: string; value: number }[] {
  const row = (body?.data ?? []).find(r => !name || r.name === name);
  return (row?.values ?? []).map(v => ({ date: pkDay(Date.parse(String(v.end_time)) - 3600_000), value: num(v.value) }));
}

// ── Paid and organic ──────────────────────────────────────────────────────

const SURFACE: Record<string, string> = { POST: 'Posts', CAROUSEL_CONTAINER: 'Carousels', REEL: 'Reels', STORY: 'Stories', AD: 'Ads', IGTV: 'Video', LIVE: 'Live' };
export const surfaceLabel = (k: string) => SURFACE[k] ?? k.charAt(0) + k.slice(1).toLowerCase().replace(/_/g, ' ');

export interface Split { ads: number; organic: number; adsShare: number | null; bySurface: Part[] }

/**
 * A metric split by `media_product_type`: what came through ads, and what the account's own posts,
 * reels and stories did. For reach these are counts per surface (one person can be in two), so the
 * share is of the parts, not of the account's unique reach.
 */
export function splitBySurface(parts: Part[]): Split {
  const ads = parts.filter(p => p.key === 'AD').reduce((s, p) => s + p.value, 0);
  const own = parts.filter(p => p.key !== 'AD');
  const organic = own.reduce((s, p) => s + p.value, 0);
  return { ads, organic, adsShare: ads + organic > 0 ? ads / (ads + organic) : null, bySurface: own.map(p => ({ key: p.key, value: p.value })) };
}

/** `follows_and_unfollows` by `follow_type`: FOLLOWER are the follows, NON_FOLLOWER the unfollows. */
export function followsOf(parts: Part[]): { follows: number; unfollows: number; net: number } {
  const follows = parts.find(p => p.key === 'FOLLOWER')?.value ?? 0;
  const unfollows = parts.find(p => p.key === 'NON_FOLLOWER')?.value ?? 0;
  return { follows, unfollows, net: follows - unfollows };
}

/** reach / views by `follow_type`: how much reached people who don't follow yet. */
export function nonFollowerShare(parts: Part[]): number | null {
  const fol = parts.find(p => p.key === 'FOLLOWER')?.value ?? 0;
  const non = parts.find(p => p.key === 'NON_FOLLOWER')?.value ?? 0;
  return fol + non > 0 ? non / (fol + non) : null;
}

// ── Audience ──────────────────────────────────────────────────────────────

export interface Share { key: string; value: number; share: number }
/** Parts as shares of their sum, largest first, the rest folded into "Other" after `top`. */
export function sharesOf(parts: Part[], top = 8): Share[] {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const sorted = [...parts].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, top).map(p => ({ ...p, share: p.value / total }));
  const rest = sorted.slice(top).reduce((s, p) => s + p.value, 0);
  return rest > 0 ? [...head, { key: 'Other', value: rest, share: rest / total }] : head;
}

const GENDER: Record<string, string> = { F: 'Women', M: 'Men', U: 'Not said' };
export const genderLabel = (k: string) => GENDER[k] ?? k;

const COUNTRY: Record<string, string> = { PK: 'Pakistan', AE: 'UAE', SA: 'Saudi Arabia', GB: 'United Kingdom', US: 'United States', CA: 'Canada', AU: 'Australia', IN: 'India', BD: 'Bangladesh', DE: 'Germany', QA: 'Qatar', OM: 'Oman', KW: 'Kuwait', BH: 'Bahrain', NO: 'Norway', FI: 'Finland', RS: 'Serbia', TR: 'Türkiye', MY: 'Malaysia', NZ: 'New Zealand' };
export const countryLabel = (k: string) => COUNTRY[k] ?? k;

/**
 * `online_followers` → followers online per hour of the day in Karachi. Meta counts the hours in
 * Pacific time (its documented zone), so each is moved by Pacific's offset that day.
 */
export function onlineHours(value: Record<string, number> | null | undefined, endTime: string | undefined): number[] | null {
  const entries = Object.entries(value ?? {});
  if (!entries.length) return null;
  const at = Date.parse(endTime ?? '') || Date.now();
  const pacific = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', timeZoneName: 'shortOffset' }).formatToParts(new Date(at)).find(p => p.type === 'timeZoneName')?.value ?? 'GMT-8';
  const off = Number(pacific.replace('GMT', '')) || -8;
  const shift = 5 - off; // Karachi is UTC+5
  const hours = Array<number>(24).fill(0);
  for (const [h, v] of entries) hours[(((Number(h) + shift) % 24) + 24) % 24] += num(v);
  return hours;
}

/** The best two-hour window in a 24-hour list: its start hour and its share of the day. */
export function bestHours(hours: number[] | null): { start: number; share: number } | null {
  if (!hours || hours.length !== 24) return null;
  const total = hours.reduce((s, v) => s + v, 0);
  if (!total) return null;
  let best = 0, bestV = -1;
  for (let h = 0; h < 24; h++) { const v = hours[h] + hours[(h + 1) % 24]; if (v > bestV) { bestV = v; best = h; } }
  return { start: best, share: bestV / total };
}
export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;

// ── Posts ─────────────────────────────────────────────────────────────────

export type PostKind = 'post' | 'carousel' | 'reel' | 'story' | 'fb';
export interface PostRow {
  id: string; platform: 'instagram' | 'facebook'; kind: PostKind;
  at: string; caption: string; thumb: string | null; link: string | null;
  reach: number | null; views: number | null;
  likes: number | null; comments: number | null; shares: number | null; saves: number | null;
  interactions: number | null;
  profileVisits: number | null; follows: number | null;
  /** Reels: average watch in ms, and views it got on Facebook through cross-posting. */
  avgWatchMs: number | null; facebookViews: number | null;
  /** Facebook posts: clicks. Stories: taps forward/back, exits, replies (navigation). */
  clicks: number | null; replies: number | null;
  /** Interactions over reach. */
  rate: number | null;
  /** Posted before the range (its numbers are lifetime, still growing). */
  older?: boolean;
}

/** Instagram's media_product_type + media_type → the kind the page shows. */
export function kindOf(product: string | undefined, type: string | undefined): PostKind {
  if (product === 'REELS') return 'reel';
  if (product === 'STORY') return 'story';
  if (type === 'CAROUSEL_ALBUM') return 'carousel';
  return 'post';
}

/** One media's `insights` answer (every metric at once, or several answers merged) → numbers by name. */
export function mediaValues(...bodies: ({ data?: TotalRow[] } | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bodies) for (const r of b?.data ?? []) {
    if (!r.name) continue;
    const v = r.values?.[0]?.value ?? r.total_value?.value;
    if (typeof v === 'number') out[r.name] = v;
    else if (v && typeof v === 'object') out[r.name] = Object.values(v as Record<string, unknown>).reduce<number>((s, x) => s + num(x), 0);
  }
  return out;
}

export const rateOf = (interactions: number | null, reach: number | null) =>
  interactions !== null && reach ? interactions / reach : null;

/** Per kind: how many, and their median reach and engagement rate — which format works for this house. */
export function byKind(rows: PostRow[]): { kind: PostKind; n: number; medianReach: number | null; medianRate: number | null }[] {
  const med = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const kinds = [...new Set(rows.map(r => r.kind))];
  return kinds.map(kind => {
    const rs = rows.filter(r => r.kind === kind);
    return { kind, n: rs.length, medianReach: med(rs.map(r => r.reach).filter((x): x is number => x !== null)), medianRate: med(rs.map(r => r.rate).filter((x): x is number => x !== null)) };
  }).sort((a, b) => b.n - a.n);
}

export const KIND_LABEL: Record<PostKind, string> = { post: 'Photo posts', carousel: 'Carousels', reel: 'Reels', story: 'Stories', fb: 'Facebook posts' };

// ── What it means ─────────────────────────────────────────────────────────

export interface Finding { tone: 'good' | 'warn' | 'info'; title: string; why: string }

export interface FindingInput {
  reachSplit: Split | null;
  nonFollowerReach: number | null;
  follows: { follows: number; unfollows: number; net: number } | null;
  followers: number | null;
  kinds: ReturnType<typeof byKind>;
  profileViews: number | null; websiteTaps: number | null;
  followerCountries: Share[];
  best: { start: number; share: number } | null;
  paidSpend: number; currency: string;
  /** Instagram: when the latest post went up, how many went up in the range, and the range's total views. */
  lastPostAt?: string | null; postsInRange?: number; totalViews?: number | null;
  /** The post with the most views among the latest ones (lifetime), with its views. */
  topPost?: { kind: PostKind; at: string; views: number; older: boolean } | null;
  now?: number;
}

/**
 * The few things the numbers say that the owner wouldn't see by reading them one by one. Each
 * finding is only made when the data behind it is there and big enough to mean something.
 */
export function findings(x: FindingInput): Finding[] {
  const out: Finding[] = [];
  const pc = (v: number) => `${Math.round(v * 100)}%`;
  if (x.reachSplit?.adsShare !== null && x.reachSplit && x.reachSplit.ads + x.reachSplit.organic >= 200) {
    const s = x.reachSplit.adsShare!;
    if (s >= 0.7) out.push({ tone: 'warn', title: `${pc(s)} of the reach came from ads`, why: `The account's own posts, reels and stories reached about ${x.reachSplit.organic.toLocaleString('en-US')}. When the ads stop, so does most of the reach — the organic side needs its own push (reels, collaborations, reposts).` });
    else if (s <= 0.25 && x.paidSpend > 0) out.push({ tone: 'good', title: `Mostly organic: ${pc(1 - s)} of the reach came without ads`, why: 'The account carries itself; ads are adding to it rather than holding it up.' });
  }
  const reel = x.kinds.find(k => k.kind === 'reel'), photo = x.kinds.find(k => k.kind === 'post' || k.kind === 'carousel');
  if (reel?.medianReach && photo?.medianReach && reel.n >= 2 && photo.n >= 2) {
    const r = reel.medianReach / photo.medianReach;
    if (r >= 1.5) out.push({ tone: 'info', title: `A reel reaches ${r.toFixed(1)}× what a photo post does`, why: `Median reach: reels ${Math.round(reel.medianReach).toLocaleString('en-US')}, photo posts ${Math.round(photo.medianReach).toLocaleString('en-US')}. The same piece as a short reel goes further.` });
    else if (r <= 0.67) out.push({ tone: 'info', title: `Photo posts reach more than reels here`, why: `Median reach: photo posts ${Math.round(photo.medianReach).toLocaleString('en-US')}, reels ${Math.round(reel.medianReach).toLocaleString('en-US')}.` });
  }
  if (x.nonFollowerReach !== null && x.nonFollowerReach < 0.3) out.push({ tone: 'warn', title: `Only ${pc(x.nonFollowerReach)} of the reach was new people`, why: 'Posts are mostly seen by people who already follow. Reels, shares and collaborations are what reach beyond them.' });
  if (x.follows && x.follows.follows + x.follows.unfollows >= 10) {
    if (x.follows.unfollows > x.follows.follows) out.push({ tone: 'warn', title: `Losing followers: ${x.follows.unfollows} unfollows, ${x.follows.follows} follows`, why: 'More left than joined over the range.' });
    else if (x.followers && x.follows.net / x.followers >= 0.05) out.push({ tone: 'good', title: `+${x.follows.net.toLocaleString('en-US')} followers (${pc(x.follows.net / x.followers)} growth)`, why: `${x.follows.follows.toLocaleString('en-US')} follows against ${x.follows.unfollows.toLocaleString('en-US')} unfollows.` });
  }
  if (x.profileViews && x.profileViews >= 50 && x.websiteTaps !== null) {
    const t = x.websiteTaps / x.profileViews;
    if (t < 0.03) out.push({ tone: 'info', title: `Few profile visitors tap the link (${pc(t)})`, why: `${x.profileViews.toLocaleString('en-US')} profile views, ${x.websiteTaps} link taps. The bio link and a pinned post saying where to buy turn visits into enquiries.` });
  }
  if (x.lastPostAt && x.now) {
    const days = Math.floor((x.now - Date.parse(x.lastPostAt)) / 86_400_000);
    if (days >= 7) out.push({ tone: 'warn', title: `No Instagram post for ${days} days`, why: `The last went up ${x.lastPostAt.slice(0, 10)}. Reach between ads comes from posting; even two a week keeps the account in followers' feeds.` });
  }
  if (x.topPost && x.totalViews && x.topPost.older && x.topPost.views >= x.totalViews * 0.3) {
    out.push({ tone: 'info', title: `An older ${KIND_LABEL[x.topPost.kind].replace(/s$/, '').toLowerCase()} is carrying the numbers`, why: `Posted ${x.topPost.at.slice(0, 10)}, it has ${x.topPost.views.toLocaleString('en-US')} views — the range's total is ${x.totalViews.toLocaleString('en-US')}. Make more like it, and pin it.` });
  }
  const pk = x.followerCountries.find(c => c.key === 'PK');
  if (x.followerCountries.length && (!pk || pk.share < 0.5)) out.push({ tone: 'warn', title: `Only ${pk ? pc(pk.share) : 'a few'} of followers are in Pakistan`, why: `Followers spread across ${x.followerCountries.length} countries. Customers who can visit or take delivery are the ones that sell; ads aimed at Pakistan's cities grow those.` });
  if (x.best && x.best.share >= 0.12) out.push({ tone: 'info', title: `Followers are most online ${hourLabel(x.best.start)}–${hourLabel((x.best.start + 2) % 24)}`, why: `${pc(x.best.share)} of the day's online followers are in those two hours (Karachi time). Post just before.` });
  return out;
}

/**
 * The findings from the three parts' answers (/api/insights overview, posts, audience): one brain for the web page and
 * the iPhone app, which reads them from `part=findings`.
 */
export function findingsFor(
  o: { instagram: { reach: Split | null; nonFollowerReach: number | null; follows: { follows: number; unfollows: number; net: number } | null; account: { followers: number }; totals: Record<string, number> } | null; paid: { now: { metrics: { spend: number } }[] } | null; currency: string },
  p: { posts: PostRow[]; lastPostAt: string | null } | null,
  a: { audience: { followers: { country: Part[] }; online: number[] | null } | null } | null,
  now: number,
): Finding[] {
  const ig = o.instagram;
  if (!ig) return [];
  const igPosts = (p?.posts ?? []).filter(x => x.platform === 'instagram');
  const recent = igPosts.filter(x => !x.older);
  const top = [...igPosts].sort((x, y) => (y.views ?? 0) - (x.views ?? 0))[0];
  return findings({
    reachSplit: ig.reach, nonFollowerReach: ig.nonFollowerReach, follows: ig.follows, followers: ig.account.followers,
    kinds: byKind(recent.length >= 4 ? recent : igPosts), profileViews: ig.totals.profile_views ?? null, websiteTaps: ig.totals.website_clicks ?? null,
    followerCountries: sharesOf(a?.audience?.followers.country ?? [], 50), best: bestHours(a?.audience?.online ?? null),
    paidSpend: (o.paid?.now ?? []).reduce((t, r) => t + r.metrics.spend, 0), currency: o.currency,
    now, lastPostAt: p?.lastPostAt ?? null, postsInRange: recent.length, totalViews: ig.totals.views ?? null,
    topPost: top?.views ? { kind: top.kind, at: top.at, views: top.views, older: !!top.older } : null,
  });
}
