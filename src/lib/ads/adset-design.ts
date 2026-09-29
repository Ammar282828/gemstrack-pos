/**
 * Designing ad sets (owner, 2026-09-29: "i need to be able to design adsets"): one or several ad sets,
 * each its own audience, places, budget, dates and goal, into a campaign the account already has or a
 * new one, and the ads in them — copies of ads already in the account, or an Instagram post boosted.
 * The usual use is a test: the same ad to two or three audiences, side by side, and the dearer ones
 * paused after a week.
 *
 * Pure: what is sent for each ad set is New ad's own `adsetParams`, so the two can't drift. Tested.
 */

import { adsetParams, campaignParams, GOALS, goalOf, goesToSite, isChannelLink, type AdPlan, type Goal, type GoalKey, type PlanContext } from './plan';
import { defaultDraft, type AudienceDraft } from './targeting';
import { money } from './shape';

export interface AdSetDraft {
  /** The page's own id for the card. */
  key: string;
  name: string;
  goal: GoalKey;
  audience: AudienceDraft;
  budget: { kind: 'daily' | 'total'; amount: number; start: string | null; end: string | null };
}

export type DesignCampaign =
  /** `budgeted`: the campaign holds the budget (Advantage campaign budget), so its ad sets carry none. */
  | { kind: 'existing'; id: string; objective: string; budgeted: boolean; name?: string }
  | { kind: 'new'; name: string };

export type DesignAds =
  | { kind: 'copy'; ids: string[] }
  | { kind: 'post'; mediaId: string; link?: string };

export interface AdSetDesign {
  campaign: DesignCampaign;
  adsets: AdSetDraft[];
  ads: DesignAds;
  launch: 'paused' | 'live';
}

/** The goals an ad set can have in a campaign of this objective (Meta fixes the objective per campaign). */
export const goalsForObjective = (objective: string): Goal[] => GOALS.filter(g => g.objective === objective);

/** A fresh card: the one before it with a new name, so a test changes one thing at a time. */
export function nextAdSet(prev: AdSetDraft | null, n: number, goal: GoalKey = 'whatsapp'): AdSetDraft {
  const base = prev ?? { key: '', name: '', goal, audience: defaultDraft(), budget: { kind: 'daily' as const, amount: 1000, start: null, end: null } };
  return { ...base, key: `s${n}-${Math.random().toString(36).slice(2, 7)}`, name: `Ad set ${n}`, audience: { ...base.audience }, budget: { ...base.budget } };
}

/** The ad set as a plan, for New ad's payload builders. */
function asPlan(s: AdSetDraft, d: AdSetDesign): AdPlan {
  return {
    goal: s.goal,
    source: d.ads.kind === 'post' ? { kind: 'post', mediaId: d.ads.mediaId } : { kind: 'photos', photos: [] },
    text: '', headline: '', link: d.ads.kind === 'post' ? d.ads.link ?? '' : '', button: 'SHOP_NOW',
    audience: s.audience, budget: s.budget, launch: d.launch, name: s.name.trim(),
  };
}

/** What stops the design being made, in words. Empty = ready. */
export function designProblems(d: AdSetDesign, ctx: PlanContext): string[] {
  const out: string[] = [];
  const now = ctx.now ?? Date.now();
  if (!d.adsets.length) out.push('Add an ad set.');
  if (d.campaign.kind === 'new' && !d.campaign.name.trim()) out.push('Name the campaign.');
  const objectives = new Set(d.adsets.map(s => goalOf(s.goal).objective));
  if (d.campaign.kind === 'existing') {
    const allowed = goalsForObjective(d.campaign.objective);
    if (!allowed.length) out.push('The ERP can’t add ad sets to a campaign of this kind — open it in Ads Manager.');
    else if (d.adsets.some(s => !allowed.some(g => g.key === s.goal))) out.push(`In this campaign an ad set’s goal is one of: ${allowed.map(g => g.label).join(', ')}.`);
  } else if (objectives.size > 1) out.push('One campaign has one kind of goal — give every ad set a goal of the same kind, or make them in two campaigns.');
  if (d.ads.kind === 'copy' && !d.ads.ids.length) out.push('Choose the ads to put in them.');
  if (d.ads.kind === 'post' && !d.ads.mediaId) out.push('Choose the post to boost.');
  const budgeted = d.campaign.kind === 'existing' && d.campaign.budgeted;
  d.adsets.forEach((s, i) => {
    const who = d.adsets.length > 1 ? `${s.name.trim() || `Ad set ${i + 1}`}: ` : '';
    const goal = goalOf(s.goal);
    if (!s.name.trim()) out.push(`${who}give it a name.`);
    if (!s.audience.places.length) out.push(`${who}choose where it shows.`);
    if (d.ads.kind === 'post' && goal.photosOnly) out.push(`${who}“${goal.label}” works with new photos, not a boosted post.`);
    if (d.ads.kind === 'copy' && goal.postOnly) out.push(`${who}“${goal.label}” works only on a boosted post.`);
    if (d.ads.kind === 'post' && goesToSite(s.goal) && !/^https?:\/\/\S+\.\S+/.test(d.ads.link ?? '')) out.push(`${who}give the website address the button opens.`);
    if (d.ads.kind === 'post' && s.goal === 'channel' && !isChannelLink(d.ads.link ?? '')) out.push(`${who}give the WhatsApp channel’s link.`);
    if (s.goal === 'sales' && !ctx.pixelId) out.push(`${who}“Online orders” needs the website’s pixel (Setup).`);
    if (!budgeted) {
      if (!(s.budget.amount > 0)) out.push(`${who}set a budget.`);
      else if (s.budget.kind === 'daily' && ctx.minDaily && s.budget.amount < ctx.minDaily) out.push(`${who}Meta’s smallest daily budget here is ${money(ctx.minDaily, ctx.currency)}.`);
      if (s.budget.kind === 'total' && !s.budget.end) out.push(`${who}a total budget needs an end date.`);
    }
    if (s.budget.end && Date.parse(s.budget.end) <= now) out.push(`${who}the end date has passed.`);
    if (s.budget.start && s.budget.end && Date.parse(s.budget.end) <= Date.parse(s.budget.start)) out.push(`${who}the end comes before the start.`);
  });
  return [...new Set(out)];
}

/** The new campaign, named by the owner, of the ad sets' kind. */
export function designCampaignParams(d: AdSetDesign & { campaign: { kind: 'new' } }): Record<string, unknown> {
  return campaignParams({ ...asPlan(d.adsets[0], d), name: d.campaign.name.trim() });
}

/** What Meta is sent for one ad set — New ad's own builder; no budget when the campaign holds it. */
export function designAdsetParams(s: AdSetDraft, d: AdSetDesign, campaignId: string, ctx: PlanContext): Record<string, unknown> {
  const p = adsetParams(asPlan(s, d), campaignId, ctx);
  if (d.campaign.kind === 'existing' && d.campaign.budgeted) { delete p.daily_budget; delete p.lifetime_budget; }
  return p;
}

/** The boosted post as a plan for one goal (its button follows the goal), for `creativeSpec`. */
export const postPlan = (s: AdSetDraft, d: AdSetDesign): AdPlan => asPlan(s, d);

/** How many ads the design makes: every chosen ad in every ad set. */
export const adCount = (d: AdSetDesign) => d.adsets.length * (d.ads.kind === 'copy' ? d.ads.ids.length : 1);
