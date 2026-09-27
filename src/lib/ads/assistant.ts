/**
 * The Ads helper: questions about this house's Meta ad account, answered by
 * Gemini Pro with the account in front of it.
 *
 * Every question goes with a snapshot of the ad account for the range the page
 * shows (account state, totals against the period before, day by day, every
 * campaign → ad set → ad with its numbers, top ads, who saw them, flagged ads,
 * audiences, rules, recent changes from the ERP), and the model may ask for more
 * through two read-only tools — insights for any range, level or breakdown, and
 * one campaign / ad set / ad in detail. It can't change anything; it says where
 * in the ERP to do it.
 *
 * Billed like Post a Piece's AI: IMAGE_AI_PROJECT (Murtaza's project) through
 * src/lib/social/ai.ts — locally his ADC (IMAGE_AI_CREDENTIALS), in production
 * the runtime account he granted. The newest Pro model the project can use:
 * ADS_AI_MODEL, else gemini-3.5-pro, else IMAGE_AI_TEXT_MODEL (3.1 Pro); a model
 * the project can't reach (404) is skipped and the next remembered.
 *
 * Server-only.
 */

import { STORE_BRAND, STORE_CONFIG } from '@/lib/store-config';
import { AiError, chatTurn, TEXT_MODEL, type ChatContent } from '@/lib/social/ai';
import { actId, graph, graphAll, MetaAdsError } from './meta';
import { accountSummary, requireAccount } from './settings';
import { breakdowns, daily, previousPeriod, problemAds, topAds, totals, tree, BASE_FIELDS } from './insights';
import { listAudiences } from './audiences';
import { listRules } from './rules';
import { recentAdsLog } from './log';
import { currencyOffset, fromMinor, headlineActions, isRange, metricsOf, money, rangeLabel, resultOf, RANGES, type InsightRow, type Metrics, type RangeKey } from './shape';
import { describeAudience, parseTargeting } from './targeting';
import { attentionItems } from './attention';

// ── Models ─────────────────────────────────────────────────────────────────

const MODELS = () => [...new Set([process.env.ADS_AI_MODEL?.trim(), 'gemini-3.5-pro', TEXT_MODEL].filter((m): m is string => !!m))];
let working: { model: string; at: number } | null = null;

// ── Shaping numbers for the model ──────────────────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;
function compact(m: Metrics) {
  const out: Record<string, unknown> = {
    spend: r2(m.spend), reach: m.reach, impressions: m.impressions, frequency: r2(m.frequency),
    clicks: m.clicks, link_clicks: m.linkClicks, ctr_pct: r2(m.ctr), cpm: r2(m.cpm), cpc: r2(m.cpc),
  };
  const acts = headlineActions(m, 8);
  if (acts.length) out.results = Object.fromEntries(acts.map(a => [a.label, a.value]));
  return out;
}
const withResult = (m: Metrics, goal?: string) => {
  const r = resultOf(m, goal);
  return { ...compact(m), ...(r ? { result: r.label, results_count: r.value, cost_per_result: r.value ? r2(m.spend / r.value) : null } : {}) };
};

// ── The snapshot ───────────────────────────────────────────────────────────

const snapCache = new Map<string, { at: number; snap: Record<string, unknown> }>();

export async function adsSnapshot(range: RangeKey): Promise<Record<string, unknown>> {
  const { act, settings } = await requireAccount();
  const key = `${act}|${range}`;
  const hit = snapCache.get(key);
  if (hit && Date.now() - hit.at < 120_000) return hit.snap;

  const account = await accountSummary(act);
  const cur = account.currency;
  const [now, days, top, split, problems, campaigns, audiences, rules, log] = await Promise.all([
    totals(act, range),
    daily(act, range).catch(() => []),
    topAds(act, range, 10).catch(() => []),
    breakdowns(act, range).catch(() => null),
    problemAds(act).catch(() => []),
    tree(act, range, { offset: currencyOffset(cur) }).catch(() => []),
    listAudiences(act).catch(() => []),
    listRules(act, cur).catch(() => []),
    recentAdsLog(15).catch(() => []),
  ]);
  const prevRange = range !== 'maximum' && now.since && now.until ? previousPeriod(now.since, now.until) : null;
  const before = prevRange ? await totals(act, prevRange).catch(() => null) : null;

  const snap: Record<string, unknown> = {
    account: {
      name: account.name, id: account.id, currency: cur, timezone: account.timezone,
      status: account.status, amount_spent_all_time: account.amountSpent, spend_cap: account.spendCap,
      balance_due: account.balance, min_daily_budget: account.minDailyBudget, payment_method: account.funding,
    },
    advertises_as: { facebook_page: settings.pageName, instagram: settings.instagramUsername ? `@${settings.instagramUsername}` : null },
    range: { key: range, label: rangeLabel(range), since: now.since, until: now.until },
    totals: compact(now.metrics),
    previous_period: before && prevRange ? { since: prevRange.since, until: prevRange.until, totals: compact(before.metrics) } : null,
    daily: days.map(d => ({ date: d.date, spend: r2(d.metrics.spend), reach: d.metrics.reach, clicks: d.metrics.clicks, ...(headlineActions(d.metrics, 3).length ? { results: Object.fromEntries(headlineActions(d.metrics, 3).map(a => [a.label, a.value])) } : {}) })),
    campaigns: campaigns.slice(0, 30).map(c => ({
      id: c.id, name: c.name, status: c.effectiveStatus, objective: c.objective,
      budget: c.dailyBudget ? `${money(c.dailyBudget, cur)}/day` : c.lifetimeBudget ? `${money(c.lifetimeBudget, cur)} total` : 'on ad sets',
      ends: c.stopTime, issues: c.issues.length ? c.issues : undefined,
      numbers: compact(c.metrics),
      ad_sets: c.adsets.slice(0, 12).map(s => ({
        id: s.id, name: s.name, status: s.effectiveStatus, optimises_for: s.optimizationGoal, destination: s.destination,
        budget: s.dailyBudget ? `${money(s.dailyBudget, cur)}/day` : s.lifetimeBudget ? `${money(s.lifetimeBudget, cur)} total` : null,
        starts: s.startTime, ends: s.endTime, learning: s.learning, issues: s.issues.length ? s.issues : undefined,
        numbers: withResult(s.metrics, s.optimizationGoal),
        ads: s.ads.slice(0, 12).map(a => ({ id: a.id, name: a.name, status: a.effectiveStatus, issues: a.issues.length ? a.issues : undefined, numbers: withResult(a.metrics, s.optimizationGoal) })),
      })),
    })),
    campaigns_not_shown: Math.max(0, campaigns.length - 30),
    top_ads_by_spend: top.map(a => ({ id: a.id, name: a.name, campaign: a.campaign, numbers: withResult(a.metrics, a.goal ?? undefined) })),
    who_saw_them: split ? {
      age_gender: split.ageGender.slice(0, 12).map(b => ({ group: b.label, ...compact(b.metrics) })),
      placement: split.placement.slice(0, 10).map(b => ({ placement: b.label, ...compact(b.metrics) })),
      region: split.region.slice(0, 10).map(b => ({ region: b.label, ...compact(b.metrics) })),
    } : null,
    stopped_or_flagged_ads: problems,
    // The same rules the Overview's "Needs a look" strip applies — so the helper and the strip agree.
    needs_attention: attentionItems({ account, campaigns, days: Math.max(1, days.length) }).map(a => ({ severity: a.severity, what: a.title, why: a.why })),
    audiences: audiences.slice(0, 40).map(a => ({ id: a.id, name: a.name, kind: a.kind, size: a.size ? `${a.size[0]}–${a.size[1]}` : null, note: a.status })),
    automated_rules: rules.map(r => ({ name: r.name, on: r.enabled, what: r.summary })),
    recent_changes_from_the_erp: log.map(l => ({ at: l.at, what: l.action, target: l.name ?? l.target, by: l.by })),
  };
  snapCache.set(key, { at: Date.now(), snap });
  return snap;
}

// ── Tools the model may call (read-only) ───────────────────────────────────

const BREAKDOWNS: Record<string, string> = {
  age_gender: 'age,gender', placement: 'publisher_platform,platform_position', region: 'region',
  country: 'country', device: 'impression_device', hour_of_day: 'hourly_stats_aggregated_by_advertiser_time_zone',
};

export const TOOLS = [{
  functionDeclarations: [
    {
      name: 'get_insights',
      description: 'Numbers from Meta for any date range, level and breakdown: spend, reach, impressions, clicks, CTR, CPM, CPC and results. Use it for ranges or splits the snapshot does not already hold.',
      parameters: {
        type: 'OBJECT',
        properties: {
          level: { type: 'STRING', enum: ['account', 'campaign', 'adset', 'ad'], description: 'Rows per account (one row), campaign, ad set or ad.' },
          date_preset: { type: 'STRING', enum: RANGES.map(r => r.key), description: 'A named range. Ignored when since and until are given.' },
          since: { type: 'STRING', description: 'Start date YYYY-MM-DD (with until).' },
          until: { type: 'STRING', description: 'End date YYYY-MM-DD (with since).' },
          breakdown: { type: 'STRING', enum: ['none', ...Object.keys(BREAKDOWNS)], description: 'Split the rows by who or where.' },
          daily: { type: 'BOOLEAN', description: 'One row per day.' },
          object_id: { type: 'STRING', description: 'Only this campaign, ad set or ad (its id).' },
        },
        required: ['level'],
      },
    },
    {
      name: 'get_details',
      description: 'One campaign, ad set or ad in full: an ad set’s audience, placements, optimisation, budget and schedule; an ad’s words, button and Meta’s review notes; a campaign’s objective and budget.',
      parameters: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', description: 'The campaign, ad set or ad id.' },
          level: { type: 'STRING', enum: ['campaign', 'adset', 'ad'] },
        },
        required: ['id', 'level'],
      },
    },
  ],
}];

async function ownOrThrow(act: string, id: string) {
  if (!/^\d+$/.test(id)) throw new MetaAdsError('Not an id.', 400);
  const o = await graph<{ account_id?: string }>(id, { params: { fields: 'account_id' } });
  if (`act_${o.account_id}` !== actId(act)) throw new MetaAdsError('That belongs to another ad account.', 403);
}

async function runTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { act } = await requireAccount();
  if (name === 'get_insights') {
    const level = ['account', 'campaign', 'adset', 'ad'].includes(String(args.level)) ? String(args.level) : 'account';
    const objectId = typeof args.object_id === 'string' && args.object_id ? args.object_id : null;
    if (objectId) await ownOrThrow(act, objectId);
    const since = String(args.since ?? ''), until = String(args.until ?? '');
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(since) && /^\d{4}-\d{2}-\d{2}$/.test(until);
    const preset = isRange(args.date_preset) ? args.date_preset : 'last_7d';
    const bd = BREAKDOWNS[String(args.breakdown ?? 'none')];
    const nameFields = level === 'campaign' ? ['campaign_id', 'campaign_name'] : level === 'adset' ? ['adset_id', 'adset_name', 'campaign_name'] : level === 'ad' ? ['ad_id', 'ad_name', 'adset_name'] : [];
    const rows = await graphAll<InsightRow>(`${objectId ?? act}/insights`, {
      fields: [...nameFields, ...BASE_FIELDS].join(','),
      ...(dated ? { time_range: { since, until } } : { date_preset: preset }),
      ...(level !== 'account' ? { level } : {}),
      ...(bd ? { breakdowns: bd } : {}),
      ...(args.daily ? { time_increment: 1 } : {}),
      limit: 100,
    }, 150);
    return {
      range: dated ? { since, until } : preset,
      rows: rows.map(r => {
        const keys = Object.fromEntries(Object.entries(r).filter(([k]) => [...nameFields, 'date_start', 'age', 'gender', 'publisher_platform', 'platform_position', 'region', 'country', 'impression_device', 'hourly_stats_aggregated_by_advertiser_time_zone'].includes(k)));
        return { ...keys, ...compact(metricsOf(r)) };
      }),
    };
  }
  if (name === 'get_details') {
    const id = String(args.id ?? '');
    await ownOrThrow(act, id);
    const level = String(args.level);
    const cur = String((await graph<{ currency?: string }>(act, { params: { fields: 'currency' } })).currency || 'PKR');
    if (level === 'adset') {
      const s = await graph<Record<string, unknown>>(id, { params: { fields: 'name,effective_status,optimization_goal,destination_type,billing_event,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,targeting,learning_stage_info,issues_info,campaign{name,objective}' } });
      const t = s.targeting as Record<string, unknown> | undefined;
      return {
        ...s,
        targeting: undefined,
        audience_in_words: t ? describeAudience(parseTargeting(t)) : null,
        targeting_raw: t,
        daily_budget: s.daily_budget ? money(fromMinor(s.daily_budget as string, cur), cur) : undefined,
        lifetime_budget: s.lifetime_budget ? money(fromMinor(s.lifetime_budget as string, cur), cur) : undefined,
      };
    }
    if (level === 'ad') {
      return graph<Record<string, unknown>>(id, { params: { fields: 'name,effective_status,created_time,issues_info,ad_review_feedback,creative{title,body,call_to_action_type,object_story_spec,instagram_permalink_url},adset{name,optimization_goal}' } });
    }
    const c = await graph<Record<string, unknown>>(id, { params: { fields: 'name,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,bid_strategy,issues_info' } });
    return { ...c, daily_budget: c.daily_budget ? money(fromMinor(c.daily_budget as string, cur), cur) : undefined, lifetime_budget: c.lifetime_budget ? money(fromMinor(c.lifetime_budget as string, cur), cur) : undefined };
  }
  return { error: `No tool called ${name}.` };
}

// ── The conversation ───────────────────────────────────────────────────────

export interface ChatMessage { role: 'user' | 'assistant'; text: string }

const HOUSE = () => STORE_BRAND === 'mina'
  ? 'House of Mina, a sterling-silver jewellery house in Karachi that sells through Instagram (@houseofmina__), WhatsApp and its online catalogue'
  : 'Taheri, a gold and diamond jeweller in Karachi that sells at its shop, through Instagram (@collectionstaheri), its WhatsApp community and taheri.shop';

export function systemPrompt(snapshot: Record<string, unknown>, page: string, today: string): string {
  return [
    `You are the Ads helper inside the ERP of ${HOUSE()}. You look at its Meta (Instagram + Facebook) ad account and answer the owner’s questions about it.`,
    `Today is ${today} (Asia/Karachi). The owner is on the ERP’s ${page} page.`,
    '',
    'How to answer:',
    '- Lead with the answer, then the numbers behind it. Short: a few sentences or tight bullets. Plain words, no jargon without a gloss.',
    '- Reply in the language the owner writes in (English, or Roman Urdu if they write it).',
    `- Money in the account currency like ${money(1500, String((snapshot.account as { currency?: string })?.currency ?? 'PKR'))} — no paisa above Rs 100.`,
    '- Use only numbers from the snapshot below or from your tools. Never invent or estimate a figure you were not given; if you need a range or split you do not have, call get_insights; for an ad set’s audience or an ad’s words, call get_details. If Meta has no data, say so.',
    '- Recommendations must be concrete: which campaign / ad set / ad, what to change, by how much (e.g. “move Rs 500 a day from X to Y”, “pause ad Z”), and why in one line.',
    '- Judge fairly: an ad set in learning (under ~50 results a week) or with little spend is not yet a verdict; frequency above ~3 means the same people are seeing it too often; compare cost per result, not just spend.',
    '- “Chats started” are WhatsApp / Instagram / Messenger conversations the ads began — for a jeweller usually the result that matters most.',
    '- You cannot change anything. Say where in the ERP to do it: Ads → Campaigns (pause, budget, end date, audience, duplicate), New ad, Audiences, Rules.',
    '- Ad spend is deliberately kept out of the ERP’s books, and you cannot see sales, so do not claim what the ads earned; say what they brought (chats, clicks, reach).',
    '',
    'The ad account right now (JSON):',
    JSON.stringify(snapshot),
  ].join('\n');
}

export async function askAds(opts: { messages: ChatMessage[]; range: RangeKey; page: string }): Promise<{ reply: string; model: string; tools: string[] }> {
  const snapshot = await adsSnapshot(opts.range);
  const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const system = systemPrompt(snapshot, opts.page, today);
  const contents: ChatContent[] = opts.messages.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text.slice(0, 4000) }] }));
  const used: string[] = [];

  const models = working && Date.now() - working.at < 3_600_000 ? [working.model, ...MODELS().filter(m => m !== working!.model)] : MODELS();
  let lastError: unknown = null;
  for (const model of models) {
    try {
      for (let round = 0; round < 6; round++) {
        const { content } = await chatTurn({ model, system, contents, tools: TOOLS, temperature: 0.4 });
        const calls = content.parts.filter(p => p.functionCall).map(p => p.functionCall as { name: string; args?: Record<string, unknown> });
        if (!calls.length || round === 5) {
          const text = content.parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text as string).join('').trim();
          working = { model, at: Date.now() };
          return { reply: text || 'I couldn’t put an answer together — try asking it another way.', model, tools: used };
        }
        contents.push(content);
        const responses = await Promise.all(calls.map(async c => {
          used.push(c.name);
          try { return { functionResponse: { name: c.name, response: await runTool(c.name, c.args ?? {}) } }; }
          catch (e) { return { functionResponse: { name: c.name, response: { error: e instanceof Error ? e.message : String(e) } } }; }
        }));
        contents.push({ role: 'user', parts: responses });
      }
    } catch (e) {
      lastError = e;
      // A model this project can't reach: try the next one.
      if (e instanceof AiError && e.status === 404) continue;
      throw e;
    }
  }
  throw lastError ?? new AiError('No AI model could answer.', 503);
}
