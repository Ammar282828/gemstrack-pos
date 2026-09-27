/**
 * The morning WhatsApp line on yesterday's ads — the owner's "how did the ads
 * do?" answered before it is asked. Sent by /api/notifications/run (task
 * `ads-daily`, Cloud Scheduler 09:30 Asia/Karachi) to the shop's alert
 * numbers when Settings → Notifications → Ads Summary is on.
 *
 * Yesterday against the seven days before it (per day), this month's pace,
 * the ad that brought most, and the top three things needing attention —
 * short enough to read at a glance on a phone.
 *
 * `buildAdsDigest` is pure (tested); `adsDigest` gathers the numbers.
 */

import { STORE_CONFIG } from '@/lib/store-config';
import { attentionItems, pacing, type AttentionItem } from './attention';
import { accountSummary, requireAccount } from './settings';
import { topAds, totals, tree } from './insights';
import { currencyOffset, headlineActions, money, resultOf, type AdsAccount, type Metrics } from './shape';

export interface DigestInput {
  shop: string;
  account: AdsAccount;
  yesterday: Metrics;
  /** The seven days before yesterday, whole. */
  weekBefore: Metrics;
  month: ReturnType<typeof pacing>;
  topAd: { name: string; metrics: Metrics; goal: string | null } | null;
  attention: AttentionItem[];
  erpUrl: string;
  date: string;
}

/** "+18%" / "−9%" / "same", yesterday against the week's daily average. */
function vs(now: number, before: number): string {
  if (!before) return now ? 'new' : '';
  const d = ((now - before) / before) * 100;
  if (Math.abs(d) < 3) return 'same as usual';
  return `${d > 0 ? '+' : '−'}${Math.abs(Math.round(d))}% vs the week`;
}

export function buildAdsDigest(d: DigestInput): string {
  const cur = d.account.currency;
  const y = d.yesterday;
  const avg = (n: number) => n / 7;
  const chats = y.actions['onsite_conversion.messaging_conversation_started_7d'] ?? 0;
  const chatsBefore = d.weekBefore.actions['onsite_conversion.messaging_conversation_started_7d'] ?? 0;
  const lines: string[] = [];
  lines.push(`📣 *${d.shop} — Ads yesterday* (${d.date})`);
  if (y.spend === 0 && y.impressions === 0) {
    lines.push('Nothing ran yesterday.');
  } else {
    lines.push(`Spent *${money(y.spend, cur)}* (${vs(y.spend, avg(d.weekBefore.spend))})`);
    lines.push(`Reached ${Math.round(y.reach).toLocaleString('en-US')} people · ${y.clicks.toLocaleString('en-US')} clicks`);
    if (chats || chatsBefore) {
      lines.push(`Chats started: *${chats}* (${vs(chats, avg(chatsBefore))})${chats ? ` · ${money(y.spend / chats, cur)} each` : ''}`);
    } else {
      const acts = headlineActions(y, 2);
      if (acts.length) lines.push(acts.map(a => `${a.label}: *${a.value.toLocaleString('en-US')}*`).join(' · '));
    }
  }
  if (d.topAd) {
    const r = resultOf(d.topAd.metrics, d.topAd.goal ?? undefined);
    lines.push(`Best ad: ${d.topAd.name} — ${money(d.topAd.metrics.spend, cur)}${r && r.value ? `, ${r.value} ${r.label.toLowerCase()}` : ''}`);
  }
  lines.push(`This month: ${money(d.month.spent, cur)} so far, heading for ~${money(d.month.projected, cur)}${d.month.lastMonth ? ` (last month ${money(d.month.lastMonth, cur)})` : ''}`);
  const top = d.attention.filter(a => a.severity !== 'tip').slice(0, 3);
  if (top.length) {
    lines.push('');
    lines.push('*Needs a look:*');
    for (const a of top) lines.push(`${a.severity === 'bad' ? '🔴' : '🟡'} ${a.title}`);
  } else if (d.attention.length) {
    lines.push(`💡 ${d.attention[0].title}`);
  } else if (y.spend > 0) {
    lines.push('✅ Nothing needs attention.');
  }
  lines.push('');
  lines.push(`${d.erpUrl}/ads`);
  return lines.join('\n');
}

/** Yesterday's date and the seven days before it, in the account's time zone. */
export function digestRanges(now: Date, tz: string): { yesterday: { since: string; until: string }; weekBefore: { since: string; until: string }; label: string } {
  const day = (offset: number) => {
    const d = new Date(now.getTime() - offset * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  };
  return {
    yesterday: { since: day(1), until: day(1) },
    weekBefore: { since: day(8), until: day(2) },
    label: new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(now.getTime() - 86_400_000)),
  };
}

export async function adsDigest(now = new Date()): Promise<string> {
  const { act } = await requireAccount();
  const account = await accountSummary(act);
  const tz = account.timezone || 'Asia/Karachi';
  const ranges = digestRanges(now, tz);
  const [y, w, thisMonth, lastMonth, top, campaigns] = await Promise.all([
    totals(act, ranges.yesterday),
    totals(act, ranges.weekBefore).catch(() => null),
    totals(act, 'this_month').catch(() => null),
    totals(act, 'last_month').catch(() => null),
    topAds(act, 'yesterday', 1).catch(() => []),
    tree(act, 'last_7d', { offset: currencyOffset(account.currency) }).catch(() => []),
  ]);
  const monthDay = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) + 'T12:00:00');
  return buildAdsDigest({
    shop: STORE_CONFIG.name,
    account,
    yesterday: y.metrics,
    weekBefore: w?.metrics ?? y.metrics,
    month: pacing(thisMonth?.metrics.spend ?? 0, lastMonth?.metrics.spend ?? 0, monthDay),
    topAd: top[0] ? { name: top[0].name, metrics: top[0].metrics, goal: top[0].goal } : null,
    attention: attentionItems({ account, campaigns, days: 7, now: now.getTime() }),
    erpUrl: (STORE_CONFIG.appUrl || '').replace(/\/+$/, ''),
    date: ranges.label,
  });
}
