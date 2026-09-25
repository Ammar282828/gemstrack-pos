/**
 * What the ads cost and brought: Meta's Ads Insights for this house's ad
 * account, shaped for the Overview and the Campaigns tree.
 *
 * Meta retires insight fields now and then (v25 dropped several Page and video
 * metrics). A request naming a field Meta no longer knows fails whole, so each
 * call retries once without the fields Meta's error names — the page loses a
 * number instead of all of them.
 *
 * Server-only.
 */

import { graph, graphAll, MetaAdsError } from './meta';
import { metricsOf, type InsightRow, type Metrics, type RangeKey, type TreeCampaign, type TreeAdSet, type TreeAd, emptyMetrics } from './shape';

export const BASE_FIELDS = ['spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks', 'ctr', 'cpm', 'cpc', 'actions'];

/** The fields Meta's "(#100) … field(s) … invalid" error names, among the ones asked for. */
export function fieldsRejected(message: string, asked: string[]): string[] {
  if (!/field|param/i.test(message)) return [];
  return asked.filter(f => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(message));
}

async function insights(path: string, fields: string[], params: Record<string, unknown>, max = 1000): Promise<InsightRow[]> {
  try {
    return await graphAll<InsightRow>(`${path}/insights`, { ...params, fields: fields.join(',') }, max);
  } catch (e) {
    const drop = e instanceof MetaAdsError && e.code === 100 ? fieldsRejected(e.message, fields) : [];
    if (!drop.length) throw e;
    console.warn('[ads] Meta refused insight fields, retrying without:', drop.join(', '));
    return graphAll<InsightRow>(`${path}/insights`, { ...params, fields: fields.filter(f => !drop.includes(f)).join(',') }, max);
  }
}

const range = (r: RangeKey | { since: string; until: string }) => (typeof r === 'string' ? { date_preset: r } : { time_range: r });

export async function totals(act: string, r: RangeKey | { since: string; until: string }): Promise<{ metrics: Metrics; since: string | null; until: string | null }> {
  const rows = await insights(act, BASE_FIELDS, range(r), 1);
  return { metrics: metricsOf(rows[0]), since: rows[0]?.date_start ?? null, until: rows[0]?.date_stop ?? null };
}

/** The same length of time just before [since, until] — for "vs the previous 7 days". */
export function previousPeriod(since: string, until: string): { since: string; until: string } | null {
  const s = Date.parse(`${since}T00:00:00Z`), u = Date.parse(`${until}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(u) || u < s) return null;
  const days = Math.round((u - s) / 86_400_000) + 1;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { since: day(s - days * 86_400_000), until: day(s - 86_400_000) };
}

export async function daily(act: string, r: RangeKey): Promise<{ date: string; metrics: Metrics }[]> {
  const rows = await insights(act, ['spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'actions'], { ...range(r), time_increment: 1 }, 400);
  return rows.map(row => ({ date: String(row.date_start), metrics: metricsOf(row) })).sort((a, b) => a.date.localeCompare(b.date));
}

export interface Breakdown { key: string; label: string; metrics: Metrics }

const PLACEMENT: Record<string, string> = {
  'instagram:stream': 'Instagram feed', 'instagram:story': 'Instagram stories', 'instagram:reels': 'Instagram reels',
  'instagram:explore': 'Instagram explore', 'instagram:explore_home': 'Instagram explore home', 'instagram:profile_feed': 'Instagram profile',
  'instagram:ig_search': 'Instagram search', 'instagram:instagram_reels': 'Instagram reels',
  'facebook:feed': 'Facebook feed', 'facebook:story': 'Facebook stories', 'facebook:facebook_reels': 'Facebook reels',
  'facebook:video_feeds': 'Facebook video', 'facebook:marketplace': 'Marketplace', 'facebook:search': 'Facebook search',
  'facebook:right_hand_column': 'Facebook right column', 'facebook:instream_video': 'Facebook in-stream',
  'facebook:facebook_reels_overlay': 'Facebook reels overlay', 'messenger:messenger_inbox': 'Messenger inbox',
  'messenger:messenger_stories': 'Messenger stories', 'audience_network:classic': 'Audience Network',
  'threads:threads_stream': 'Threads',
};
const cap = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

export async function breakdowns(act: string, r: RangeKey): Promise<{ ageGender: Breakdown[]; placement: Breakdown[]; region: Breakdown[] }> {
  const fields = ['spend', 'impressions', 'reach', 'clicks', 'actions'];
  const [ag, pl, rg] = await Promise.all([
    insights(act, fields, { ...range(r), breakdowns: 'age,gender' }, 200).catch(() => []),
    insights(act, fields, { ...range(r), breakdowns: 'publisher_platform,platform_position' }, 200).catch(() => []),
    insights(act, fields, { ...range(r), breakdowns: 'region' }, 200).catch(() => []),
  ]);
  const byKey = (rows: InsightRow[], key: (x: InsightRow) => string, label: (k: string) => string): Breakdown[] => {
    const map = new Map<string, InsightRow[]>();
    for (const row of rows) { const k = key(row); map.set(k, [...(map.get(k) ?? []), row]); }
    return [...map.entries()].map(([k, list]) => {
      const m = list.map(metricsOf).reduce((acc, x) => {
        acc.spend += x.spend; acc.impressions += x.impressions; acc.reach += x.reach; acc.clicks += x.clicks;
        for (const [a, v] of Object.entries(x.actions)) acc.actions[a] = (acc.actions[a] ?? 0) + v;
        return acc;
      }, emptyMetrics());
      return { key: k, label: label(k), metrics: m };
    }).sort((a, b) => b.metrics.spend - a.metrics.spend || b.metrics.impressions - a.metrics.impressions);
  };
  const gender = (g: string) => (g === 'female' ? 'Women' : g === 'male' ? 'Men' : 'Unknown');
  return {
    ageGender: byKey(ag, x => `${x.age}|${x.gender}`, k => { const [a, g] = k.split('|'); return `${gender(g)} ${a}`; }),
    placement: byKey(pl, x => `${x.publisher_platform}:${x.platform_position}`, k => PLACEMENT[k] ?? cap(k.replace(':', ' · '))),
    region: byKey(rg, x => String(x.region ?? 'Unknown'), k => k),
  };
}

// ── The tree: campaigns → ad sets → ads, each with its numbers ─────────────

const LIVE = ['ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES'];

type Issue = { error_summary?: string; error_message?: string };
const issues = (x: { issues_info?: Issue[] }) => (x.issues_info ?? []).map(i => i.error_summary || i.error_message || '').filter(Boolean);
const minor = (v: unknown, offset: number) => (v === undefined || v === null || v === '' || Number(v) === 0 ? null : Number(v) / offset);

export async function tree(act: string, r: RangeKey, opts: { archived?: boolean; offset: number }): Promise<TreeCampaign[]> {
  const statuses = opts.archived ? [...LIVE, 'ARCHIVED'] : LIVE;
  const filter = { effective_status: statuses };
  const [campaigns, adsets, ads, ci, ai, adi] = await Promise.all([
    graphAll<Record<string, unknown>>(`${act}/campaigns`, { ...filter, fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,issues_info,created_time' }, 500),
    graphAll<Record<string, unknown>>(`${act}/adsets`, { ...filter, fields: 'id,name,campaign_id,status,effective_status,optimization_goal,destination_type,daily_budget,lifetime_budget,start_time,end_time,learning_stage_info,issues_info' }, 1000),
    graphAll<Record<string, unknown>>(`${act}/ads`, { ...filter, fields: 'id,name,adset_id,campaign_id,status,effective_status,issues_info,creative{id,thumbnail_url,image_url,instagram_permalink_url}' }, 2000),
    insights(act, ['campaign_id', ...BASE_FIELDS], { ...range(r), level: 'campaign' }, 500).catch(() => []),
    insights(act, ['adset_id', ...BASE_FIELDS], { ...range(r), level: 'adset' }, 1000).catch(() => []),
    insights(act, ['ad_id', ...BASE_FIELDS], { ...range(r), level: 'ad' }, 2000).catch(() => []),
  ]);
  const idx = (rows: InsightRow[], key: string) => new Map(rows.map(x => [String(x[key]), metricsOf(x)]));
  const cm = idx(ci, 'campaign_id'), am = idx(ai, 'adset_id'), dm = idx(adi, 'ad_id');

  const adsBySet = new Map<string, TreeAd[]>();
  for (const a of ads) {
    const creative = (a.creative ?? {}) as { id?: string; thumbnail_url?: string; image_url?: string; instagram_permalink_url?: string };
    const ad: TreeAd = {
      id: String(a.id), name: String(a.name ?? ''), status: String(a.status), effectiveStatus: String(a.effective_status),
      thumbnail: creative.thumbnail_url || creative.image_url || null, issues: issues(a as { issues_info?: Issue[] }),
      metrics: dm.get(String(a.id)) ?? emptyMetrics(), creativeId: creative.id ?? null, instagramPermalink: creative.instagram_permalink_url ?? null,
    };
    const k = String(a.adset_id);
    adsBySet.set(k, [...(adsBySet.get(k) ?? []), ad]);
  }
  const setsByCampaign = new Map<string, TreeAdSet[]>();
  for (const s of adsets) {
    const learning = (s.learning_stage_info as { status?: string } | undefined)?.status;
    const set: TreeAdSet = {
      id: String(s.id), name: String(s.name ?? ''), status: String(s.status), effectiveStatus: String(s.effective_status),
      optimizationGoal: String(s.optimization_goal ?? ''), destination: s.destination_type ? String(s.destination_type) : null,
      dailyBudget: minor(s.daily_budget, opts.offset), lifetimeBudget: minor(s.lifetime_budget, opts.offset),
      startTime: (s.start_time as string) ?? null, endTime: (s.end_time as string) ?? null,
      learning: learning === 'LEARNING' ? 'Learning' : learning === 'FAIL' ? 'Learning limited' : null,
      issues: issues(s as { issues_info?: Issue[] }),
      metrics: am.get(String(s.id)) ?? emptyMetrics(),
      ads: (adsBySet.get(String(s.id)) ?? []).sort((a, b) => b.metrics.spend - a.metrics.spend),
    };
    const k = String(s.campaign_id);
    setsByCampaign.set(k, [...(setsByCampaign.get(k) ?? []), set]);
  }
  const order = (s: string) => (s === 'ACTIVE' ? 0 : s === 'WITH_ISSUES' || s === 'DISAPPROVED' ? 1 : s === 'PAUSED' ? 3 : 2);
  return campaigns.map(c => ({
    id: String(c.id), name: String(c.name ?? ''), status: String(c.status), effectiveStatus: String(c.effective_status),
    objective: String(c.objective ?? ''),
    dailyBudget: minor(c.daily_budget, opts.offset), lifetimeBudget: minor(c.lifetime_budget, opts.offset),
    startTime: (c.start_time as string) ?? null, stopTime: (c.stop_time as string) ?? null,
    issues: issues(c as { issues_info?: Issue[] }),
    metrics: cm.get(String(c.id)) ?? emptyMetrics(),
    adsets: (setsByCampaign.get(String(c.id)) ?? []).sort((a, b) => order(a.effectiveStatus) - order(b.effectiveStatus) || b.metrics.spend - a.metrics.spend),
  })).sort((a, b) => order(a.effectiveStatus) - order(b.effectiveStatus) || b.metrics.spend - a.metrics.spend);
}

/** Ads Meta has stopped or flagged, with its reasons. */
export async function problemAds(act: string): Promise<{ id: string; name: string; status: string; reasons: string[] }[]> {
  const rows = await graphAll<Record<string, unknown>>(`${act}/ads`, {
    effective_status: ['DISAPPROVED', 'WITH_ISSUES', 'PENDING_BILLING_INFO'],
    fields: 'id,name,effective_status,issues_info,ad_review_feedback',
  }, 50).catch(() => []);
  return rows.map(a => {
    const feedback = (a.ad_review_feedback as { global?: Record<string, string> } | undefined)?.global ?? {};
    return {
      id: String(a.id), name: String(a.name ?? ''), status: String(a.effective_status),
      reasons: [...issues(a as { issues_info?: Issue[] }), ...Object.entries(feedback).map(([k, v]) => v || k)].filter(Boolean),
    };
  });
}

/** The top ads by spend for a range, with their pictures. */
export async function topAds(act: string, r: RangeKey, limit = 8): Promise<{ id: string; name: string; campaign: string; thumbnail: string | null; permalink: string | null; goal: string | null; metrics: Metrics }[]> {
  const rows = await insights(act, ['ad_id', 'ad_name', 'campaign_name', ...BASE_FIELDS], { ...range(r), level: 'ad', sort: ['spend_descending'] }, 100).catch(() => []);
  const top = rows.map(x => ({ id: String(x.ad_id), name: String(x.ad_name ?? ''), campaign: String(x.campaign_name ?? ''), metrics: metricsOf(x) }))
    .sort((a, b) => b.metrics.spend - a.metrics.spend).slice(0, limit);
  if (!top.length) return [];
  const extra = await graph<Record<string, { creative?: { thumbnail_url?: string; image_url?: string; instagram_permalink_url?: string }; adset?: { optimization_goal?: string } }>>('', {
    params: { ids: top.map(t => t.id).join(','), fields: 'creative{thumbnail_url,image_url,instagram_permalink_url},adset{optimization_goal}' },
  }).catch(() => ({} as Record<string, never>));
  return top.map(t => {
    const e = extra[t.id];
    return { ...t, thumbnail: e?.creative?.thumbnail_url || e?.creative?.image_url || null, permalink: e?.creative?.instagram_permalink_url ?? null, goal: e?.adset?.optimization_goal ?? null };
  });
}
