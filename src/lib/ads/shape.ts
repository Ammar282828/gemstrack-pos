/**
 * The Ads pages' vocabulary — shared by the browser and the server, so nothing
 * here touches the network or the Firebase SDKs.
 *
 * Money: Meta gives spend in insights as a decimal string in the account's
 * currency ("1234.56"), but every budget, cap, balance and amount spent on the
 * account itself in the currency's smallest unit (paisa for PKR: 150000 =
 * Rs 1,500). `fromMinor` / `toMinor` convert; a handful of currencies have no
 * smaller unit and Meta counts them whole.
 */

// ── Money ──────────────────────────────────────────────────────────────────

/** Currencies Meta counts in whole units (offset 1); every other one in hundredths. */
const WHOLE_UNIT = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);
export const currencyOffset = (currency: string) => (WHOLE_UNIT.has(String(currency).toUpperCase()) ? 1 : 100);
export const fromMinor = (v: string | number | null | undefined, currency: string) =>
  v === null || v === undefined || v === '' ? 0 : Number(v) / currencyOffset(currency);
export const toMinor = (amount: number, currency: string) => Math.round(amount * currencyOffset(currency));

const SYMBOL: Record<string, string> = { PKR: 'Rs', USD: '$', GBP: '£', EUR: '€', AED: 'AED', SAR: 'SAR', INR: '₹' };
/** "Rs 1,500", "Rs 1,234.50" — whole when it is whole. */
export function money(amount: number, currency = 'PKR', opts: { cents?: boolean } = {}): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const cents = opts.cents ?? (Math.abs(n) < 100 && Math.round(n) !== n);
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const sym = SYMBOL[currency?.toUpperCase()] ?? currency?.toUpperCase() ?? '';
  return `${n < 0 ? '−' : ''}${sym} ${s}`.trim();
}
export const count = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0');
/** 12,300 → "12.3k", 1,250,000 → "1.25M" — for tiles and axes. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(1)}k`;
  return count(n);
}
export const pct = (n: number, digits = 2) => `${(Number.isFinite(n) ? n : 0).toFixed(digits)}%`;

// ── Date ranges ────────────────────────────────────────────────────────────

export const RANGES = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last_7d', label: 'Last 7 days' },
  { key: 'last_14d', label: 'Last 14 days' },
  { key: 'last_30d', label: 'Last 30 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'maximum', label: 'All time' },
] as const;
export type RangeKey = typeof RANGES[number]['key'];
export const isRange = (v: unknown): v is RangeKey => RANGES.some(r => r.key === v);
export const rangeLabel = (k: string) => RANGES.find(r => r.key === k)?.label ?? k;

// ── Statuses ───────────────────────────────────────────────────────────────

export type Tone = 'good' | 'idle' | 'warn' | 'bad';
const STATUS: Record<string, { label: string; tone: Tone }> = {
  ACTIVE: { label: 'Running', tone: 'good' },
  PAUSED: { label: 'Paused', tone: 'idle' },
  CAMPAIGN_PAUSED: { label: 'Campaign paused', tone: 'idle' },
  ADSET_PAUSED: { label: 'Ad set paused', tone: 'idle' },
  PENDING_REVIEW: { label: 'In review', tone: 'warn' },
  IN_PROCESS: { label: 'Processing', tone: 'warn' },
  PREAPPROVED: { label: 'Pre-approved', tone: 'warn' },
  WITH_ISSUES: { label: 'Has issues', tone: 'bad' },
  DISAPPROVED: { label: 'Rejected', tone: 'bad' },
  PENDING_BILLING_INFO: { label: 'Needs payment info', tone: 'bad' },
  ARCHIVED: { label: 'Archived', tone: 'idle' },
  DELETED: { label: 'Deleted', tone: 'idle' },
};
export const statusOf = (s: string | undefined) => STATUS[String(s)] ?? { label: String(s || 'Unknown').toLowerCase().replace(/_/g, ' '), tone: 'idle' as Tone };

/** Ad account `account_status`. */
export const ACCOUNT_STATUS: Record<number, { label: string; tone: Tone; fix?: string }> = {
  1: { label: 'Active', tone: 'good' },
  2: { label: 'Disabled', tone: 'bad', fix: 'Meta has disabled this ad account. Open Account Quality in Meta Business Suite to see why and request a review.' },
  3: { label: 'Payment due', tone: 'bad', fix: 'A payment failed. Settle the balance in Ads Manager → Billing, and ads start again.' },
  7: { label: 'Under risk review', tone: 'warn', fix: 'Meta is reviewing the account; ads wait until it finishes.' },
  8: { label: 'Settling a payment', tone: 'warn' },
  9: { label: 'Grace period', tone: 'warn', fix: 'A payment is overdue. Pay it in Ads Manager → Billing before the grace period ends.' },
  100: { label: 'Closing', tone: 'bad' },
  101: { label: 'Closed', tone: 'bad', fix: 'This ad account is closed. Choose another one on the Setup tab.' },
  201: { label: 'Active', tone: 'good' },
  202: { label: 'Closed', tone: 'bad' },
};
export const DISABLE_REASON: Record<number, string> = {
  1: 'ads integrity policy', 2: 'intellectual property review', 3: 'payment risk', 4: 'shut down',
  5: 'ads review', 6: 'business integrity review', 7: 'permanently closed', 8: 'unused reseller account',
  9: 'unused account', 11: 'business policy', 12: 'misrepresented account', 15: 'compromised account',
};

// ── What the ads achieved ──────────────────────────────────────────────────

/** Meta's action types in the shop's words. Anything not here is shown in Meta's own name, tidied. */
const ACTION_LABEL: Record<string, string> = {
  'onsite_conversion.messaging_conversation_started_7d': 'Chats started',
  'onsite_conversion.total_messaging_connection': 'Messaging contacts',
  'onsite_conversion.messaging_first_reply': 'First replies',
  'onsite_conversion.messaging_user_depth_2_message_send': 'Chats with 2+ messages',
  'onsite_conversion.post_save': 'Saves',
  'onsite_conversion.lead_grouped': 'Leads',
  lead: 'Leads',
  link_click: 'Link clicks',
  landing_page_view: 'Landing page views',
  post_engagement: 'Post engagement',
  page_engagement: 'Page engagement',
  post_reaction: 'Reactions',
  post_interaction_gross: 'Interactions',
  comment: 'Comments',
  post: 'Shares',
  like: 'Page likes',
  follow: 'Follows',
  video_view: 'Video plays',
  photo_view: 'Photo views',
  omni_purchase: 'Purchases',
  purchase: 'Purchases',
  instagram_profile_visit: 'Profile visits',
  ig_profile_visit: 'Profile visits',
};
export const actionLabel = (t: string) =>
  ACTION_LABEL[t] ?? t.replace(/^(onsite_conversion|offsite_conversion|onsite_web)\./, '').replace(/[._]+/g, ' ').replace(/^\w/, c => c.toUpperCase());
/** Actions that are part of another (link clicks are also post engagement…) and would repeat in a list. */
export const HEADLINE_ACTIONS = [
  'onsite_conversion.messaging_conversation_started_7d',
  'link_click',
  'landing_page_view',
  'instagram_profile_visit',
  'ig_profile_visit',
  'post_engagement',
  'post_reaction',
  'comment',
  'onsite_conversion.post_save',
  'post',
  'follow',
  'video_view',
  'onsite_conversion.lead_grouped',
  'omni_purchase',
];

/** What counts as "a result" for an ad set's optimisation goal — Meta's own column, rebuilt from actions. */
/**
 * `unsure`: Meta documents no action type for it (profile visits); when none of the guesses is in the
 * numbers, no result is shown rather than a misleading 0.
 */
export const RESULT_FOR_GOAL: Record<string, { label: string; action?: string[]; field?: 'reach' | 'impressions'; unsure?: true }> = {
  CONVERSATIONS: { label: 'Chats started', action: ['onsite_conversion.messaging_conversation_started_7d'] },
  LINK_CLICKS: { label: 'Link clicks', action: ['link_click'] },
  LANDING_PAGE_VIEWS: { label: 'Landing page views', action: ['landing_page_view'] },
  POST_ENGAGEMENT: { label: 'Post engagement', action: ['post_engagement'] },
  PROFILE_VISIT: { label: 'Profile visits', action: ['instagram_profile_visit', 'ig_profile_visit'], unsure: true },
  VISIT_INSTAGRAM_PROFILE: { label: 'Profile visits', action: ['instagram_profile_visit', 'ig_profile_visit'], unsure: true },
  THRUPLAY: { label: 'Video plays', action: ['video_view'] },
  LEAD_GENERATION: { label: 'Leads', action: ['onsite_conversion.lead_grouped', 'lead'] },
  QUALITY_LEAD: { label: 'Leads', action: ['onsite_conversion.lead_grouped', 'lead'] },
  PAGE_LIKES: { label: 'Page likes', action: ['like'] },
  REACH: { label: 'People reached', field: 'reach' },
  IMPRESSIONS: { label: 'Impressions', field: 'impressions' },
  AD_RECALL_LIFT: { label: 'People reached', field: 'reach' },
};

export interface ActionRow { action_type: string; value: string }
export interface InsightRow {
  spend?: string; impressions?: string; reach?: string; frequency?: string;
  clicks?: string; inline_link_clicks?: string; ctr?: string; cpm?: string; cpc?: string;
  actions?: ActionRow[];
  date_start?: string; date_stop?: string;
  [k: string]: unknown;
}

export interface Metrics {
  spend: number; impressions: number; reach: number; frequency: number;
  clicks: number; linkClicks: number; ctr: number; cpm: number; cpc: number;
  actions: Record<string, number>;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function metricsOf(row: InsightRow | null | undefined): Metrics {
  const actions: Record<string, number> = {};
  for (const a of row?.actions ?? []) actions[a.action_type] = (actions[a.action_type] ?? 0) + num(a.value);
  return {
    spend: num(row?.spend), impressions: num(row?.impressions), reach: num(row?.reach), frequency: num(row?.frequency),
    clicks: num(row?.clicks), linkClicks: num(row?.inline_link_clicks), ctr: num(row?.ctr), cpm: num(row?.cpm), cpc: num(row?.cpc),
    actions,
  };
}

export const emptyMetrics = (): Metrics => metricsOf(null);

/** Add rows up (the account's daily rows into one, several ad sets into a campaign). Reach can't be added — it's left as the sum, an upper bound. */
export function sumMetrics(list: Metrics[]): Metrics {
  const out = emptyMetrics();
  for (const m of list) {
    out.spend += m.spend; out.impressions += m.impressions; out.reach += m.reach;
    out.clicks += m.clicks; out.linkClicks += m.linkClicks;
    for (const [k, v] of Object.entries(m.actions)) out.actions[k] = (out.actions[k] ?? 0) + v;
  }
  out.ctr = out.impressions ? (out.clicks / out.impressions) * 100 : 0;
  out.cpm = out.impressions ? (out.spend / out.impressions) * 1000 : 0;
  out.cpc = out.clicks ? out.spend / out.clicks : 0;
  out.frequency = out.reach ? out.impressions / out.reach : 0;
  return out;
}

/** The result count and its name, for an optimisation goal. */
export function resultOf(m: Metrics, goal: string | undefined): { label: string; value: number } | null {
  const r = goal ? RESULT_FOR_GOAL[goal] : undefined;
  if (!r) return null;
  if (r.field) return { label: r.label, value: m[r.field] };
  if (r.unsure && !(r.action ?? []).some(a => a in m.actions)) return null;
  const value = (r.action ?? []).reduce((best, a) => Math.max(best, m.actions[a] ?? 0), 0);
  return { label: r.label, value };
}

/** The actions worth a line on a summary, biggest first, without the ones that merely contain others. */
export function headlineActions(m: Metrics, limit = 6): { type: string; label: string; value: number }[] {
  const seen = new Set<string>();
  return HEADLINE_ACTIONS
    .filter(t => (m.actions[t] ?? 0) > 0)
    .map(t => ({ type: t, label: actionLabel(t), value: m.actions[t] }))
    .filter(a => (seen.has(a.label) ? false : (seen.add(a.label), true)))
    .slice(0, limit);
}

// ── Objects ────────────────────────────────────────────────────────────────

export type Level = 'campaign' | 'adset' | 'ad';

export interface AdsAccount {
  id: string; name: string; currency: string; timezone: string;
  status: number; disableReason: number;
  amountSpent: number; spendCap: number | null; balance: number;
  minDailyBudget: number | null;
  funding: string | null;
  businessName: string | null;
}

export interface TreeAd {
  id: string; name: string; status: string; effectiveStatus: string;
  thumbnail: string | null; issues: string[]; metrics: Metrics;
  creativeId: string | null; instagramPermalink: string | null;
}
export interface TreeAdSet {
  id: string; name: string; status: string; effectiveStatus: string;
  optimizationGoal: string; destination: string | null;
  dailyBudget: number | null; lifetimeBudget: number | null;
  startTime: string | null; endTime: string | null;
  learning: string | null; issues: string[];
  metrics: Metrics; ads: TreeAd[];
}
export interface TreeCampaign {
  id: string; name: string; status: string; effectiveStatus: string; objective: string;
  dailyBudget: number | null; lifetimeBudget: number | null;
  startTime: string | null; stopTime: string | null;
  issues: string[]; metrics: Metrics; adsets: TreeAdSet[];
}

/** Meta's objectives, as the owner would say them. */
export const OBJECTIVE_LABEL: Record<string, string> = {
  OUTCOME_AWARENESS: 'Awareness', OUTCOME_TRAFFIC: 'Traffic', OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads', OUTCOME_SALES: 'Sales', OUTCOME_APP_PROMOTION: 'App promotion',
  MESSAGES: 'Messages', LINK_CLICKS: 'Traffic', POST_ENGAGEMENT: 'Engagement', REACH: 'Reach',
  BRAND_AWARENESS: 'Awareness', CONVERSIONS: 'Sales', VIDEO_VIEWS: 'Video views',
};
export const objectiveLabel = (o: string) => OBJECTIVE_LABEL[o] ?? o.replace(/^OUTCOME_/, '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
