/**
 * What the iPhone's New ad and ad set screens ask the server for, so the phone keeps no copy of New ad's
 * rules (apps/iphone/CONVENTIONS.md rule 1, "one brain"): the goals and buttons this house offers, in the
 * web's own words; what stops a plan or a design and what it will do and cost, in planSummary's lines; and
 * the days ahead the house keeps free of product ads (Taheri's Bohra calendar, as New ad warns of them).
 *
 * Pure: /api/ads/plan adds the house's context (links, flags, the account's currency and smallest budget).
 * Tested (phone-plan.test.ts).
 */

import { GOALS, defaultName, goalOf, goesToSite, planProblems, planSummary, type AdPlan, type GoalKey, type PlanContext } from './plan';
import { describeAudience, IG_POSITIONS } from './targeting';
import { adCount, designProblems, type AdSetDesign } from './adset-design';
import { hijriLabel, karachiDay, quietDaysBetween } from './studio/calendar';
import { money, objectiveLabel } from './shape';

const DAY = 86_400_000;

/** The house's own addresses (STORE_LINKS): where a website ad, an order ad and a channel ad go. */
export interface HouseLinks { website: string; shop: string; waChannel: string }

/** New ad's button choices for a website ad (the same list as src/app/ads/new/page.tsx BUTTONS). */
export const BUTTONS: { key: AdPlan['button']; label: string }[] = [
  { key: 'SHOP_NOW', label: 'Shop now' }, { key: 'LEARN_MORE', label: 'Learn more' }, { key: 'SEE_MORE', label: 'See more' },
  { key: 'ORDER_NOW', label: 'Order now' }, { key: 'CONTACT_US', label: 'Contact us' },
];

export interface PhoneGoal {
  key: GoalKey;
  label: string;
  hint: string;
  objective: string;
  optimization: string;
  postOnly: boolean;
  photosOnly: boolean;
  /** The button opens a page on the house's site (website visits, online orders). */
  toSite: boolean;
  /** New ad offers it in this house: a channel ad needs a channel, an order ad a site that takes orders (new/page.tsx). */
  newAd: boolean;
}

/** Every goal, as the phone shows it. The ad set designer offers them by the campaign's objective; New ad only the `newAd` ones. */
export function phoneGoals(links: HouseLinks): PhoneGoal[] {
  return GOALS.map(g => ({
    key: g.key, label: g.label, hint: g.hint, objective: g.objective, optimization: g.optimization,
    postOnly: !!g.postOnly, photosOnly: !!g.photosOnly, toSite: goesToSite(g.key),
    newAd: (g.key !== 'channel' || !!links.waChannel) && (g.key !== 'sales' || !!(links.shop || links.website)),
  }));
}

/** A day the house keeps free of product ads: a sacred day, or one of the days just before it. */
export interface QuietDay { date: string; hijri: string; name: string; near: boolean }

/** The quiet days from `from` to `to` (Karachi days, inclusive), as New ad lists them. */
export function quietDays(from: string, to: string): QuietDay[] {
  return quietDaysBetween(from, to)
    .filter(d => d.level === 'sacred' || d.level === 'near')
    .map(d => ({ date: d.date, hijri: hijriLabel(d.hijri), name: d.observance?.name ?? '', near: d.level === 'near' }));
}

/** The days a plan's budget would run through: from its start (or now) to its end (or a month on, left running). */
export function quietForBudget(budget: AdPlan['budget'], now = Date.now()): QuietDay[] {
  const from = karachiDay(budget.start ? new Date(budget.start) : new Date(now));
  const to = karachiDay(new Date(budget.end ? Date.parse(budget.end) : now + 30 * DAY));
  return quietDays(from, to);
}

/** GET /api/ads/plan: what New ad's form offers in this house. `quiet` covers the next 400 days (empty without the calendar). */
export function newAdLists(links: HouseLinks, opts: { sitePieces: boolean; calendar: boolean; now?: number }) {
  const now = opts.now ?? Date.now();
  return {
    goals: phoneGoals(links),
    buttons: BUTTONS,
    igPositions: IG_POSITIONS,
    links,
    sitePieces: opts.sitePieces && !!links.website,
    quiet: opts.calendar ? quietDays(karachiDay(new Date(now)), karachiDay(new Date(now + 400 * DAY))) : [],
  };
}

/** Enough of a plan to check (the create route's own test, without the name: an empty one is made here). */
export function isPlanShape(p: unknown): p is AdPlan {
  const x = p as AdPlan;
  return !!x && typeof x === 'object'
    && GOALS.some(g => g.key === x.goal)
    && !!x.source && (x.source.kind === 'post' || (x.source.kind === 'photos' && Array.isArray(x.source.photos)))
    && typeof x.text === 'string' && typeof x.headline === 'string' && typeof x.link === 'string'
    && !!x.audience && Array.isArray(x.audience.places)
    && !!x.budget && typeof x.budget.amount === 'number'
    && (x.launch === 'paused' || x.launch === 'live');
}

/** Enough of a design to check (the adsets route's own test). */
export function isDesignShape(d: unknown): d is AdSetDesign {
  const x = d as AdSetDesign;
  return !!x && typeof x === 'object' && Array.isArray(x.adsets) && x.adsets.length > 0 && !!x.campaign && !!x.ads
    && x.adsets.every(s => GOALS.some(g => g.key === s.goal) && !!s.audience && Array.isArray(s.audience.places) && !!s.budget);
}

export interface PlanCheck {
  problems: string[];
  /** planSummary's lines: the goal, what runs, who, the budget and what it can cost, paused or live. */
  summary: string[];
  /** The name Meta files it under: the one typed, else New ad's default. */
  name: string;
  /** describeAudience: "Karachi +25 km · 22–45 · women · Advantage+ · Instagram only". */
  audience: string;
}

/** POST /api/ads/plan { plan }: what stops it, and what it will do — the same lines New ad's confirm shows. */
export function checkPlan(plan: AdPlan, ctx: PlanContext): PlanCheck {
  const now = ctx.now ?? Date.now();
  const name = (plan.name ?? '').trim() || defaultName(plan, now);
  const p = { ...plan, name };
  return { problems: planProblems(p, ctx), summary: planSummary(p, ctx.currency), name, audience: describeAudience(p.audience) };
}

/**
 * A budget in words, as planSummary says it ("Rs 1,000 a day for 7 days — at most about Rs 7,000"). planSummary
 * keeps its words to itself, so they are said again here; the test holds the two to the same lines.
 */
export function spendWords(budget: AdPlan['budget'], currency: string, now = Date.now()): string {
  const days = budget.end ? Math.max(1, Math.round((Date.parse(budget.end) - (budget.start ? Date.parse(budget.start) : now)) / DAY)) : null;
  return budget.kind === 'daily'
    ? `${money(budget.amount, currency)} a day${days ? ` for ${days} day${days === 1 ? '' : 's'} — at most about ${money(budget.amount * days, currency)}` : ', until it is paused'}`
    : `${money(budget.amount, currency)} in total${days ? ` over ${days} day${days === 1 ? '' : 's'}` : ''}`;
}

/** The most a budget can spend, or null when it runs until paused. */
function mostOf(budget: AdPlan['budget'], now: number): number | null {
  if (budget.kind === 'total') return budget.amount;
  if (!budget.end) return null;
  const days = Math.max(1, Math.round((Date.parse(budget.end) - (budget.start ? Date.parse(budget.start) : now)) / DAY));
  return budget.amount * days;
}

/** A design in plain words for the confirm step: where, each ad set's goal, budget and audience, the ads, live or paused. */
export function designSummary(d: AdSetDesign, currency: string, now = Date.now()): string[] {
  const lines: string[] = [];
  lines.push(d.campaign.kind === 'new'
    ? `A new campaign: “${d.campaign.name.trim()}”`
    : `Into the campaign “${d.campaign.name?.trim() || d.campaign.id}”${d.campaign.objective ? ` (${objectiveLabel(d.campaign.objective)})` : ''}`);
  const budgeted = d.campaign.kind === 'existing' && d.campaign.budgeted;
  let perDay = 0;
  let most: number | null = 0;
  d.adsets.forEach((s, i) => {
    const spend = budgeted ? 'shares the campaign’s own budget' : spendWords(s.budget, currency, now);
    lines.push(`${s.name.trim() || `Ad set ${i + 1}`}: ${goalOf(s.goal).label} · ${spend} · ${describeAudience(s.audience)}`);
    if (s.budget.kind === 'daily') perDay += s.budget.amount;
    const m = mostOf(s.budget, now);
    most = most === null || m === null ? null : most + m;
  });
  if (!budgeted && d.adsets.length > 1) {
    const together = [perDay > 0 ? `${money(perDay, currency)} a day` : '', most !== null ? `at most about ${money(most, currency)} in all` : 'until they are paused'].filter(Boolean);
    lines.push(`Together: ${together.join(', ')}`);
  }
  const n = adCount(d);
  lines.push(d.ads.kind === 'copy'
    ? `${n} ad${n === 1 ? '' : 's'}: a copy of each of the ${d.ads.ids.length} chosen ad${d.ads.ids.length === 1 ? '' : 's'} in every ad set`
    : `${n} ad${n === 1 ? '' : 's'}: the Instagram post, as it is, in every ad set`);
  lines.push(d.launch === 'live'
    ? 'They start as soon as Meta approves them (usually within the hour)'
    : 'Made paused — nothing is spent until they are switched on');
  return lines;
}

export interface DesignCheck { problems: string[]; summary: string[]; count: number }

/** POST /api/ads/plan { design }: what stops it (designProblems) and what it will do and cost. */
export function checkDesign(d: AdSetDesign, ctx: PlanContext): DesignCheck {
  return { problems: designProblems(d, ctx), summary: designSummary(d, ctx.currency, ctx.now ?? Date.now()), count: adCount(d) };
}
