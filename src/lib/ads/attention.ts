/**
 * What needs the owner's eye today, worked out from the account and the
 * campaign tree — no AI, just the rules a good media buyer applies every
 * morning. Each item names the object, says why in one line, and offers the
 * one action that fixes it. Pure (tested); the Overview strip and the daily
 * WhatsApp summary both read it.
 *
 * Severity: `bad` stops money or wastes it now; `warn` is worth a look this
 * week; `tip` is an opportunity.
 */

import { ACCOUNT_STATUS, resultOf, type AdsAccount, type TreeCampaign, type TreeAdSet, type Level } from './shape';

export type AttentionKind =
  | 'account' | 'rejected' | 'issue' | 'wasting' | 'fatigue' | 'learning-limited'
  | 'ending-soon' | 'paused-winner' | 'nothing-running' | 'spend-cap' | 'expensive';

export interface AttentionItem {
  kind: AttentionKind;
  severity: 'bad' | 'warn' | 'tip';
  /** What it is about: an object in the tree, or the account. */
  target: { level: Level | 'account'; id: string; name: string } | null;
  title: string;
  why: string;
  /** The one-tap action, when there is one the ERP can do. */
  action?: { do: 'pause' | 'resume'; level: Level; id: string; name: string } | { do: 'open'; href: string };
}

export interface AttentionInput {
  account: AdsAccount;
  campaigns: TreeCampaign[];
  /** How many days the numbers cover (the range's length), to judge spend. */
  days: number;
  now?: number;
}

const FATIGUE_FREQUENCY = 3;
const ENDING_SOON_DAYS = 3;
/** An ad set has "spent with nothing to show" once it has spent this many days' budget, or this much, with no result. */
const WASTE_DAYS_OF_BUDGET = 2;
const WASTE_FLOOR = 1500;
/** A paused ad set is a "winner" when its cost per result beats the running median by this much, with enough results to trust. */
const WINNER_MIN_RESULTS = 5;
const WINNER_BETTER_BY = 0.7;

const money = (n: number, cur: string) => `${cur === 'PKR' ? 'Rs' : cur} ${Math.round(n).toLocaleString('en-US')}`;
const running = (s: string) => s === 'ACTIVE';
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

export function attentionItems(input: AttentionInput): AttentionItem[] {
  const { account, campaigns } = input;
  const cur = account.currency;
  const now = input.now ?? Date.now();
  const out: AttentionItem[] = [];

  // The account itself: nothing else matters while it can't spend.
  const st = ACCOUNT_STATUS[account.status];
  if (st && st.tone !== 'good') {
    out.push({ kind: 'account', severity: st.tone === 'bad' ? 'bad' : 'warn', target: { level: 'account', id: account.id, name: account.name },
      title: `Ad account: ${st.label.toLowerCase()}`, why: st.fix ?? 'Meta has the account on hold.', action: { do: 'open', href: '/ads/setup' } });
  }
  if (account.spendCap && account.amountSpent >= account.spendCap * 0.9) {
    out.push({ kind: 'spend-cap', severity: account.amountSpent >= account.spendCap ? 'bad' : 'warn', target: { level: 'account', id: account.id, name: account.name },
      title: account.amountSpent >= account.spendCap ? 'Spending limit reached — ads have stopped' : `${Math.round((account.amountSpent / account.spendCap) * 100)}% of the spending limit used`,
      why: `${money(account.amountSpent, cur)} of ${money(account.spendCap, cur)}. Raise it in Ads Manager → Payment settings, or ads stop when it is reached.` });
  }

  const sets: { c: TreeCampaign; s: TreeAdSet }[] = campaigns.flatMap(c => c.adsets.map(s => ({ c, s })));
  const live = sets.filter(({ c, s }) => running(c.effectiveStatus) && running(s.effectiveStatus));
  if (!live.length && campaigns.length) {
    out.push({ kind: 'nothing-running', severity: 'warn', target: null, title: 'Nothing is running', why: 'Every campaign is paused, finished or waiting. New pieces are not being seen.', action: { do: 'open', href: '/ads/new' } });
  }

  // Rejected ads and Meta's issues, wherever they sit.
  for (const c of campaigns) {
    for (const s of c.adsets) {
      for (const a of s.ads) {
        if (a.effectiveStatus === 'DISAPPROVED') {
          out.push({ kind: 'rejected', severity: 'bad', target: { level: 'ad', id: a.id, name: a.name }, title: `Rejected: ${a.name}`,
            why: a.issues[0] ?? 'Meta turned this ad down. A new ad with different words or a different photo is usually quickest.', action: { do: 'open', href: `/ads/campaigns?ad=${a.id}` } });
        } else if (a.issues.length && running(a.effectiveStatus)) {
          out.push({ kind: 'issue', severity: 'warn', target: { level: 'ad', id: a.id, name: a.name }, title: `Meta flagged: ${a.name}`, why: a.issues[0], action: { do: 'open', href: `/ads/campaigns?ad=${a.id}` } });
        }
      }
      if (s.issues.length && running(s.effectiveStatus)) {
        out.push({ kind: 'issue', severity: 'warn', target: { level: 'adset', id: s.id, name: s.name }, title: `Meta flagged: ${s.name}`, why: s.issues[0], action: { do: 'open', href: '/ads/campaigns' } });
      }
    }
    if (c.issues.length && running(c.effectiveStatus)) {
      out.push({ kind: 'issue', severity: 'warn', target: { level: 'campaign', id: c.id, name: c.name }, title: `Meta flagged: ${c.name}`, why: c.issues[0], action: { do: 'open', href: '/ads/campaigns' } });
    }
  }

  // Cost per result across the running ad sets that have any, to judge the rest against.
  const costs = live.map(({ s }) => { const r = resultOf(s.metrics, s.optimizationGoal); return r && r.value > 0 ? s.metrics.spend / r.value : null; }).filter((x): x is number => x !== null);
  const typical = median(costs);

  for (const { c, s } of live) {
    const r = resultOf(s.metrics, s.optimizationGoal);
    const daily = s.dailyBudget ?? (s.lifetimeBudget && s.startTime && s.endTime ? s.lifetimeBudget / Math.max(1, (Date.parse(s.endTime) - Date.parse(s.startTime)) / 86_400_000) : null);
    // Spending with nothing to show — only for goals that count something (reach is its own result).
    if (r && r.value === 0 && s.metrics.spend >= Math.max(WASTE_FLOOR, (daily ?? 0) * WASTE_DAYS_OF_BUDGET) && r.label !== 'People reached' && r.label !== 'Impressions') {
      out.push({ kind: 'wasting', severity: 'bad', target: { level: 'adset', id: s.id, name: s.name }, title: `${money(s.metrics.spend, cur)} spent, no ${r.label.toLowerCase()}: ${s.name}`,
        why: `In ${c.name}. Nothing to show for it yet — pause it, or give it a new photo or audience.`, action: { do: 'pause', level: 'adset', id: s.id, name: s.name } });
    } else if (r && r.value > 0 && typical > 0 && costs.length >= 3 && s.metrics.spend / r.value > typical * 2.5 && s.metrics.spend >= WASTE_FLOOR) {
      out.push({ kind: 'expensive', severity: 'warn', target: { level: 'adset', id: s.id, name: s.name }, title: `${r.label} cost ${money(s.metrics.spend / r.value, cur)} each: ${s.name}`,
        why: `Two and a half times the account's usual ${money(typical, cur)}. Check its audience and photo before it spends more.`, action: { do: 'open', href: '/ads/campaigns' } });
    }
    if (s.metrics.frequency >= FATIGUE_FREQUENCY && s.metrics.spend > 0 && s.metrics.reach >= 500) {
      out.push({ kind: 'fatigue', severity: 'warn', target: { level: 'adset', id: s.id, name: s.name }, title: `Same people seeing it ${s.metrics.frequency.toFixed(1)}×: ${s.name}`,
        why: 'Above 3, an audience is worn out and results fall. Widen the audience or give it a new photo.', action: { do: 'open', href: '/ads/campaigns' } });
    }
    if (s.learning === 'Learning limited') {
      out.push({ kind: 'learning-limited', severity: 'tip', target: { level: 'adset', id: s.id, name: s.name }, title: `Learning limited: ${s.name}`,
        why: 'Too few results a week for Meta to find its feet — a bigger budget, a broader audience or fewer ad sets fixes it.', action: { do: 'open', href: '/ads/campaigns' } });
    }
    const end = s.endTime ?? c.stopTime;
    if (end) {
      const left = (Date.parse(end) - now) / 86_400_000;
      if (left > 0 && left <= ENDING_SOON_DAYS) {
        out.push({ kind: 'ending-soon', severity: 'tip', target: { level: 'adset', id: s.id, name: s.name }, title: `Ends ${left < 1 ? 'today' : `in ${Math.ceil(left)} day${Math.ceil(left) === 1 ? '' : 's'}`}: ${s.name}`,
          why: r && r.value > 0 ? `${r.value} ${r.label.toLowerCase()} at ${money(s.metrics.spend / r.value, cur)} each so far — extend it if it is still bringing chats.` : 'Extend it, or let it finish.', action: { do: 'open', href: '/ads/campaigns' } });
      }
    }
  }

  // A paused ad set that was beating the ones still running.
  if (typical > 0) {
    for (const { c, s } of sets) {
      const campaignAlive = running(c.effectiveStatus) || c.effectiveStatus === 'PAUSED';
      if (s.effectiveStatus !== 'PAUSED' || !campaignAlive) continue;
      const r = resultOf(s.metrics, s.optimizationGoal);
      if (!r || r.value < WINNER_MIN_RESULTS) continue;
      const cost = s.metrics.spend / r.value;
      if (cost <= typical * WINNER_BETTER_BY) {
        out.push({ kind: 'paused-winner', severity: 'tip', target: { level: 'adset', id: s.id, name: s.name }, title: `Paused, but it was the cheapest: ${s.name}`,
          why: `${r.label} at ${money(cost, cur)} each against ${money(typical, cur)} for what is running now.`, action: { do: 'resume', level: 'adset', id: s.id, name: s.name } });
      }
    }
  }

  const rank = { bad: 0, warn: 1, tip: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Month-to-date spend, where the month is heading at this pace, and last month — for the pacing tile and the summary. */
export function pacing(monthSoFar: number, lastMonth: number, now = new Date()): { spent: number; projected: number; lastMonth: number; dayOfMonth: number; daysInMonth: number } {
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected = dayOfMonth > 0 ? (monthSoFar / dayOfMonth) * daysInMonth : 0;
  return { spent: monthSoFar, projected, lastMonth, dayOfMonth, daysInMonth };
}
