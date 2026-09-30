/**
 * The studio's outward look: who Taheri competes with and what their feeds do, and
 * what Taheri's own ads say about which pictures bring chats.
 *
 * Competitors
 *   find      Gemini with Google Search names Karachi's (then Pakistan's) fine jewellers and
 *             their Instagram usernames — only ones it found evidence for.
 *   profile   Instagram Business Discovery through the house's own connection
 *             (`instagram_basic`, the house's Instagram as the viewer): a public business or
 *             creator account's bio, followers and recent posts with likes and comments.
 *             Kept a day. Meta shows no competitor's ads to an API in Pakistan (the Ad
 *             Library API covers political ads and the EU only), so each rival carries a
 *             link to the public Ad Library instead.
 *   read      the model looks at a rival's best and weakest posts and says what works for
 *             them and what Taheri should do differently, inside Taheri's rules.
 *   Saved in Firestore `ad_competitors` (one document a username).
 *
 * Winners — the account's ads over the last six months with their pictures, split into the
 * cheapest results and the dearest (rivals.ts), shown to the model: what the winners share.
 * Saved in `app_settings/ad_studio_winners`.
 *
 * Server-only.
 */

import sharp from 'sharp';
import { adminDb } from '@/lib/firebase-admin';
import { graph, MetaAdsError } from '@/lib/ads/meta';
import { HOUSE_INSTAGRAM, loadAdsSettings, requireAccount } from '@/lib/ads/settings';
import { BRAND } from './brand';
import { insights, BASE_FIELDS } from '@/lib/ads/insights';
import { metricsOf, resultOf } from '@/lib/ads/shape';
import { chatTurn, generateJson, AiError, CHECK_MODEL, TEXT_MODEL, type InlineImage } from '@/lib/social/ai';
import { FIND_SYSTEM, RIVAL_SYSTEM, RIVAL_SCHEMA, WINNERS_SYSTEM, WINNERS_SCHEMA, type FoundCompetitor, type RivalReading, type WinnersReading } from './prompts';
import { bestAndWorst, cleanUsername, engagement, engagementRate, jsonIn, splitWinners, type OwnAd, type RatedAd, type RivalPost } from './rivals';

export const COMPETITORS = 'ad_competitors';
const winnersDoc = () => adminDb.collection('app_settings').doc('ad_studio_winners');
const PROFILE_TTL = 24 * 3_600_000;
const STUDIO_AI_MODEL = process.env.AD_STUDIO_TEXT_MODEL?.trim() || TEXT_MODEL;

export interface RivalProfile {
  username: string; name: string; bio: string; website: string | null; followers: number; mediaCount: number; picture: string | null;
  posts: RivalPost[];
}

export interface Competitor {
  username: string;
  name: string;
  website: string;
  city: string;
  why: string;
  source: 'search' | 'owner';
  addedAt: string;
  profile: RivalProfile | null;
  profileAt: string | null;
  profileError: string | null;
  reading: RivalReading | null;
  readingAt: string | null;
  /** The rival's Facebook Page in the Ad Library, when known (found through Meta's own ads connector). */
  adPageId?: string | null;
  adPageName?: string | null;
}

const ref = (u: string) => adminDb.collection(COMPETITORS).doc(u);

export async function listCompetitors(): Promise<Competitor[]> {
  const snap = await adminDb.collection(COMPETITORS).get();
  return snap.docs.map(d => d.data() as Competitor).sort((a, b) => (b.profile?.followers ?? -1) - (a.profile?.followers ?? -1) || a.name.localeCompare(b.name));
}

export async function addCompetitor(c: { username: string; name?: string; website?: string; city?: string; why?: string; source: Competitor['source'] }): Promise<Competitor> {
  const username = cleanUsername(c.username);
  if (!username) throw Object.assign(new Error('That isn’t an Instagram username.'), { status: 400 });
  const snap = await ref(username).get();
  if (snap.exists) return snap.data() as Competitor;
  const row: Competitor = {
    username, name: (c.name || '').trim() || username, website: (c.website || '').trim(), city: (c.city || '').trim(), why: (c.why || '').trim(),
    source: c.source, addedAt: new Date().toISOString(), profile: null, profileAt: null, profileError: null, reading: null, readingAt: null,
  };
  await ref(username).set(row);
  return row;
}

export const removeCompetitor = (username: string) => ref(cleanUsername(username) || '_').delete();

// ── Find ───────────────────────────────────────────────────────────────────

/** Competitors Google Search can vouch for, minus the house itself and ones already saved. */
export async function findCompetitors(brief = ''): Promise<FoundCompetitor[]> {
  const [saved, settings] = await Promise.all([listCompetitors(), loadAdsSettings()]);
  const own = (settings.instagramUsername || HOUSE_INSTAGRAM() || '').toLowerCase();
  const prompt = [
    `Find up to twelve competitors: ${BRAND.competitors}.`,
    brief ? `Focus: ${brief}` : '',
    saved.length ? `Already known (skip): ${saved.map(s => '@' + s.username).join(', ')}.` : '',
    own ? `Never list @${own} (the house itself).` : '',
    `Answer with only this JSON: {"competitors":[{"name":"","instagram":"","website":"","city":"","why":""}]} — "instagram" is the username alone, exactly as in the account's Instagram URL, or "" if you did not see it.`,
  ].filter(Boolean).join('\n');
  const { content } = await chatTurn({
    // The flash model with little thinking: the pro model spent three minutes and its whole budget thinking (2026-09-29).
    model: CHECK_MODEL, system: FIND_SYSTEM, temperature: 0.2, maxOutputTokens: 12000, thinkingLevel: 'low',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
  });
  const text = content.parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text as string).join('');
  const found = jsonIn<{ competitors?: unknown[] }>(text)?.competitors;
  if (!Array.isArray(found)) throw new AiError('The search came back without a list. Try again.', 502);
  const known = new Set([own, ...saved.map(s => s.username)]);
  const out: FoundCompetitor[] = [];
  for (const raw of found) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string).trim().slice(0, 200) : '');
    const instagram = cleanUsername(s('instagram'));
    if (!s('name') || (instagram && known.has(instagram))) continue;
    if (instagram) known.add(instagram);
    out.push({ name: s('name'), instagram, website: s('website'), city: s('city'), why: s('why') });
  }
  return out.slice(0, 12);
}

// ── Profile ────────────────────────────────────────────────────────────────

type Discovery = {
  business_discovery?: {
    username?: string; name?: string; biography?: string; website?: string; followers_count?: number; media_count?: number; profile_picture_url?: string;
    media?: { data?: Array<{ id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number }> };
  };
};

async function discover(username: string): Promise<RivalProfile> {
  const settings = await loadAdsSettings();
  if (!settings.instagramUserId) throw new MetaAdsError('Choose the house’s Instagram account on Ads → Setup first — Meta looks other accounts up through it.', 409);
  const fields = `business_discovery.username(${username}){username,name,biography,website,followers_count,media_count,profile_picture_url,media.limit(24){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count}}`;
  let d: Discovery;
  try {
    d = await graph<Discovery>(settings.instagramUserId, { params: { fields } });
  } catch (e) {
    if (e instanceof MetaAdsError && (e.code === 110 || e.subcode === 2207013 || /cannot find user|not a business/i.test(e.message))) {
      throw new MetaAdsError(`Meta shows only public business and creator accounts — @${username} isn’t one, or the name is wrong.`, 404);
    }
    // #10 for every account, @instagram too (2026-09-29): Business Discovery needs instagram_basic,
    // instagram_manage_insights and pages_read_engagement; the login had the first and third only.
    if (e instanceof MetaAdsError && (e.code === 10 || e.code === 200)) {
      throw new MetaAdsError('Meta refused the look-up: looking up other accounts needs the instagram_manage_insights permission (with instagram_basic) on the shop’s Facebook login. Add it to the login configuration and connect again (Ads → Setup says where). Until then, open their Instagram and Ad Library from here.', 403);
    }
    throw e;
  }
  const b = d.business_discovery;
  if (!b) throw new MetaAdsError(`Meta returned nothing for @${username}.`, 404);
  return {
    username: b.username || username, name: b.name || username, bio: b.biography || '', website: b.website || null,
    followers: b.followers_count ?? 0, mediaCount: b.media_count ?? 0, picture: b.profile_picture_url || null,
    posts: (b.media?.data ?? []).map(m => ({
      id: m.id, caption: (m.caption || '').slice(0, 600), type: m.media_type || 'IMAGE',
      image: (m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url) || m.thumbnail_url || null,
      permalink: m.permalink || null, at: m.timestamp || null,
      likes: typeof m.like_count === 'number' ? m.like_count : null, comments: typeof m.comments_count === 'number' ? m.comments_count : null,
    })),
  };
}

/** A rival's profile, from Meta at most once a day unless asked. */
export async function competitorProfile(username: string, fresh = false): Promise<Competitor> {
  const u = cleanUsername(username);
  const snap = await ref(u).get();
  if (!snap.exists) throw Object.assign(new Error('Not in the list.'), { status: 404 });
  const c = snap.data() as Competitor;
  if (!fresh && c.profile && c.profileAt && Date.now() - Date.parse(c.profileAt) < PROFILE_TTL) return c;
  try {
    const profile = await discover(u);
    const next: Competitor = { ...c, profile, profileAt: new Date().toISOString(), profileError: null, name: c.source === 'owner' && c.name === u ? profile.name : c.name };
    await ref(u).set(next);
    return next;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ref(u).set({ ...c, profileError: msg, profileAt: new Date().toISOString() });
    throw e;
  }
}

// ── Reading pictures ───────────────────────────────────────────────────────

/** A picture from Instagram's or Meta's CDN, small, for the model. Null when it won't come. */
async function smallImage(url: string | null, px = 640): Promise<InlineImage | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  try {
    const out = await sharp(Buffer.from(await res.arrayBuffer()), { failOn: 'none' }).rotate().resize(px, px, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return { mimeType: 'image/jpeg', data: out.toString('base64') };
  } catch { return null; }
}

/** What works in a rival's feed, and what Taheri should do about it. */
export async function readCompetitor(username: string): Promise<Competitor> {
  const c = await competitorProfile(username);
  const p = c.profile;
  if (!p || !p.posts.length) throw Object.assign(new Error(`@${c.username} has no posts Meta will show.`), { status: 404 });
  const { best, worst } = bestAndWorst(p.posts);
  const parts: Array<{ text: string } | { inlineData: InlineImage }> = [{
    text: `@${p.username} — ${p.name}. ${p.followers.toLocaleString('en-US')} followers, ${p.mediaCount} posts. Bio: ${p.bio || '—'}. Website: ${p.website || '—'}.`,
  }];
  const add = async (label: string, list: RivalPost[]) => {
    for (const post of list) {
      const img = await smallImage(post.image);
      if (!img) continue;
      const rate = engagementRate(post, p.followers);
      parts.push({ text: `${label} — ${post.type.toLowerCase()}, ${post.at?.slice(0, 10) ?? 'undated'}, ${engagement(post) === null ? 'likes hidden' : `${post.likes} likes, ${post.comments ?? 0} comments${rate !== null ? ` (${rate} per thousand followers)` : ''}`}. Caption: ${post.caption.slice(0, 400) || '—'}` });
      parts.push({ inlineData: img });
    }
  };
  await add('ONE OF THEIR BEST POSTS', best);
  await add('ONE OF THEIR WEAKEST POSTS', worst);
  const captionsOnly = p.posts.filter(x => !best.includes(x) && !worst.includes(x)).slice(0, 10)
    .map(x => `- ${engagement(x) === null ? '' : `[${x.likes} likes, ${x.comments ?? 0} comments] `}${x.caption.slice(0, 200)}`).join('\n');
  if (captionsOnly) parts.push({ text: `Other recent captions:\n${captionsOnly}` });
  parts.push({ text: 'Read this competitor for the house. Be specific to what you see; every "ourMoves" item must be something the house can make this month within its rules.' });
  const reading = await generateJson<RivalReading>({ model: STUDIO_AI_MODEL, system: RIVAL_SYSTEM, parts, schema: RIVAL_SCHEMA, temperature: 0.4 });
  const next: Competitor = { ...c, reading, readingAt: new Date().toISOString() };
  await ref(c.username).set(next);
  return next;
}

// ── Taheri's own winners ───────────────────────────────────────────────────

export interface WinnersState {
  at: string | null;
  since: string | null;
  until: string | null;
  winners: RatedAd[];
  losers: RatedAd[];
  considered: number;
  enough: boolean;
  reading: WinnersReading | null;
  error: string | null;
}

export async function loadWinners(): Promise<WinnersState | null> {
  const snap = await winnersDoc().get().catch(() => null);
  return snap?.exists ? (snap.data() as WinnersState) : null;
}

type AdRow = { creative?: { id?: string; image_url?: string; thumbnail_url?: string; body?: string; title?: string }; adset?: { optimization_goal?: string } };

/** The account's ads over the last 180 days, with a picture each and their results. */
async function ownAds(): Promise<{ ads: OwnAd[]; since: string; until: string }> {
  const { act } = await requireAccount();
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const until = day(Date.now()), since = day(Date.now() - 180 * 86_400_000);
  const rows = await insights(act, ['ad_id', 'ad_name', ...BASE_FIELDS], { time_range: { since, until }, level: 'ad' }, 300);
  const ids = rows.map(r => String(r.ad_id)).filter(Boolean);
  const extra: Record<string, AdRow> = {};
  for (let i = 0; i < ids.length; i += 50) {
    Object.assign(extra, await graph<Record<string, AdRow>>('', { params: { ids: ids.slice(i, i + 50).join(','), fields: 'creative{id,image_url,thumbnail_url,body,title},adset{optimization_goal}' } }).catch(() => ({})));
  }
  // Boosted posts and videos have no image_url and a 64-px thumbnail: ask for 480.
  const small = ids.filter(id => !extra[id]?.creative?.image_url && extra[id]?.creative?.id);
  for (let i = 0; i < small.length; i += 50) {
    const chunk = small.slice(i, i + 50);
    const big = await graph<Record<string, { thumbnail_url?: string }>>('', { params: { ids: [...new Set(chunk.map(id => extra[id].creative!.id!))].join(','), fields: 'thumbnail_url', thumbnail_width: 480, thumbnail_height: 480 } }).catch(() => ({} as Record<string, { thumbnail_url?: string }>));
    for (const id of chunk) extra[id].creative!.thumbnail_url = big[extra[id].creative!.id!]?.thumbnail_url || extra[id].creative!.thumbnail_url;
  }
  const ads = rows.map(r => {
    const id = String(r.ad_id);
    const m = metricsOf(r);
    const e = extra[id];
    const res = resultOf(m, e?.adset?.optimization_goal) ?? { label: 'Link clicks', value: m.linkClicks };
    return {
      id, name: String(r.ad_name ?? ''), image: e?.creative?.image_url || e?.creative?.thumbnail_url || null,
      spend: m.spend, results: res.value, resultLabel: res.label, ctr: m.ctr, body: e?.creative?.body || e?.creative?.title || null,
    };
  });
  return { ads, since, until };
}

/** What the account's cheapest results share, read by the model. */
export async function analyseWinners(): Promise<WinnersState> {
  const { ads, since, until } = await ownAds();
  const split = splitWinners(ads);
  const base: WinnersState = { at: new Date().toISOString(), since, until, ...split, reading: null, error: null };
  if (!split.enough) {
    const state = { ...base, error: `Only ${split.considered} ad${split.considered === 1 ? '' : 's'} in the last six months spent enough to compare — run a few more and ask again.` };
    await winnersDoc().set(state);
    return state;
  }
  const parts: Array<{ text: string } | { inlineData: InlineImage }> = [];
  const add = async (label: string, list: RatedAd[]) => {
    for (const a of list) {
      const img = await smallImage(a.image, 560);
      if (!img) continue;
      parts.push({ text: `${label}: "${a.name}" — spent ${Math.round(a.spend)}, ${a.results} ${a.resultLabel.toLowerCase()}${a.costPerResult !== null ? `, ${Math.round(a.costPerResult)} each` : ''}, click-through ${a.ctr.toFixed(2)}%. Words: ${a.body?.slice(0, 300) || '—'}` });
      parts.push({ inlineData: img });
    }
  };
  await add('WINNER', split.winners);
  await add('LOSER', split.losers);
  parts.push({ text: 'What do the winners share that the losers lack? Rules for the next ads, specific to these pictures.' });
  try {
    const reading = await generateJson<WinnersReading>({ model: STUDIO_AI_MODEL, system: WINNERS_SYSTEM, parts, schema: WINNERS_SCHEMA, temperature: 0.3 });
    const state = { ...base, reading };
    await winnersDoc().set(state);
    return state;
  } catch (e) {
    const state = { ...base, error: e instanceof Error ? e.message : String(e) };
    await winnersDoc().set(state);
    return state;
  }
}
