/**
 * The house's website, counted the way Shopify's analytics counts a store (the owner, 2026-10-23: "add by location,
 * live visitors, everything Shopify shows for catalogue.hom and taheri.shop") — for sites that sell by WhatsApp, so
 * the funnel ends in an enquiry, not a checkout.
 *
 * The sites send it with the piece events (piece-interest.ts), in the same beacon to POST /api/public/events:
 *
 *   { v: visitor, s: session,                  random first-party ids (localStorage), never a person
 *     c: { r: referrer host, u: {s,m,c} utm, k: click id kind, l: landing path, n: 1 new visitor },
 *     o: 1 the session opens, d: 1 the visitor's first visit today,
 *     n: page views before this batch, pp: the page before this batch,
 *     p: [[path, kind]] pages viewed, q: [search terms], f: [funnel steps reached], t: visible ms since last, at: path now }
 *
 * Nothing is kept per hit. Each day is one document of counters, `site_days/<Karachi day>`, raised with
 * FieldValue.increment (sessions, page views, bounces, time, and maps by place, device, source, page…);
 * `site_live/<session>` is one short-lived document per open session (live view; expireAt for the TTL);
 * `site_visitors/<visitor>` holds the days a random id was seen, for unique visitors over a period.
 * Bounces and exits are kept by give-and-take: a session's first page adds a bounce and an exit there; each later
 * page takes the bounce back (on the second) and moves the exit to itself. No job has to close a session.
 */

export const SITE_DAYS = 'site_days';
export const SITE_LIVE = 'site_live';
export const SITE_VISITORS = 'site_visitors';

/** A visitor on a page within this long is "on the site now" (the sites beat every 30 s while visible). */
export const LIVE_MS = 5 * 60_000;
/** Visible time sent in one batch beyond this is a tab left open, not reading. */
const MAX_BATCH_MS = 3 * 60_000;

export const PAGE_KINDS = ['home', 'collection', 'piece', 'info', 'search', '404', 'other'] as const;
export type PageKind = typeof PAGE_KINDS[number];
export const STEPS = ['piece', 'save', 'enquire'] as const;
export type Step = typeof STEPS[number];

export interface Visit {
  v: string; s: string;
  ref: string; utm: { s: string; m: string; c: string }; click: '' | 'fb' | 'g' | 'tt' | 'ig';
  landing: string; isNew: boolean;
  opens: boolean; firstToday: boolean;
  before: number; prev: string;
  pages: { path: string; kind: PageKind }[];
  searches: string[]; steps: Step[];
  ms: number; at: string;
}

const ID = /^[A-Za-z0-9_-]{8,40}$/;
const str = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

/** A site path: starts with a slash, no query, no fragment, at most 200 characters. */
export function cleanPath(x: unknown): string {
  const s = str(x, 400).split(/[?#]/)[0];
  if (!s.startsWith('/') || s.startsWith('//')) return '';
  let p = s.replace(/\/{2,}/g, '/');
  try { p = decodeURI(p); } catch { /* keep it as sent */ }
  p = p.length > 1 ? p.replace(/\/+$/, '') : p;
  return p.slice(0, 200).toLowerCase();
}

const host = (x: unknown) => str(x, 120).toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '');

/** The visit part of a batch, checked; null when it has none (an older page sending piece events only). */
export function parseVisit(raw: unknown): Visit | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.v !== 'string' || typeof b.s !== 'string' || !ID.test(b.v) || !ID.test(b.s)) return null;
  const c = (b.c && typeof b.c === 'object' ? b.c : {}) as Record<string, unknown>;
  const u = (c.u && typeof c.u === 'object' ? c.u : {}) as Record<string, unknown>;
  const pages = (Array.isArray(b.p) ? b.p : []).slice(0, 30).flatMap(e => {
    const [p, k] = Array.isArray(e) ? e : [e];
    const path = cleanPath(p);
    if (!path) return [];
    return [{ path, kind: (PAGE_KINDS as readonly string[]).includes(k as string) ? (k as PageKind) : 'other' }];
  });
  const searches = (Array.isArray(b.q) ? b.q : []).slice(0, 10).map(q => str(q, 60).toLowerCase().replace(/\s+/g, ' ')).filter(q => q.length >= 2);
  const steps = [...new Set((Array.isArray(b.f) ? b.f : []).filter((x): x is Step => (STEPS as readonly string[]).includes(x as string)))];
  const n = Math.round(Number(b.n));
  const ms = Math.round(Number(b.t));
  const click = (['fb', 'g', 'tt', 'ig'] as const).find(k => k === c.k) ?? '';
  return {
    v: b.v, s: b.s,
    ref: host(c.r), utm: { s: str(u.s, 60).toLowerCase(), m: str(u.m, 60).toLowerCase(), c: str(u.c, 80) }, click,
    landing: cleanPath(c.l) || pages[0]?.path || '', isNew: c.n === 1 || c.n === true,
    opens: b.o === 1 || b.o === true, firstToday: b.d === 1 || b.d === true,
    before: Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 0, prev: cleanPath(b.pp),
    pages, searches, steps,
    ms: Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_BATCH_MS) : 0,
    at: cleanPath(b.at) || pages[pages.length - 1]?.path || '',
  };
}

// ── Where people came from ───────────────────────────────────────────────────

export type Channel = 'direct' | 'search' | 'social' | 'paid' | 'referral' | 'email';
export interface Source { channel: Channel; name: string }

const SOCIAL: [RegExp, string][] = [
  [/(^|\.)instagram\.com$|^l\.instagram\.com$|^ig$/, 'Instagram'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$|^m\.facebook\.com$|^l\.facebook\.com$|^lm\.facebook\.com$|^fb$|^facebook$/, 'Facebook'],
  [/(^|\.)(whatsapp\.com|wa\.me)$|^whatsapp$|^wa$/, 'WhatsApp'],
  [/(^|\.)tiktok\.com$|^tiktok$/, 'TikTok'],
  [/(^|\.)(youtube\.com|youtu\.be)$|^youtube$/, 'YouTube'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$|^twitter$|^x$/, 'X'],
  [/(^|\.)pinterest\.[a-z.]+$|^pinterest$/, 'Pinterest'],
  [/(^|\.)snapchat\.com$|^snapchat$/, 'Snapchat'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$|^linkedin$/, 'LinkedIn'],
  [/(^|\.)threads\.net$|^threads$/, 'Threads'],
  [/(^|\.)reddit\.com$|^reddit$/, 'Reddit'],
];
const SEARCH: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$|^google$/, 'Google'],
  [/(^|\.)bing\.com$|^bing$/, 'Bing'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)yahoo\.[a-z.]+$|^yahoo$/, 'Yahoo'],
  [/(^|\.)yandex\.[a-z.]+$/, 'Yandex'],
  [/(^|\.)baidu\.com$/, 'Baidu'],
  [/(^|\.)ecosia\.org$/, 'Ecosia'],
  [/(^|\.)(chatgpt\.com|openai\.com)$|^chatgpt$/, 'ChatGPT'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity'],
];
/** A host ("l.instagram.com") or a utm_source word ("instagram", "ig") to its name. */
const named = (list: [RegExp, string][], s: string) => list.find(([re]) => re.test(s) || (!s.includes('.') && re.test(`${s}.com`)))?.[1];

/**
 * The session's source, from its landing address's utm_* tags, an ad click id, or the referrer — in that order, as
 * Shopify and GA read them. `own` is the site's own host (a referrer from itself is no referrer).
 */
export function classifySource(v: Pick<Visit, 'ref' | 'utm' | 'click'>, own = ''): Source {
  const src = v.utm.s.replace(/^www\./, '');
  const paid = /(^|[^a-z])(cpc|ppc|paid|ads?|display|banner|cpm|sponsored|boost)([^a-z]|$)/.test(v.utm.m) || v.click === 'g';
  if (src) {
    const name = named(SOCIAL, src) || named(SEARCH, src) || src.replace(/\.(com|net|org|pk)$/, '');
    if (paid || (v.click && v.click !== 'g' && named(SOCIAL, src))) return { channel: 'paid', name };
    if (/e-?mail|newsletter/.test(v.utm.m) || src === 'email') return { channel: 'email', name };
    if (named(SOCIAL, src) || /social/.test(v.utm.m)) return { channel: 'social', name };
    if (named(SEARCH, src) || /organic/.test(v.utm.m)) return { channel: 'search', name };
    return { channel: 'referral', name };
  }
  if (v.click === 'g') return { channel: 'paid', name: 'Google' };
  if (v.click === 'tt') return { channel: 'paid', name: 'TikTok' };
  const ref = v.ref && v.ref !== own.replace(/^www\./, '') ? v.ref : '';
  // Meta's ads carry fbclid; organic links from Instagram and Facebook carry it too, so an fbclid is Meta, not "paid".
  if (v.click === 'fb' || v.click === 'ig') return { channel: 'social', name: named(SOCIAL, ref) || (v.click === 'ig' ? 'Instagram' : 'Facebook') };
  if (!ref) return { channel: 'direct', name: 'Direct' };
  const social = named(SOCIAL, ref);
  if (social) return { channel: 'social', name: social };
  const search = named(SEARCH, ref);
  if (search) return { channel: 'search', name: search };
  if (/mail\./.test(ref) || /(^|\.)outlook\.(live|office)\.com$/.test(ref)) return { channel: 'email', name: ref };
  return { channel: 'referral', name: ref };
}

export const sourceKey = (s: Source) => (s.channel === 'direct' ? 'direct' : `${s.channel}:${s.name}`);
export function sourceFromKey(k: string): Source {
  if (k === 'direct') return { channel: 'direct', name: 'Direct' };
  const i = k.indexOf(':');
  return { channel: (k.slice(0, i) || 'referral') as Channel, name: k.slice(i + 1) };
}

// ── The device ───────────────────────────────────────────────────────────────

export interface Device { device: 'mobile' | 'tablet' | 'desktop'; os: string; browser: string; bot: boolean }

/** Crawlers, previews and headless browsers; real people never send these. */
const BOT = /bot\b|bot\/|crawl|spider|slurp|scrape|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|preview|facebookexternalhit|facebot|whatsapp\/|telegrambot|discordbot|embedly|quora link|skypeuripreview|bitlybot|curl\/|wget\/|python-|java\/|go-http|okhttp|axios|node-fetch|libwww|httpclient|^mozilla\/5\.0$/i;

export function parseDevice(ua: string): Device {
  const u = ua || '';
  const bot = !u || u.length < 20 || BOT.test(u);
  const os = /iPhone|iPod/.test(u) ? 'iOS' : /iPad/.test(u) ? 'iPadOS' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows'
    : /CrOS/.test(u) ? 'ChromeOS' : /Mac OS X|Macintosh/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : 'Other';
  const tablet = /iPad|Tablet|(Android(?!.*Mobile))/.test(u);
  const mobile = !tablet && /Mobi|iPhone|iPod|Android/.test(u);
  // In-app browsers first: on these sites, most visitors arrive inside Instagram or Facebook.
  const browser = /Instagram/.test(u) ? 'Instagram' : /FBAN|FBAV|FB_IAB|FBIOS/.test(u) ? 'Facebook' : /musical_ly|TikTok|BytedanceWebview/.test(u) ? 'TikTok'
    : /Snapchat/.test(u) ? 'Snapchat' : /WhatsApp/.test(u) ? 'WhatsApp' : /SamsungBrowser/.test(u) ? 'Samsung Internet'
    : /Edg(e|A|iOS)?\//.test(u) ? 'Edge' : /OPR\/|Opera/.test(u) ? 'Opera' : /UCBrowser/.test(u) ? 'UC Browser'
    : /Firefox|FxiOS/.test(u) ? 'Firefox' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Other';
  // A Mac that says it has touch is an iPad in desktop mode; the page tells us via the width, not the agent.
  return { device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', os, browser, bot };
}

// ── Writing a batch ──────────────────────────────────────────────────────────

/** A map key as Firestore keeps it: no empty name, no dots (they would read as paths in update()). */
export const fieldKey = (s: string) => (s || '(none)').replace(/%/g, '%25').replace(/\./g, '%2E').replace(/\//g, '%2F').slice(0, 300);
export const unFieldKey = (s: string) => s.replace(/%2F/g, '/').replace(/%2E/g, '.').replace(/%25/g, '%');

export interface Ctx { source: Source; place: { cc: string; region: string; city: string }; device: Device; hour: number }

type Inc<T> = (n: number) => T;
type Tree<T> = { [k: string]: T | Tree<T> | string };

/**
 * The day's counters this batch raises, as a nested object of increments for set(…, { merge: true }).
 * `inc` is FieldValue.increment in the route and a plain number in the tests.
 */
export function dayUpdate<T>(v: Visit, ctx: Ctx, inc: Inc<T>): Tree<T> {
  const out: Tree<T> = {};
  const add = (pathParts: string[], n = 1) => {
    let node = out;
    for (const p of pathParts.slice(0, -1)) node = (node[p] ??= {}) as Tree<T>;
    const leaf = pathParts[pathParts.length - 1];
    const prev = (node[leaf] as unknown as { n?: number } | undefined)?.n ?? 0;
    // Kept as {n} while building so repeats in one batch add up; turned into increments at the end.
    node[leaf] = { n: prev + n } as unknown as T;
  };
  const sk = fieldKey(sourceKey(ctx.source));
  const camp = v.utm.c ? fieldKey(v.utm.c) : '';

  if (v.opens) {
    add(['sessions']); add(['bounces']);
    add([v.isNew ? 'newSessions' : 'returningSessions']);
    add(['src', sk, 's']);
    if (camp) add(['camp', camp, 's']);
    add(['land', fieldKey(v.landing || v.pages[0]?.path || '/')]);
    add(['country', fieldKey(ctx.place.cc || '??')]);
    if (ctx.place.city) add(['city', fieldKey([ctx.place.cc, ctx.place.region, ctx.place.city].join('|'))]);
    add(['device', ctx.device.device]); add(['os', fieldKey(ctx.device.os)]); add(['browser', fieldKey(ctx.device.browser)]);
    add(['hours', String(ctx.hour).padStart(2, '0')]);
  }
  if (v.firstToday) { add(['visitors']); if (v.isNew) add(['newVisitors']); }

  let prev = v.prev;
  v.pages.forEach((p, i) => {
    const key = fieldKey(p.path);
    add(['pageviews']); add(['pages', key]);
    if (p.kind === 'collection') add(['coll', key]);
    if (p.kind === '404') add(['nf', key]);
    // The exit moves to the latest page; a session's second page takes its bounce back.
    add(['exit', key]);
    if (prev && (v.before + i) > 0) add(['exit', fieldKey(prev)], -1);
    if (v.before + i === 1) add(['bounces'], -1);
    prev = p.path;
  });
  for (const q of v.searches) add(['search', fieldKey(q)]);
  for (const s of v.steps) {
    add(['funnel', s]); add(['src', sk, s]);
    if (camp) add(['camp', camp, s]);
  }
  if (v.ms) add(['durMs'], v.ms);

  const finish = (node: Tree<T>): Tree<T> => {
    for (const [k, val] of Object.entries(node)) {
      const n = (val as { n?: number }).n;
      if (typeof n === 'number' && Object.keys(val as object).length === 1) { if (n) node[k] = inc(n); else delete node[k]; }
      else finish(val as Tree<T>);
    }
    return node;
  };
  return finish(out);
}

// ── Reading days back ────────────────────────────────────────────────────────

type Counts = Record<string, number>;
export interface DayDoc {
  day: string;
  sessions?: number; bounces?: number; newSessions?: number; returningSessions?: number;
  visitors?: number; newVisitors?: number; pageviews?: number; durMs?: number;
  funnel?: Partial<Record<Step, number>>;
  src?: Record<string, Partial<Record<'s' | Step, number>>>;
  camp?: Record<string, Partial<Record<'s' | Step, number>>>;
  land?: Counts; exit?: Counts; pages?: Counts; coll?: Counts; nf?: Counts; search?: Counts;
  country?: Counts; city?: Counts; device?: Counts; os?: Counts; browser?: Counts; hours?: Counts;
}

export interface Row { key: string; value: number }
export interface SourceRow extends Source { key: string; sessions: number; piece: number; save: number; enquire: number }
export interface CityRow { cc: string; region: string; city: string; sessions: number }
export interface Summary {
  sessions: number; visitors: number; pageviews: number; bounces: number; durMs: number;
  newSessions: number; returningSessions: number; newVisitors: number;
  bounceRate: number; avgSessionMs: number; pagesPerSession: number;
  funnel: { sessions: number; piece: number; save: number; enquire: number };
  conversion: number;
  sources: SourceRow[]; channels: Row[]; campaigns: (Row & { piece: number; save: number; enquire: number })[];
  countries: Row[]; cities: CityRow[];
  devices: Row[]; os: Row[]; browsers: Row[];
  landing: Row[]; exits: Row[]; pages: Row[]; collections: Row[]; notFound: Row[]; searches: Row[];
}

const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
function addInto(to: Counts, from: Counts | undefined) { for (const [k, v] of Object.entries(from || {})) to[k] = (to[k] || 0) + n(v); }
const top = (c: Counts, limit = 50): Row[] => Object.entries(c).map(([k, v]) => ({ key: unFieldKey(k), value: v })).filter(r => r.value > 0).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key)).slice(0, limit);
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/** The days' counters added up into what the screen shows. `visitors` may be replaced by an exact count (the route). */
export function summarize(days: DayDoc[]): Summary {
  const s = { sessions: 0, visitors: 0, pageviews: 0, bounces: 0, durMs: 0, newSessions: 0, returningSessions: 0, newVisitors: 0 };
  const funnel = { piece: 0, save: 0, enquire: 0 };
  const maps: Record<'land' | 'exit' | 'pages' | 'coll' | 'nf' | 'search' | 'country' | 'city' | 'device' | 'os' | 'browser', Counts> =
    { land: {}, exit: {}, pages: {}, coll: {}, nf: {}, search: {}, country: {}, city: {}, device: {}, os: {}, browser: {} };
  const src: Record<string, Record<string, number>> = {};
  const camp: Record<string, Record<string, number>> = {};
  for (const d of days) {
    for (const k of Object.keys(s) as (keyof typeof s)[]) s[k] += n(d[k]);
    for (const k of STEPS) funnel[k] += n(d.funnel?.[k]);
    for (const k of Object.keys(maps) as (keyof typeof maps)[]) addInto(maps[k], d[k]);
    for (const [into, from] of [[src, d.src], [camp, d.camp]] as const) {
      for (const [k, v] of Object.entries(from || {})) { const t = (into[k] ??= {}); for (const [m, x] of Object.entries(v || {})) t[m] = (t[m] || 0) + n(x); }
    }
  }
  // A session crossing midnight can leave its bounce or exit a step below zero on one day; never show that.
  s.bounces = Math.max(0, Math.min(s.bounces, s.sessions));
  const sources: SourceRow[] = Object.entries(src).map(([k, v]) => ({ key: unFieldKey(k), ...sourceFromKey(unFieldKey(k)), sessions: v.s || 0, piece: v.piece || 0, save: v.save || 0, enquire: v.enquire || 0 }))
    .filter(r => r.sessions || r.enquire).sort((a, b) => b.sessions - a.sessions);
  const channels: Counts = {};
  for (const r of sources) channels[r.channel] = (channels[r.channel] || 0) + r.sessions;
  const cities: CityRow[] = top(maps.city, 100).map(r => { const [cc, region, city] = r.key.split('|'); return { cc, region, city, sessions: r.value }; });
  return {
    ...s,
    bounceRate: ratio(s.bounces, s.sessions), avgSessionMs: Math.round(ratio(s.durMs, s.sessions)), pagesPerSession: ratio(s.pageviews, s.sessions),
    funnel: { sessions: s.sessions, ...funnel }, conversion: ratio(funnel.enquire, s.sessions),
    sources, channels: top(channels),
    campaigns: Object.entries(camp).map(([k, v]) => ({ key: unFieldKey(k), value: v.s || 0, piece: v.piece || 0, save: v.save || 0, enquire: v.enquire || 0 })).filter(r => r.value || r.enquire).sort((a, b) => b.value - a.value).slice(0, 30),
    countries: top(maps.country, 60), cities,
    devices: top(maps.device), os: top(maps.os), browsers: top(maps.browser),
    landing: top(maps.land), exits: top(maps.exit), pages: top(maps.pages), collections: top(maps.coll), notFound: top(maps.nf), searches: top(maps.search),
  };
}

// ── Periods ──────────────────────────────────────────────────────────────────

export const DAY_MS = 86_400_000;
export const addDays = (day: string, k: number) => new Date(Date.parse(`${day}T00:00:00Z`) + k * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** The period asked for and the one before it, of the same length (Shopify's comparison). */
export function period(q: { range?: string | null; from?: string | null; to?: string | null }, today: string, firstDay: string | null) {
  let from = today, to = today;
  const r = q.range || '30d';
  if (r === 'custom' && isDay(q.from) && isDay(q.to)) { from = q.from <= q.to ? q.from : q.to; to = q.from <= q.to ? q.to : q.from; }
  else if (r === 'yesterday') { from = to = addDays(today, -1); }
  else if (r === 'all') { from = firstDay && firstDay < today ? firstDay : today; }
  else { const k = r === 'today' ? 1 : r === '7d' ? 7 : r === '90d' ? 90 : 30; from = addDays(today, -(k - 1)); }
  if (to > today) to = today;
  const len = daysBetween(from, to);
  return { range: r, from, to, days: len, previous: { from: addDays(from, -len), to: addDays(from, -1) } };
}

/** Each day in the period, zeros where nothing was counted: the chart's bars. */
export function series(days: DayDoc[], from: string, to: string) {
  const by = new Map(days.map(d => [d.day, d]));
  const out: { day: string; sessions: number; visitors: number; pageviews: number; enquiries: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const x = by.get(d);
    out.push({ day: d, sessions: n(x?.sessions), visitors: n(x?.visitors), pageviews: n(x?.pageviews), enquiries: n(x?.funnel?.enquire) });
  }
  return out;
}

// ── Live ─────────────────────────────────────────────────────────────────────

export interface LiveDoc {
  at: number; start?: number; path?: string; kind?: string; pages?: number;
  cc?: string; region?: string; city?: string; device?: string; browser?: string; source?: string; isNew?: boolean;
}

/** Who is on the site now (seen in the last five minutes), grouped the ways the live view shows them. */
export function liveSummary(docs: LiveDoc[], now = Date.now()) {
  const on = docs.filter(d => n(d.at) >= now - LIVE_MS);
  const count = (f: (d: LiveDoc) => string | undefined) => {
    const c: Counts = {};
    for (const d of on) { const k = f(d); if (k) c[k] = (c[k] || 0) + 1; }
    return Object.entries(c).map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value || a.key.localeCompare(b.key)).slice(0, 30);
  };
  return {
    visitors: on.length,
    newVisitors: on.filter(d => d.isNew).length,
    pages: count(d => d.path),
    countries: count(d => d.cc || '??'),
    cities: count(d => (d.city ? [d.cc, d.region, d.city].join('|') : undefined)),
    sources: count(d => d.source),
    devices: count(d => d.device),
    // The newest first; no id, nothing that tells one person from another beyond what the counts show.
    sessions: on.sort((a, b) => b.at - a.at).slice(0, 50).map(d => ({
      path: d.path || '/', kind: d.kind || 'other', cc: d.cc || '', region: d.region || '', city: d.city || '',
      device: d.device || '', browser: d.browser || '', source: d.source || 'direct', isNew: !!d.isNew,
      pages: n(d.pages), forMs: d.start ? Math.max(0, n(d.at) - d.start) : 0, ago: Math.max(0, now - n(d.at)),
    })),
  };
}
