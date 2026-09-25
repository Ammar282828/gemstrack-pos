/**
 * A new ad as the New ad page fills it in (AdPlan), and exactly what Meta is
 * sent for it: the campaign, the ad set, the creative. Pure, so every payload is
 * tested without Meta (plan.test.ts), and the browser and the server agree on
 * what "WhatsApp chats" or "Boost a post" means.
 *
 * One campaign → one ad set → one ad per plan: the simplest shape Meta runs,
 * and the one a shop can read at a glance on the Campaigns tab.
 *
 * Photos are never changed by Meta: every Advantage+ creative feature that
 * edits, animates, crops, relights or re-words an ad is opted out
 * (NO_ENHANCEMENTS). A jewellery photo is the product.
 */

import { buildTargeting, describeAudience, type AudienceDraft } from './targeting';
import { money, toMinor } from './shape';

export type GoalKey = 'whatsapp' | 'instagram_dm' | 'website' | 'profile' | 'engagement' | 'reach';

export interface Goal {
  key: GoalKey;
  label: string;
  /** One line under the label on the picker. */
  hint: string;
  objective: string;
  optimization: string;
  destination?: string;
  /** The ad set promotes the Page (messaging ads). */
  promotesPage?: true;
  /** Only for an existing Instagram post. */
  postOnly?: true;
}

export const GOALS: Goal[] = [
  { key: 'whatsapp', label: 'WhatsApp chats', hint: 'People tap and start a WhatsApp chat with the shop.', objective: 'OUTCOME_ENGAGEMENT', optimization: 'CONVERSATIONS', destination: 'WHATSAPP', promotesPage: true },
  { key: 'instagram_dm', label: 'Instagram messages', hint: 'People tap and message the shop on Instagram.', objective: 'OUTCOME_ENGAGEMENT', optimization: 'CONVERSATIONS', destination: 'INSTAGRAM_DIRECT', promotesPage: true },
  { key: 'website', label: 'Website visits', hint: 'People tap through to the piece on the website.', objective: 'OUTCOME_TRAFFIC', optimization: 'LINK_CLICKS', destination: 'WEBSITE' },
  { key: 'profile', label: 'Instagram profile visits', hint: 'People tap through to the shop’s Instagram profile.', objective: 'OUTCOME_TRAFFIC', optimization: 'VISIT_INSTAGRAM_PROFILE', destination: 'INSTAGRAM_PROFILE' },
  { key: 'engagement', label: 'Likes, comments and saves', hint: 'More people engage with the post itself.', objective: 'OUTCOME_ENGAGEMENT', optimization: 'POST_ENGAGEMENT', destination: 'ON_POST', postOnly: true },
  { key: 'reach', label: 'Seen by the most people', hint: 'As many different people as the budget allows.', objective: 'OUTCOME_AWARENESS', optimization: 'REACH' },
];
export const goalOf = (k: GoalKey) => GOALS.find(g => g.key === k)!;

export interface PlanPhoto { hash: string; url?: string | null; headline?: string; link?: string }

export interface AdPlan {
  goal: GoalKey;
  /** An existing Instagram post (its media id), or new photos (1 = single image, 2–10 = carousel). */
  source: { kind: 'post'; mediaId: string; permalink?: string; thumb?: string | null; caption?: string } | { kind: 'photos'; photos: PlanPhoto[] };
  /** What the ad says (new photos only — a boosted post keeps its own caption). */
  text: string;
  headline: string;
  /** Where the button goes (website visits; the carousel's default card link). */
  link: string;
  button: 'SHOP_NOW' | 'LEARN_MORE' | 'SEE_MORE' | 'ORDER_NOW' | 'CONTACT_US';
  audience: AudienceDraft;
  budget: { kind: 'daily' | 'total'; amount: number; start: string | null; end: string | null };
  /** Paused to look over in Campaigns first, or live as soon as Meta approves it. */
  launch: 'paused' | 'live';
  name: string;
}

export interface PlanContext {
  pageId: string | null;
  instagramUserId: string | null;
  instagramUsername: string | null;
  whatsappGreeting: string | null;
  currency: string;
  /** The account's smallest daily budget, in the currency (Meta's min_daily_budget). */
  minDaily: number | null;
  now?: number;
}

/** Every Advantage+ creative feature that changes the picture or the words, switched off. */
export const NO_ENHANCEMENTS: Record<string, { enroll_status: 'OPT_OUT' }> = Object.fromEntries([
  'adapt_to_placement', 'image_touchups', 'image_background_gen', 'image_animation', 'image_templates',
  'music_generation', 'multi_photo_to_video', 'text_optimizations', 'add_text_overlay', 'creative_stickers',
  'replace_media_text', 'text_overlay_translation', 'inline_comment',
].map(k => [k, { enroll_status: 'OPT_OUT' as const }]));

export const WHATSAPP_LINK = 'https://api.whatsapp.com/send';

/** What stops the plan being sent, in words. Empty = ready. */
export function planProblems(p: AdPlan, ctx: PlanContext): string[] {
  const out: string[] = [];
  const goal = goalOf(p.goal);
  const now = ctx.now ?? Date.now();
  if (!ctx.pageId) out.push('Choose the Facebook Page behind new ads on the Setup tab — Meta needs one even for Instagram-only ads.');
  if (!ctx.instagramUserId) out.push('Choose the shop’s Instagram account on the Setup tab.');
  if (p.source.kind === 'post' && !p.source.mediaId) out.push('Choose the post to promote.');
  if (p.source.kind === 'photos') {
    if (!p.source.photos.length) out.push('Add a photo.');
    if (p.source.photos.length > 10) out.push('A carousel takes at most 10 photos.');
    if (goal.postOnly) out.push(`“${goal.label}” works only on an existing Instagram post.`);
    if (!p.text.trim()) out.push('Write what the ad says.');
  }
  if (p.goal === 'website') {
    const ok = (l?: string) => /^https?:\/\/\S+\.\S+/.test((l ?? '').trim());
    const fine = ok(p.link) || (p.source.kind === 'photos' && p.source.photos.length > 0 && p.source.photos.every(x => ok(x.link)));
    if (!fine) out.push('Give the website address the ad opens.');
  }
  if (!(p.budget.amount > 0)) out.push('Set a budget.');
  if (p.budget.kind === 'daily' && ctx.minDaily && p.budget.amount < ctx.minDaily) out.push(`Meta’s smallest daily budget for this account is ${money(ctx.minDaily, ctx.currency)}.`);
  if (p.budget.kind === 'total') {
    if (!p.budget.end) out.push('A total budget needs an end date.');
    else {
      const start = p.budget.start ? Date.parse(p.budget.start) : now;
      const hours = (Date.parse(p.budget.end) - start) / 3_600_000;
      if (!(hours >= 24)) out.push('A total budget needs to run for at least a day.');
    }
  }
  if (p.budget.end && Date.parse(p.budget.end) <= now) out.push('The end date has passed.');
  if (p.budget.start && p.budget.end && Date.parse(p.budget.end) <= Date.parse(p.budget.start)) out.push('The end comes before the start.');
  if (!p.audience.places.length) out.push('Choose where the ad shows.');
  return out;
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The name Meta files it under: "WhatsApp chats · Emerald jhumkas · 2026-09-25". */
export function defaultName(p: Pick<AdPlan, 'goal' | 'headline' | 'source'>, now = Date.now()): string {
  const what = p.headline.trim() || (p.source.kind === 'post' ? (p.source.caption ?? '').split('\n')[0].slice(0, 40).trim() || 'Instagram post' : 'New ad');
  return `${goalOf(p.goal).label} · ${what} · ${day(now)}`;
}

export function campaignParams(p: AdPlan): Record<string, unknown> {
  return {
    name: p.name,
    objective: goalOf(p.goal).objective,
    status: 'PAUSED',
    special_ad_categories: [],
    // Required since v24 when the budget sits on the ad set, as it does here.
    is_adset_budget_sharing_enabled: false,
  };
}

export function adsetParams(p: AdPlan, campaignId: string, ctx: PlanContext): Record<string, unknown> {
  const goal = goalOf(p.goal);
  const params: Record<string, unknown> = {
    name: p.name,
    campaign_id: campaignId,
    status: 'PAUSED',
    billing_event: 'IMPRESSIONS',
    optimization_goal: goal.optimization,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: buildTargeting(p.audience),
  };
  if (goal.destination) params.destination_type = goal.destination;
  if (goal.promotesPage && ctx.pageId) params.promoted_object = { page_id: ctx.pageId };
  if (p.budget.kind === 'daily') params.daily_budget = toMinor(p.budget.amount, ctx.currency);
  else params.lifetime_budget = toMinor(p.budget.amount, ctx.currency);
  if (p.budget.start) params.start_time = new Date(p.budget.start).toISOString();
  if (p.budget.end) params.end_time = new Date(p.budget.end).toISOString();
  return params;
}

/** The button, for a goal: chat buttons open the chat; the others a link. */
export function callToAction(p: AdPlan, link: string, ctx: PlanContext): Record<string, unknown> | null {
  if (p.goal === 'whatsapp') return { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } };
  if (p.goal === 'instagram_dm') return { type: 'INSTAGRAM_MESSAGE', value: { app_destination: 'INSTAGRAM_DIRECT' } };
  if (p.goal === 'profile') return { type: 'VIEW_INSTAGRAM_PROFILE', value: { link: profileUrl(ctx) } };
  if (p.goal === 'engagement') return null;
  return link ? { type: p.button, value: { link } } : null;
}

const profileUrl = (ctx: PlanContext) => (ctx.instagramUsername ? `https://www.instagram.com/${ctx.instagramUsername}/` : 'https://www.instagram.com/');

/** Where an ad's picture links, when the goal doesn't decide it. */
function linkFor(p: AdPlan, ctx: PlanContext, own?: string): string {
  if (p.goal === 'whatsapp') return WHATSAPP_LINK;
  if (p.goal === 'profile') return profileUrl(ctx);
  return (own || p.link || '').trim() || profileUrl(ctx);
}

/** The creative: a boosted post, or new photos as a single image or carousel ad. */
export function creativeSpec(p: AdPlan, ctx: PlanContext, opts: { enhancements?: Record<string, unknown> } = {}): Record<string, unknown> {
  const dof = { creative_features_spec: opts.enhancements ?? NO_ENHANCEMENTS };
  if (p.source.kind === 'post') {
    const cta = callToAction(p, linkFor(p, ctx), ctx);
    return {
      name: p.name,
      object_id: ctx.pageId,
      instagram_user_id: ctx.instagramUserId,
      source_instagram_media_id: p.source.mediaId,
      ...(cta ? { call_to_action: cta } : {}),
      degrees_of_freedom_spec: dof,
    };
  }
  const photos = p.source.photos;
  const link = linkFor(p, ctx);
  const greeting = p.goal === 'whatsapp' && ctx.whatsappGreeting ? { page_welcome_message: ctx.whatsappGreeting } : {};
  const cta = callToAction(p, link, ctx);
  let link_data: Record<string, unknown>;
  if (photos.length === 1) {
    link_data = {
      message: p.text,
      image_hash: photos[0].hash,
      ...(p.headline.trim() ? { name: p.headline.trim() } : {}),
      // Instagram-message ads take no link (Meta's own example has none).
      ...(p.goal === 'instagram_dm' ? {} : { link: p.goal === 'website' ? linkFor(p, ctx, photos[0].link) : link }),
      ...(cta ? { call_to_action: p.goal === 'website' ? { type: p.button, value: { link: linkFor(p, ctx, photos[0].link) } } : cta } : {}),
      ...greeting,
    };
  } else {
    link_data = {
      message: p.text,
      link,
      // Keep the cards in the order they were chosen (Meta reorders them by default).
      multi_share_optimized: false,
      child_attachments: photos.map(ph => {
        const own = p.goal === 'website' ? linkFor(p, ctx, ph.link) : link;
        const card = callToAction(p, own, ctx);
        return {
          image_hash: ph.hash,
          link: own,
          ...((ph.headline || p.headline).trim() ? { name: (ph.headline || p.headline).trim() } : {}),
          ...(card ? { call_to_action: card } : {}),
        };
      }),
      ...(cta ? { call_to_action: cta } : {}),
      ...greeting,
    };
  }
  return {
    name: p.name,
    object_story_spec: { page_id: ctx.pageId, instagram_user_id: ctx.instagramUserId, link_data },
    degrees_of_freedom_spec: dof,
  };
}

/** The keys of NO_ENHANCEMENTS that Meta's error names — to be left out of a retry. */
export function enhancementsRejected(message: string): string[] {
  return Object.keys(NO_ENHANCEMENTS).filter(k => message.includes(k));
}

/** A plain-words summary of what will be sent, for the confirm step. */
export function planSummary(p: AdPlan, currency: string): string[] {
  const g = goalOf(p.goal);
  const days = p.budget.end ? Math.max(1, Math.round((Date.parse(p.budget.end) - (p.budget.start ? Date.parse(p.budget.start) : Date.now())) / 86_400_000)) : null;
  const spend = p.budget.kind === 'daily'
    ? `${money(p.budget.amount, currency)} a day${days ? ` for ${days} day${days === 1 ? '' : 's'} — at most about ${money(p.budget.amount * days, currency)}` : ', until it is paused'}`
    : `${money(p.budget.amount, currency)} in total${days ? ` over ${days} day${days === 1 ? '' : 's'}` : ''}`;
  return [
    `Goal: ${g.label}`,
    p.source.kind === 'post' ? 'The Instagram post, as it is' : p.source.photos.length > 1 ? `${p.source.photos.length} photos, as a carousel` : 'One photo',
    `Who: ${describeAudience(p.audience)}`,
    `Budget: ${spend}`,
    p.launch === 'live' ? 'Starts as soon as Meta approves it (usually within the hour)' : 'Saved paused — nothing is spent until it is switched on',
  ];
}
